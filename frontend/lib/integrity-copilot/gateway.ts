// The ONLY path from the Integrity Copilot to learned inference.
//
// - Fixed Meta host; no configurable base URL, so no other provider is reachable from here.
// - Strict model allowlist; every "-contributor" variant is refused (inputs may be used for training).
// - Fail-closed budgets: calls and estimated USD held in a BudgetLedger that the server shares
//   across requests for the whole process, plus a per-request output-token cap. Exhaustion
//   returns "unavailable", never a fallback.
// - The response must echo the requested model (or a dated snapshot of it) and carry only
//   finite non-negative integer token counts; anything else is an error that keeps the
//   worst-case reservation.
// - Secret-safe usage log: ids, model, latency, usage, outcome. No prompts, no keys.
//
// UNVERIFIED until a real authenticated call succeeds: account entitlement, exact response
// schema, usage field names. Endpoint/model ids come from dev.meta.ai docs read 2026-10-28.

import { createHash } from "node:crypto";

export const META_BASE_URL = "https://api.meta.ai/v1";
// Local Meta Muse served by the Ollama desktop runtime on loopback. Only Meta Muse models in
// LOCAL_MODELS may use it; nothing else is ever sent here.
export const LOCAL_MUSE_URL = "http://127.0.0.1:11434/api/chat";

export const MODEL_ALLOWLIST = ["muse-glimmer", "muse-spark-1.3", "muse-wonder-1.0", "sam-3.1"] as const;
export type AllowedModel = (typeof MODEL_ALLOWLIST)[number];
export const LOCAL_MODELS: readonly AllowedModel[] = ["muse-glimmer"];

// USD per 1M tokens (Standard mode), dev.meta.ai/docs/pricing-rate-limits, 2026-10-28.
// Telemetry for budgeting only; the hard stop is the call/USD/token ceiling below.
const PRICE: Record<AllowedModel, { in: number; out: number; per_image?: number }> = {
  "muse-glimmer": { in: 0, out: 0 }, // local: no per-call charge
  "muse-spark-1.3": { in: 1.25, out: 4.25 },
  "muse-wonder-1.0": { in: 4.0, out: 20.0 },
  "sam-3.1": { in: 0, out: 0, per_image: 2.5 / 1000 },
};

// Process-wide spend ceiling. Reserve worst case before a call, reconcile down only from
// validated usage. Ceilings can be configured downward only.
export class BudgetLedger {
  private spentUsd = 0;
  private calls = 0;
  readonly maxCalls: number;
  readonly maxUsd: number;

  constructor(limits: { maxCalls?: number; maxUsd?: number } = {}) {
    const clamp = (v: number | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, d) : d);
    this.maxCalls = clamp(limits.maxCalls, DEFAULT_LIMITS.maxCalls);
    this.maxUsd = clamp(limits.maxUsd, DEFAULT_LIMITS.maxUsd);
  }

  get spent(): { calls: number; estimated_usd: number } {
    return { calls: this.calls, estimated_usd: this.spentUsd };
  }

  reserve(worstCaseUsd: number): boolean {
    if (!Number.isFinite(worstCaseUsd) || worstCaseUsd < 0) return false;
    if (this.calls >= this.maxCalls || this.spentUsd + worstCaseUsd > this.maxUsd) return false;
    this.calls += 1;
    this.spentUsd += worstCaseUsd;
    return true;
  }

  // Record spend beyond a reservation (provider billed more than reserved). Only ever raises spend.
  charge(extraUsd: number): void {
    if (Number.isFinite(extraUsd) && extraUsd > 0) this.spentUsd += extraUsd;
  }

  // Release part of a reservation; only ever lowers spend toward the validated actual.
  settle(reservedUsd: number, actualUsd: number): void {
    if (Number.isFinite(actualUsd) && actualUsd >= 0 && actualUsd < reservedUsd) this.spentUsd -= reservedUsd - actualUsd;
  }
}

// Process-level cache of validated "ok" responses, keyed by a hash of the exact request.
// A repeat replay of the same (masked) input spends nothing and returns at once. Only validated
// results are cached; errors, incomplete and unavailable outcomes always go back to the API.
export class ResponseCache {
  private m = new Map<string, { text: string; model_id: string }>();
  readonly maxEntries: number;
  constructor(maxEntries = 64) {
    this.maxEntries = maxEntries;
  }
  get(key: string) {
    return this.m.get(key);
  }
  set(key: string, v: { text: string; model_id: string }) {
    if (this.m.size >= this.maxEntries && !this.m.has(key)) this.m.delete(this.m.keys().next().value as string);
    this.m.set(key, v);
  }
  get size() {
    return this.m.size;
  }
}

