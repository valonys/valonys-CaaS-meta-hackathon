// Control for instrumentation.test.ts (own process, NO register()): the same initializer probe
// does reach a local server, so the blocked result there is meaningful.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

test("control: without the controls, the initializer probe reaches the local server", async (t) => {
  let hits = 0;
  const server = http.createServer((_q, r) => (hits++, r.end("reached")));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  process.env.PROBE_PORT = String((server.address() as AddressInfo).port);
  const { outcome } = await import("./fixtures/initializer-egress-probe.ts");
  assert.equal(await outcome, "REACHED");
  assert.equal(hits, 1);
});
