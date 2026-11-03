// Demo warm-up: run the default replay plus every portfolio line once, so recording needs no waits.
// Readiness is strict: it is reported only when the portfolio was discovered, every line answered
// HTTP 2xx with a narrative status of "ok", and (when a visual is expected) the visual is "ok".
// A non-ok narrative is retried once; withheld narratives are evicted server-side, so the retry is a
// genuine regeneration. Returns { ready, results, problems } and never throws.
export async function warmUp({ fetchImpl = fetch, base, token, log = console.log, timeoutMs = 600_000 }) {
  const problems = [];
  const results = [];
  let tags = [null];
  try {
    const r = await fetchImpl(`${base}/api/integrity-copilot/portfolio`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const pf = await r.json();
    if (!Array.isArray(pf?.lines)) throw new Error("no lines in portfolio");
    tags = [null, ...pf.lines.map((l) => l.tag)];
  } catch (e) {
    problems.push(`portfolio discovery failed (${e?.message ?? e}); only the default line was warmed`);
  }
  log(`  Warming ${tags.length} line(s)...`);
  for (const tag of tags) {
    let outcome = null;
    for (let attempt = 1; attempt <= 2 && !outcome?.ok; attempt++) {
      if (attempt === 2) log("    retrying once");
      const t1 = Date.now();
      try {
        const headers = { "x-integrity-copilot-token": token, ...(tag ? { "x-integrity-copilot-line": tag } : {}) };
        const r = await fetchImpl(`${base}/api/integrity-copilot/replay`, { headers, signal: AbortSignal.timeout(timeoutMs) });
        const body = await r.json().catch(() => ({}));
        const narrative = body?.meta_summary?.status ?? null;
        const visual = body?.visual ? body.visual.status : null; // null = no image on this line
        const ok = r.ok && narrative === "ok" && (visual === null || visual === "ok");
        outcome = { tag, line: body?.line?.line_number ?? tag ?? "default", http: r.status, narrative, reason: body?.meta_summary?.reason ?? null, visual, origin: body?.visual?.origin ?? null, seconds: Math.round((Date.now() - t1) / 1000), ok };
      } catch (e) {
        outcome = { tag, line: tag ?? "default", http: null, narrative: null, reason: e?.name ?? "error", visual: null, origin: null, seconds: Math.round((Date.now() - t1) / 1000), ok: false };
      }
      log(`  - ${outcome.line}: HTTP ${outcome.http ?? "-"}, narrative ${outcome.narrative ?? "none"}${outcome.reason ? ` (${outcome.reason})` : ""}${outcome.visual ? `, visual ${outcome.origin} ${outcome.visual}` : ""} in ${outcome.seconds} s`);
    }
    results.push(outcome);
    if (!outcome.ok) problems.push(`${outcome.line} is not ready`);
  }
  const ready = problems.length === 0;
  log(ready ? "  Warm-up finished: every line ok. Ready to record." : `  NOT READY: ${problems.join("; ")}. Re-run replay for the listed line(s) before recording.`);
  return { ready, results, problems };
}