export interface GatewayConfig {
  apiKey?: string;
  local?: boolean; // local Muse enabled (live mode)
  // Paid API models enabled one by one (C-019 P1): a SAM opt-in must not unlock Muse Spark, and
  // vice versa. Undefined = every allowlisted API model (direct construction in tests).
  apiModels?: readonly AllowedModel[];
  narrativeModel?: AllowedModel; // default: local muse-glimmer
  localTimeoutMs?: number;
  maxCalls: number;
  maxUsd: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retries: number;
  backoffMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  ledger?: BudgetLedger;
  cache?: ResponseCache;
}

export const DEFAULT_LIMITS = { maxCalls: 400, maxUsd: 25, maxOutputTokens: 4096, timeoutMs: 60_000, retries: 2, backoffMs: 500 };

export interface UsageEntry {
  call_id: string;
  requested_model: string;
  model_id: string | null; // as returned by the API
  endpoint: "responses" | "local-chat";
  started_at: string;
  latency_ms: number;
  usage: { input_tokens?: number; output_tokens?: number } | null;
  estimated_usd: number;
  evidence_ids: string[];
  outcome: "ok" | "unavailable" | "error";
  detail?: string;
}

export type GatewayResult =
  | { status: "ok"; text: string; model_id: string; call_id: string }
  | { status: "unavailable"; reason: "not_configured" | "model_not_allowed" | "budget_exhausted"; detail: string; call_id: string }
  | { status: "error"; reason: "http" | "timeout" | "malformed_response" | "incomplete"; detail: string; call_id: string };

export type ReasoningEffort = "low" | "medium" | "high";
const REASONING_MODELS: readonly AllowedModel[] = ["muse-spark-1.3", "muse-wonder-1.0"];

export interface RespondRequest {
  model: string;
  input: unknown; // Responses API `input` (string or message array)
  evidence_ids: string[];
  max_output_tokens?: number;
  images?: number; // SAM billing hint; the gateway also counts input_image items and uses the larger
  // Muse models only. Default "low": at the API default, a trivial prompt spent 510 of 512
  // output tokens reasoning and returned no text (live probe 2026-10-30).
  reasoning_effort?: ReasoningEffort;
}

let seq = 0;

export class MetaGateway {
  readonly usage: UsageEntry[] = [];
  readonly ledger: BudgetLedger;
  private readonly cfg: GatewayConfig;

  constructor(cfg: Partial<GatewayConfig> & { apiKey?: string }) {
    this.cfg = { ...DEFAULT_LIMITS, ...cfg };
    this.ledger = cfg.ledger ?? new BudgetLedger({ maxCalls: this.cfg.maxCalls, maxUsd: this.cfg.maxUsd });
  }

  // The Muse model that writes the narrative: local muse-glimmer unless configured otherwise.
  get narrativeModel(): AllowedModel {
    return this.cfg.narrativeModel ?? "muse-glimmer";
  }

  // Whether a given model can be called: local models need local mode, API models need a key.
  canServe(model: AllowedModel): boolean {
    if (LOCAL_MODELS.includes(model)) return Boolean(this.cfg.local);
    return Boolean(this.cfg.apiKey) && (this.cfg.apiModels === undefined || this.cfg.apiModels.includes(model));
  }

  get configured(): boolean {
    return this.canServe(this.narrativeModel);
  }

  get spent(): { calls: number; estimated_usd: number } {
    return this.ledger.spent;
  }

