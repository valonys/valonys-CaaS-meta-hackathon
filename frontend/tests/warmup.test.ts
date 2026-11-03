import { test } from "node:test";
import assert from "node:assert/strict";
import { warmUp } from "../scripts/warmup.mjs";

type Reply = { status: number; body: unknown };
const json = (r: Reply) => new Response(JSON.stringify(r.body), { status: r.status });
const LINES = { lines: [{ tag: "A" }, { tag: "B" }] };
const ok = (line: string, visual?: string) => ({ status: 200, body: { line: { line_number: line }, meta_summary: { status: "ok" }, ...(visual ? { visual: { status: visual, origin: "live" } } : {}) } });

function stub(portfolio: Reply | "throw", replay: (tag: string | null, n: number) => Reply) {
  const seen: Record<string, number> = {};
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/portfolio")) {
      if (portfolio === "throw") throw new TypeError("fetch failed");
      return json(portfolio);
    }
    const tag = ((init?.headers ?? {}) as Record<string, string>)["x-integrity-copilot-line"] ?? null;
    const key = tag ?? "default";
    seen[key] = (seen[key] ?? 0) + 1;
    return json(replay(tag, seen[key]));
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}
const run = (s: ReturnType<typeof stub>) => warmUp({ fetchImpl: s.fetchImpl, base: "http://x", token: "t", log: () => {} });

test("warm-up: ready only when every line is ok (narrative and visual)", async () => {
  const s = stub({ status: 200, body: LINES }, (tag) => ok(tag ?? "default", tag === "A" ? "ok" : undefined));
  const r = await run(s);
  assert.equal(r.ready, true);
  assert.equal(r.results.length, 3);
});

test("warm-up: portfolio discovery failure is reported, never 'ready'", async () => {
  for (const p of ["throw", { status: 500, body: {} }] as const) {
    const r = await run(stub(p, () => ok("default")));
    assert.equal(r.ready, false);
    assert.match(r.problems[0], /portfolio discovery failed/);
  }
});

test("warm-up: HTTP error, persistent narrative failure or failed visual is not ready; failures retried once", async () => {
  const http = stub({ status: 200, body: LINES }, (tag) => (tag === "B" ? { status: 500, body: { error: "boom" } } : ok(tag ?? "default")));
  const r1 = await run(http);
  assert.equal(r1.ready, false);
  assert.equal(http.seen.B, 2, "retried once");
  const unfaithful = stub({ status: 200, body: LINES }, (tag) => (tag === "A" ? { status: 200, body: { meta_summary: { status: "error", reason: "unfaithful" } } } : ok(tag ?? "default")));
  const r2 = await run(unfaithful);
  assert.equal(r2.ready, false);
  assert.equal(unfaithful.seen.A, 2);
  const recovered = stub({ status: 200, body: LINES }, (tag, n) => (tag === "A" && n === 1 ? { status: 200, body: { meta_summary: { status: "error", reason: "unfaithful" } } } : ok(tag ?? "default")));
  assert.equal((await run(recovered)).ready, true, "a successful retry counts");
  const visual = stub({ status: 200, body: LINES }, (tag) => ok(tag ?? "default", tag === "A" ? "error" : undefined));
  assert.equal((await run(visual)).ready, false);
});
