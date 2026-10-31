import { test } from "node:test";
import assert from "node:assert/strict";
import { EgressBlockedError, guardFetch, targetOrigin } from "../lib/integrity-copilot/egress.ts";

test("runtime egress: only the Meta API and loopback local Muse are reachable", async () => {
  const seen: unknown[] = [];
  const inner = async (input: unknown) => (seen.push(input), "ok");
  const f = guardFetch(inner);
  assert.equal(await f("https://api.meta.ai/v1/responses"), "ok");
  assert.equal(await f(new URL("http://127.0.0.1:11434/api/chat")), "ok");
  assert.equal(await f({ url: "https://api.meta.ai/v1/models" }), "ok"); // Request-like
  for (const bad of ["https:" + "//non-meta.example/v1/infer", "http://127.0.0.1:8080/v1", "https://api.meta.ai.evil.example/x", "http://api.meta.ai/v1", "/relative", "not a url", 42]) {
    await assert.rejects(f(bad), EgressBlockedError, String(bad));
  }
  assert.equal(seen.length, 3, "blocked targets never reach the inner fetch");
  assert.equal(targetOrigin("https://API.META.AI/v1"), "https://api.meta.ai");
});