  async respond(req: RespondRequest): Promise<GatewayResult> {
    const now = this.cfg.now ?? Date.now;
    const call_id = `mg-${now().toString(36)}-${(seq++).toString(36)}`;
    const startedAt = new Date(now()).toISOString();
    const log = (e: Partial<UsageEntry> & Pick<UsageEntry, "outcome">) =>
      this.usage.push({
        call_id,
        requested_model: req.model,
        model_id: null,
        endpoint: "responses",
        started_at: startedAt,
        latency_ms: 0,
        usage: null,
        estimated_usd: 0,
        evidence_ids: req.evidence_ids,
        ...e,
      });

    if (!(MODEL_ALLOWLIST as readonly string[]).includes(req.model) || /contributor/i.test(req.model)) {
      log({ outcome: "unavailable", detail: "model_not_allowed" });
      return { status: "unavailable", reason: "model_not_allowed", detail: `model "${req.model}" is not on the Meta allowlist`, call_id };
    }
    const model = req.model as AllowedModel;
    if (LOCAL_MODELS.includes(model)) return this.respondLocal(req, model, call_id, log, now);
    if (this.cfg.apiModels !== undefined && !this.cfg.apiModels.includes(model)) {
      log({ outcome: "unavailable", detail: "model_not_enabled" });
      return { status: "unavailable", reason: "not_configured", detail: `paid model "${model}" is not enabled (its own opt-in is required)`, call_id };
    }
    if (!this.cfg.apiKey) {
      log({ outcome: "unavailable", detail: "not_configured" });
      return { status: "unavailable", reason: "not_configured", detail: "MODEL_API_KEY is not configured; Meta inference is unavailable", call_id };
    }

    const maxOut = Math.min(req.max_output_tokens ?? this.cfg.maxOutputTokens, this.cfg.maxOutputTokens);
    const effort = REASONING_MODELS.includes(model) ? (req.reasoning_effort ?? "low") : undefined;
    // Checked before the budget: a cache hit reserves nothing, uses no call slot and is logged at $0.
    const cacheKey = createHash("sha256").update(JSON.stringify({ model, input: req.input, maxOut, effort })).digest("hex");
    const hit = this.cfg.cache?.get(cacheKey);
    if (hit) {
      log({ outcome: "ok", model_id: hit.model_id, estimated_usd: 0, detail: "cache_hit" });
      return { status: "ok", text: hit.text, model_id: hit.model_id, call_id };
    }
    const inputChars = JSON.stringify(req.input).length;
    // Never trust the caller's hint alone: bill at least every input_image actually sent.
    const imagesSent = Math.max(req.images ?? 0, countInputImages(req.input));
    const worstCase = estimateUsd(model, Math.ceil(inputChars / 3), maxOut, imagesSent);
    if (!this.ledger.reserve(worstCase)) {
      const s = this.ledger.spent;
      log({ outcome: "unavailable", detail: "budget_exhausted" });
      return {
        status: "unavailable",
        reason: "budget_exhausted",
        detail: `budget: ${s.calls}/${this.ledger.maxCalls} calls, $${s.estimated_usd.toFixed(4)} + $${worstCase.toFixed(4)} worst case > $${this.ledger.maxUsd}`,
        call_id,
      };
    }

    const fetchImpl = this.cfg.fetchImpl ?? fetch;
    // store:false always: inspection evidence must not be retained by the provider (the API default is true).
    const body = JSON.stringify({
      model,
      input: req.input,
      max_output_tokens: maxOut,
      store: false,
      ...(effort ? { reasoning: { effort } } : {}),
    });
    const t0 = now();
    let lastDetail = "";
    for (let attempt = 0; attempt <= this.cfg.retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, this.cfg.backoffMs * 2 ** (attempt - 1)));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
      try {
        const res = await fetchImpl(`${META_BASE_URL}/responses`, {
          method: "POST",
          cache: "no-store", // never Next's persistent Data Cache: every call is real or reported as cached by us
          headers: { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json" },
          body,
          signal: ctrl.signal,
        });
        if (res.status === 429 || res.status >= 500) {
          clearTimeout(timer);
          lastDetail = `HTTP ${res.status}`;
          continue; // bounded retry
        }
        if (!res.ok) {
          clearTimeout(timer);
          log({ outcome: "error", latency_ms: now() - t0, detail: `HTTP ${res.status}`, estimated_usd: worstCase });
          return { status: "error", reason: "http", detail: `Meta API returned HTTP ${res.status}`, call_id };
        }
        // The timer stays armed through body read + parse: a stalled body is a timeout.
        let json: Record<string, unknown>;
        try {
          json = (await withAbort(res.json(), ctrl.signal)) as Record<string, unknown>;
        } finally {
          clearTimeout(timer);
        }
        // An incomplete response (e.g. the token cap was spent on reasoning) is reported as such, not as text.
        if (json?.status === "incomplete") {
          const why = (json.incomplete_details as { reason?: unknown } | undefined)?.reason;
          const detail = `response incomplete: ${typeof why === "string" ? why : "unknown reason"}`;
          const u = parseUsage(json.usage);
          log({ outcome: "error", latency_ms: now() - t0, model_id: typeof json.model === "string" ? json.model : null, usage: u === "invalid" ? null : u, estimated_usd: worstCase, detail });
          return { status: "error", reason: "incomplete", detail, call_id };
        }
        const text = json && typeof json === "object" ? extractOutputText(json) : null;
        const modelId = typeof json?.model === "string" ? json.model : null;
        const usage = parseUsage(json?.usage);
        const processedRaw = (json?.usage as Record<string, unknown> | undefined)?.images_processed;
        const processed = processedRaw === undefined ? undefined : Number.isSafeInteger(processedRaw) && (processedRaw as number) >= 0 ? (processedRaw as number) : NaN;
        // The provider billed images we did not reserve: record the real spend, then fail closed.
        const overageUsd = processed !== undefined && processed > imagesSent ? estimateUsd(model, 0, 0, processed - imagesSent) : 0;
        this.ledger.charge(overageUsd);
        const problem =
          text === null || modelId === null
            ? "response lacked output text or model id"
            : !modelMatches(model, modelId)
              ? `returned model "${modelId}" is not the requested allowlisted model "${model}"`
              : usage === "invalid"
                ? "usage token counts must be finite non-negative integers"
                : json.store === true
                  ? "provider reports the response was stored despite store:false"
                  : Number.isNaN(processed) || (imagesSent > 0 && processed === undefined)
                    ? "usage images_processed must be present for image requests and a safe non-negative integer"
                    : processed !== undefined && processed > imagesSent
                      ? `provider processed ${processed} images but ${imagesSent} were sent`
                      : null;
        if (problem) {
          // Keep the full worst-case reservation: nothing about this response is trusted.
          log({ outcome: "error", latency_ms: now() - t0, model_id: modelId, usage: usage === "invalid" ? null : usage, estimated_usd: worstCase + overageUsd, detail: `malformed_response: ${problem}` });
          return { status: "error", reason: "malformed_response", detail: problem, call_id };
        }
        const valid = usage as UsageEntry["usage"];
        const actual = valid && valid.input_tokens !== undefined && valid.output_tokens !== undefined ? estimateUsd(model, valid.input_tokens, valid.output_tokens, imagesSent) : worstCase;
        this.ledger.settle(worstCase, actual);
        log({ outcome: "ok", latency_ms: now() - t0, model_id: modelId, usage: valid, estimated_usd: Math.min(actual, worstCase) });
        this.cfg.cache?.set(cacheKey, { text: text as string, model_id: modelId as string });
        return { status: "ok", text: text as string, model_id: modelId as string, call_id };
      } catch (e) {
        clearTimeout(timer);
        lastDetail = (e as Error).name === "AbortError" ? "timeout" : `network: ${(e as Error).name}`;
      }
    }
    const timeout = lastDetail === "timeout";
    log({ outcome: "error", latency_ms: now() - t0, detail: lastDetail, estimated_usd: worstCase });
    return { status: "error", reason: timeout ? "timeout" : "http", detail: `failed after ${this.cfg.retries + 1} attempts: ${lastDetail}`, call_id };
  }

  // Local Meta Muse via the Ollama desktop runtime (loopback only). Same contract as the API path:
  // model echo checked, cut-off output reported as incomplete, usage validated, cached, one call slot.
  private async respondLocal(
    req: RespondRequest,
    model: AllowedModel,
    call_id: string,
    log: (e: Partial<UsageEntry> & Pick<UsageEntry, "outcome">) => void,
    now: () => number
  ): Promise<GatewayResult> {
    if (!this.cfg.local) {
      log({ outcome: "unavailable", endpoint: "local-chat", detail: "not_configured" });
      return { status: "unavailable", reason: "not_configured", detail: "local Muse is not enabled (set INTEGRITY_COPILOT_LIVE=1)", call_id };
    }
    const maxOut = Math.min(req.max_output_tokens ?? this.cfg.maxOutputTokens, this.cfg.maxOutputTokens);
    const messages = toLocalMessages(req.input);
    const cacheKey = createHash("sha256").update(JSON.stringify({ transport: "local", model, messages, maxOut })).digest("hex");
    const hit = this.cfg.cache?.get(cacheKey);
    if (hit) {
      log({ outcome: "ok", endpoint: "local-chat", model_id: hit.model_id, estimated_usd: 0, detail: "cache_hit" });
      return { status: "ok", text: hit.text, model_id: hit.model_id, call_id };
    }
    if (!this.ledger.reserve(0)) {
      log({ outcome: "unavailable", endpoint: "local-chat", detail: "budget_exhausted" });
      return { status: "unavailable", reason: "budget_exhausted", detail: `budget: ${this.ledger.spent.calls}/${this.ledger.maxCalls} calls`, call_id };
    }
    const fetchImpl = this.cfg.fetchImpl ?? fetch;
    const t0 = now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.localTimeoutMs ?? 300_000);
    try {
      const res = await fetchImpl(LOCAL_MUSE_URL, {
        method: "POST",
        cache: "no-store", // never Next's persistent Data Cache (it replayed stale local replies as fresh calls)
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: false, think: false, options: { num_predict: maxOut } }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        log({ outcome: "error", endpoint: "local-chat", latency_ms: now() - t0, detail: `HTTP ${res.status}` });
        return { status: "error", reason: "http", detail: `local Muse returned HTTP ${res.status}`, call_id };
      }
      const json = (await withAbort(res.json(), ctrl.signal)) as Record<string, unknown>;
      const modelId = typeof json?.model === "string" ? json.model : null;
      const msg = json?.message as { content?: unknown } | undefined;
      const text = typeof msg?.content === "string" && msg.content.trim() ? msg.content : null;
      const counts = [json?.prompt_eval_count, json?.eval_count];
      const usage = counts.every((c) => c === undefined || (Number.isSafeInteger(c) && (c as number) >= 0))
        ? { input_tokens: counts[0] as number | undefined, output_tokens: counts[1] as number | undefined }
        : "invalid";
      // Only a finished response counts (C-019 P1): done must be true with a terminal reason.
      if (json?.done_reason === "length") {
        const detail = "response incomplete: max_output_tokens";
        log({ outcome: "error", endpoint: "local-chat", latency_ms: now() - t0, model_id: modelId, usage: usage === "invalid" ? null : usage, detail });
        return { status: "error", reason: "incomplete", detail, call_id };
      }
      const problem =
        json?.done !== true || json?.done_reason !== "stop"
          ? `response not finished (done=${String(json?.done)}, done_reason=${String(json?.done_reason)})`
          : text === null || modelId === null
          ? "response lacked output text or model id"
          : !localModelMatches(model, modelId)
            ? `returned model "${modelId}" is not the requested local Muse model "${model}"`
            : usage === "invalid"
              ? "usage counts must be safe non-negative integers"
              : null;
      if (problem) {
        log({ outcome: "error", endpoint: "local-chat", latency_ms: now() - t0, model_id: modelId, detail: `malformed_response: ${problem}` });
        return { status: "error", reason: "malformed_response", detail: problem, call_id };
      }
      log({ outcome: "ok", endpoint: "local-chat", latency_ms: now() - t0, model_id: modelId, usage: usage as UsageEntry["usage"], estimated_usd: 0 });
      this.cfg.cache?.set(cacheKey, { text: text as string, model_id: modelId as string });
      return { status: "ok", text: text as string, model_id: modelId as string, call_id };
    } catch (e) {
      const timeout = (e as Error).name === "AbortError";
      log({ outcome: "error", endpoint: "local-chat", latency_ms: now() - t0, detail: timeout ? "timeout" : `network: ${(e as Error).name}` });
      return { status: "error", reason: timeout ? "timeout" : "http", detail: timeout ? "local Muse timed out" : "local Muse is not reachable on loopback", call_id };
    } finally {
      clearTimeout(timer);
    }
  }
}

