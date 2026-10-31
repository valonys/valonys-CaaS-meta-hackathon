// Runs in its own process (node --test isolates files), because it patches process-wide globals.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import https from "node:https";
import tls from "node:tls";
import { installEgressAllowlist, socketTarget } from "../lib/integrity-copilot/egress.ts";

installEgressAllowlist();
installEgressAllowlist(); // idempotent

const getError = (fire: (done: (e: unknown) => void) => void) => new Promise<unknown>((resolve) => fire(resolve));

test("socket allowlist: native http, fetch and raw net to a non-allowlisted port are blocked before connecting", async (t) => {
  let hits = 0;
  const server = http.createServer((_q, r) => (hits++, r.end("reached")));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const port = (server.address() as net.AddressInfo).port;

  // The review's exact form: a native module obtained at runtime.
  const h = process.getBuiltinModule("node:" + "http") as typeof http;
  const e1 = await getError((done) => h.get("http:" + "//127.0.0.1:" + port + "/probe", () => done(null)).on("error", done));
  assert.equal((e1 as Error)?.name, "EgressBlockedError", String(e1));

  const e2 = await getError((done) => http.request({ host: "127.0.0.1", port, path: "/" }, () => done(null)).on("error", done).end());
  assert.equal((e2 as Error)?.name, "EgressBlockedError");

  const e3 = await getError((done) => net.connect(port, "127.0.0.1", () => done(null)).on("error", done));
  assert.equal((e3 as Error)?.name, "EgressBlockedError");

  await assert.rejects(fetch(`http://127.0.0.1:${port}/`), (e: Error) => e.name === "EgressBlockedError" || /egress blocked/.test(String((e as { cause?: unknown }).cause ?? e.message)));
  assert.equal(hits, 0, "the non-allowlisted server was never reached");
});

test("socket allowlist: the allowlisted local Muse socket is not blocked by the guard", async () => {
  const e = await getError((done) => {
    const s = net.connect(11434, "127.0.0.1", () => (s.destroy(), done(null)));
    s.on("error", done);
  });
  assert.notEqual((e as Error | null)?.name, "EgressBlockedError"); // null (Ollama up) or ECONNREFUSED (down)
});

test("socketTarget normalizes the Socket#connect call shapes", () => {
  assert.equal(socketTarget([{ host: "API.META.AI", port: 443 }]), "api.meta.ai:443");
  assert.equal(socketTarget([[{ host: "127.0.0.1", port: 11434 }, () => {}]]), "127.0.0.1:11434");
  assert.equal(socketTarget([8080]), "localhost:8080");
  assert.equal(socketTarget(["8080", "10.0.0.1"]), "10.0.0.1:8080");
  assert.equal(socketTarget([{ path: "/tmp/x.sock" }]), null);
  assert.equal(socketTarget(["/tmp/x.sock"]), null);
});

test("socket allowlist: blocked TLS (https/tls) fails cleanly without crashing the process", async () => {
  // Blocked before any DNS lookup or connection, so this is hermetic.
  const e1 = await getError((done) => https.get("https:" + "//non-meta.example/v1", () => done(null)).on("error", done));
  assert.equal((e1 as Error)?.name, "EgressBlockedError", String(e1));
  const e2 = await getError((done) => tls.connect({ host: "non-meta.example", port: 443, servername: "non-meta.example" }, () => done(null)).on("error", done));
  assert.equal((e2 as Error)?.name, "EgressBlockedError", String(e2));
  const e3 = await getError((done) => https.get("https://api.meta.ai.evil.example/x", () => done(null)).on("error", done));
  assert.equal((e3 as Error)?.name, "EgressBlockedError");
});

test("unused transports are disabled at runtime however they are obtained (UDP, child processes, workers)", async () => {
  // The review's exact acquisition path, executed: Function constructor -> process -> getBuiltinModule -> dgram.
  const p = (() => {}).constructor("return " + "process")() as NodeJS.Process;
  const load = (p as unknown as Record<string, (id: string) => any>)["getBuiltin" + "Module"];
  const dg = load("node:" + "dgram");
  assert.throws(() => dg.createSocket("udp4"), { name: "TransportDisabledError" });
  assert.throws(() => new dg.Socket({ type: "udp4" } as never).send(Buffer.from("x"), 9, "127.0.0.1"), { name: "TransportDisabledError" });
  const cp = load("node:child_process");
  for (const fn of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    assert.throws(() => cp[fn]("true"), { name: "TransportDisabledError" }, fn);
  }
  const wt = load("node:worker_threads");
  assert.throws(() => new wt.Worker("data:text/javascript,0", { eval: false }), { name: "TransportDisabledError" });
  const esm = await import("node:" + "child_process");
  assert.throws(() => esm.execFile("true"), { name: "TransportDisabledError" }, "ESM named export also disabled");
});
