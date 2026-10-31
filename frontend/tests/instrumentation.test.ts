// Own process. Models Next's order: instrumentation register() runs at server start, then
// application modules are loaded; their top-level initializers must already be under the controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

test("controls are installed by register() before any application module initializer runs", async (t) => {
  let hits = 0;
  const server = http.createServer((_q, r) => (hits++, r.end("reached")));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  process.env.PROBE_PORT = String((server.address() as AddressInfo).port);
  process.env.NEXT_RUNTIME = "nodejs";

  const { register } = await import("../instrumentation.ts");
  await register();
  const { outcome } = await import("./fixtures/initializer-egress-probe.ts");
  assert.equal(await outcome, "EgressBlockedError");
  assert.equal(hits, 0);
});