// Ollama /api/chat messages from a Responses-style input: string, or [{role, content}] where content
// is a string or parts (input_text joined; input_image data URLs passed as base64 images).
function toLocalMessages(input: unknown): { role: string; content: string; images?: string[] }[] {
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (!Array.isArray(input)) return [{ role: "user", content: JSON.stringify(input) }];
  return input.map((m) => {
    const o = (m ?? {}) as { role?: unknown; content?: unknown };
    const role = typeof o.role === "string" ? o.role : "user";
    if (typeof o.content === "string") return { role, content: o.content };
    const parts = Array.isArray(o.content) ? (o.content as { type?: string; text?: string; image_url?: string }[]) : [];
    const images = parts.filter((p) => p.type === "input_image" && typeof p.image_url === "string").map((p) => p.image_url!.replace(/^data:[^,]*,/, ""));
    const content = parts.filter((p) => p.type === "input_text").map((p) => p.text ?? "").join("\n");
    return images.length ? { role, content, images } : { role, content };
  });
}

// Ollama echoes "name" or "name:tag" (e.g. muse-glimmer:latest).
export function localModelMatches(requested: AllowedModel, returned: string): boolean {
  return returned === requested || new RegExp(`^${requested.replace(/[.]/g, "\\.")}:[A-Za-z0-9._-]+$`).test(returned);
}

function withAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => (signal.removeEventListener("abort", onAbort), resolve(v)),
      (e) => (signal.removeEventListener("abort", onAbort), reject(e))
    );
  });
}

// Exact id, or a dated snapshot of it ("muse-spark-1.3-20261020"). Never a contributor variant.
export function modelMatches(requested: AllowedModel, returned: string): boolean {
  if (/contributor/i.test(returned)) return false;
  return returned === requested || new RegExp(`^${requested.replace(/[.]/g, "\\.")}-\\d{8}$`).test(returned);
}

// Absent usage is allowed (reservation kept). Present usage must be all finite non-negative integers.
export function parseUsage(u: unknown): UsageEntry["usage"] | "invalid" {
  if (u === undefined || u === null) return null;
  if (typeof u !== "object" || Array.isArray(u)) return "invalid";
  const out: { input_tokens?: number; output_tokens?: number } = {};
  for (const [k, v] of Object.entries(u as Record<string, unknown>)) {
    if (!/_tokens$/.test(k)) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return "invalid";
    if (k === "input_tokens" || k === "output_tokens") out[k] = v;
  }
  return out;
}

// Count Responses-API input_image items anywhere in the request input.
export function countInputImages(input: unknown): number {
  if (Array.isArray(input)) return input.reduce((n: number, x) => n + countInputImages(x), 0);
  if (!input || typeof input !== "object") return 0;
  const o = input as Record<string, unknown>;
  return (o.type === "input_image" ? 1 : 0) + countInputImages(o.content);
}

