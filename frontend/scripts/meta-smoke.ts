// One budget-capped live call to Muse Spark through the audited gateway, to verify the key,
// entitlement, model echo and usage schema. Prints the usage log only (no key, no prompt).
//   MODEL_API_KEY=... npm run meta:smoke
// Hard ceiling: 1 call, $0.05, 512 output tokens (Muse reasons before answering; low effort used ~200). Exit 0 only on a validated "ok".
import { BudgetLedger, MetaGateway } from "../lib/integrity-copilot/gateway.ts";

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) {
  console.error("meta:smoke: MODEL_API_KEY is not set; nothing called.");
  process.exit(2);
}
// retries: 0 so a 429/5xx can never turn the one-call smoke into several billable requests.
const gw = new MetaGateway({ apiKey, retries: 0, maxOutputTokens: 512, ledger: new BudgetLedger({ maxCalls: 1, maxUsd: 0.05 }) });
const r = await gw.respond({
  model: "muse-spark-1.3",
  input: "Reply with exactly: INTEGRITY-COPILOT-OK",
  evidence_ids: ["smoke"],
  max_output_tokens: 512,
});
console.log(JSON.stringify({ result: r, usage: gw.usage, spent: gw.spent }, null, 2));
process.exit(r.status === "ok" ? 0 : 1);
