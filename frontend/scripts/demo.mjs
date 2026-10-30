// One-command local demo: build if needed, then `next start` with a durable decision dir and an
// approver token. Replay data only; live Meta calls stay off unless you pass INTEGRITY_COPILOT_LIVE=1
// and MODEL_API_KEY yourself.
//   npm run demo                      -> http://localhost:3000
//   PORT=3100 npm run demo
import { spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)); // path-safe (spaces etc.)
const NEXT = `${ROOT}node_modules/.bin/next`;
const port = process.env.PORT || "3000";
const token = process.env.INTEGRITY_COPILOT_APPROVER_TOKEN || `demo-${randomBytes(6).toString("hex")}`;

if (!existsSync(`${ROOT}.next/BUILD_ID`) || process.argv.includes("--rebuild")) {
  const b = spawnSync(NEXT, ["build"], { cwd: ROOT, stdio: "inherit" });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

// Live mode uses local Meta Muse (muse-glimmer) through the Ollama desktop runtime: no key, no cost.
// Paid Meta API calls are a separate, explicit opt-in: INTEGRITY_COPILOT_MUSE=api (Muse Spark narrative)
// or INTEGRITY_COPILOT_SAM=live (live SAM 3.1). Only then is the key read, from a file OUTSIDE the
// repo (never .env.local: `next start` auto-loads that, which would let any local server reach the API).
const KEY_FILE = process.env.META_ENV_FILE || `${homedir()}/.config/caas-meta-hackathon/meta.env`;
function keyFromFile() {
  if (!existsSync(KEY_FILE)) return undefined;
  const m = readFileSync(KEY_FILE, "utf8").match(/^MODEL_API_KEY=(.+)$/m);
  return m?.[1].trim() || undefined;
}
const liveRequested = process.env.INTEGRITY_COPILOT_LIVE === "1";
const paidRequested = liveRequested && (process.env.INTEGRITY_COPILOT_MUSE === "api" || process.env.INTEGRITY_COPILOT_SAM === "live");

const env = {
  ...process.env,
  ...(paidRequested && !process.env.MODEL_API_KEY ? { MODEL_API_KEY: keyFromFile() } : {}),
  INTEGRITY_COPILOT_APPROVER_TOKEN: token,
  INTEGRITY_COPILOT_DATA_DIR: process.env.INTEGRITY_COPILOT_DATA_DIR || `${ROOT}.data`,
};
if (!paidRequested) delete env.MODEL_API_KEY; // no paid call unless explicitly requested
const narrative = !liveRequested ? "replay only (summary shows 'unavailable')" : env.INTEGRITY_COPILOT_MUSE === "api" ? "Muse Spark via paid Meta API" : "local Muse Glimmer via Ollama desktop (no cost)";
const sam = liveRequested && env.MODEL_API_KEY && env.INTEGRITY_COPILOT_SAM === "live" ? "live SAM 3.1 via paid Meta API" : "recorded SAM 3.1 result (labelled)";
console.log(`
  Integrity Copilot demo
  URL             http://localhost:${port}
  Approver token  ${token}
  Decisions dir   ${env.INTEGRITY_COPILOT_DATA_DIR}   (delete it to reset the demo)
  Narrative       ${narrative}
  Visual          ${sam}
`);
const child = spawn(NEXT, ["start", "-p", port], { cwd: ROOT, env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));

// Live mode: warm the per-process cache once so the first page load does not wait on local Muse.
if (liveRequested) {
  const warm = async () => {
    for (let i = 0; i < 60; i++) {
      try {
        const t0 = Date.now();
        console.log("  Warming the configured inspection replay and model caches...");
        const r = await fetch(`http://localhost:${port}/api/integrity-copilot/replay`, { headers: { "x-integrity-copilot-token": token } });
        const body = await r.json();
        console.log(`  Warm-up done in ${Math.round((Date.now() - t0) / 1000)} s: narrative ${body.meta_summary?.status ?? r.status}`);
        return;
      } catch {
        await new Promise((res) => setTimeout(res, 1000));
      }
    }
  };
  void warm();
}