export function estimateUsd(model: AllowedModel, inTokens: number, outTokens: number, images: number): number {
  const p = PRICE[model];
  return (inTokens * p.in + outTokens * p.out) / 1e6 + images * (p.per_image ?? 0);
}

// Responses API: prefer the `output_text` convenience field, else concatenate output[].content[] text parts.
export function extractOutputText(json: Record<string, unknown>): string | null {
  if (typeof json.output_text === "string") return json.output_text;
  if (!Array.isArray(json.output)) return null;
  const parts: string[] = [];
  for (const item of json.output as Record<string, unknown>[]) {
    if (!Array.isArray(item?.content)) continue;
    for (const c of item.content as Record<string, unknown>[]) {
      if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.length ? parts.join("") : null;
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export function ledgerFromEnv(env: Record<string, string | undefined> = process.env): BudgetLedger {
  return new BudgetLedger({
    maxCalls: num(env.INTEGRITY_COPILOT_MAX_CALLS, DEFAULT_LIMITS.maxCalls),
    maxUsd: num(env.INTEGRITY_COPILOT_MAX_USD, DEFAULT_LIMITS.maxUsd),
  });
}

// Pass the server's process-wide ledger; omitting it gives a fresh one (tests, one-off scripts).
export function gatewayFromEnv(env: Record<string, string | undefined> = process.env, ledger?: BudgetLedger, cache?: ResponseCache): MetaGateway {
  return new MetaGateway({
    cache,
    // Live calls are opt-in. The narrative uses local Muse (Ollama desktop) unless
    // INTEGRITY_COPILOT_MUSE=api selects the paid Muse Spark API; the API key is only used for that or SAM.
    local: env.INTEGRITY_COPILOT_LIVE === "1",
    narrativeModel: env.INTEGRITY_COPILOT_MUSE === "api" ? "muse-spark-1.3" : "muse-glimmer",
    // The key is honoured only when a paid call is explicitly requested; by default nothing is billed.
    apiKey: env.INTEGRITY_COPILOT_LIVE === "1" && (env.INTEGRITY_COPILOT_MUSE === "api" || env.INTEGRITY_COPILOT_SAM === "live") ? env.MODEL_API_KEY : undefined,
    apiModels: [
      ...(env.INTEGRITY_COPILOT_LIVE === "1" && env.INTEGRITY_COPILOT_MUSE === "api" ? (["muse-spark-1.3"] as const) : []),
      ...(env.INTEGRITY_COPILOT_LIVE === "1" && env.INTEGRITY_COPILOT_SAM === "live" ? (["sam-3.1"] as const) : []),
    ],
    ledger: ledger ?? ledgerFromEnv(env),
  });
}
