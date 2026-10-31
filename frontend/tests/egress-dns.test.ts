// Own process: patches process-wide built-ins. A real UDP receiver is opened BEFORE the guard installs.
import { test } from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { installEgressAllowlist } from "../lib/integrity-copilot/egress.ts";

const receiver = dgram.createSocket("udp4");
let packets = 0;
receiver.on("message", () => packets++);
await new Promise<void>((r) => receiver.bind(0, "127.0.0.1", () => r()));
const port = receiver.address().port;
receiver.unref(); // never keep the test process alive
const preexisting = new dns.Resolver(); // created before the guard: its prototype methods must still be disabled
installEgressAllowlist();

test("DNS resolver traffic is disabled at runtime however the module is obtained (the review's exact chain)", async (t) => {
  t.after(() => receiver.close());
  const C = ((() => {}) as unknown as Record<string, FunctionConstructor>)["con" + "structor"];
  const p = C("return " + "process")() as NodeJS.Process;
  const load = (p as unknown as Record<string, (id: string) => any>)["getBuiltin" + "Module"];
  const d = load("node:" + "dns");
  assert.throws(() => new d.Resolver(), { name: "TransportDisabledError" });
  assert.throws(() => preexisting.setServers([`127.0.0.1:${port}`]), { name: "TransportDisabledError" });
  assert.throws(() => preexisting.resolve4("exfil.example", () => {}), { name: "TransportDisabledError" });
  for (const fn of ["resolve", "resolve4", "resolveTxt", "reverse", "setServers", "lookupService"]) {
    assert.throws(() => d[fn]("x.example", () => {}), { name: "TransportDisabledError" }, fn);
  }
  assert.throws(() => new dnsPromises.Resolver(), { name: "TransportDisabledError" });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(packets, 0, "no DNS packet reached the receiver");
});

test("dns.lookup is limited to allowlisted names (net still reaches api.meta.ai)", async () => {
  const blocked = await new Promise<Error | null>((r) => dns.lookup("exfil-data.example", (e) => r(e)));
  assert.equal(blocked?.name, "EgressBlockedError");
  await assert.rejects(dnsPromises.lookup("exfil-data.example"), { name: "EgressBlockedError" });
  const ip = await new Promise<Error | null>((r) => dns.lookup("127.0.0.1", (e) => r(e)));
  assert.equal(ip, null, "IP literals need no DNS query and stay allowed");
  const allowed = await Promise.race([
    new Promise<Error | null>((r) => dns.lookup("api.meta.ai", (e) => r(e))),
    new Promise<Error | null>((r) => setTimeout(() => r(null), 5000).unref()),
  ]);
  assert.notEqual(allowed?.name, "EgressBlockedError"); // resolves, or fails for network reasons offline
});
