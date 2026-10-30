// Visual evidence for the workbench: SAM 3.1 regions over an inspection image.
//
// - Live mode (gateway configured): one sam-3.1 call through the audited gateway (cached per process).
// - Otherwise: the RECORDED real sam-3.1 output, labelled origin "recorded", never passed off as live.
// - Regions mark where the prompt matched. They are not evidence of corrosion type, depth or wall
//   thickness, and no number here feeds the deterministic rate/life/date calculation.

import { parseSamOutput } from "./sam.ts";
import type { MetaGateway } from "./gateway.ts";

export interface VisualRegion {
  object_id?: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface VisualEvidence {
  image_src: string; // public path for display
  image_ref: string; // evidence id
  prompt: string;
  origin: "live" | "recorded";
  recorded_at?: string;
  basis: "model_inferred";
  model: "sam-3.1";
  status: "ok" | "unavailable" | "error";
  detail?: string;
  frame: { w: number; h: number } | null;
  regions: VisualRegion[];
  note: string;
}

export interface VisualSource {
  image_src: string;
  image_ref: string;
  image_data_url: string;
  prompt: string;
  recorded: { output: string; recorded_at: string };
}

const NOTE = "Segmentation marks where the prompt matched. It is not evidence of corrosion type, depth or wall thickness.";

export async function visualEvidence(gateway: MetaGateway, src: VisualSource): Promise<VisualEvidence> {
  const base = { image_src: src.image_src, image_ref: src.image_ref, prompt: src.prompt, basis: "model_inferred" as const, model: "sam-3.1" as const, note: NOTE };
  let origin: VisualEvidence["origin"] = "recorded";
  let text = src.recorded.output;
  if (gateway.canServe("sam-3.1")) {
    const r = await gateway.respond({
      model: "sam-3.1",
      images: 1,
      evidence_ids: [src.image_ref],
      input: [{ role: "user", content: [{ type: "input_text", text: src.prompt }, { type: "input_image", image_url: src.image_data_url }] }],
    });
    if (r.status !== "ok") return { ...base, origin: "live", status: r.status, detail: `${r.reason}: ${r.detail}`, frame: null, regions: [] };
    origin = "live";
    text = r.text;
  }
  const parsed = parseSamOutput(text);
  const recordedAt = origin === "recorded" ? { recorded_at: src.recorded.recorded_at } : {};
  if (parsed.status !== "ok") return { ...base, origin, ...recordedAt, status: "error", detail: `malformed SAM output: ${parsed.detail}`, frame: null, regions: [] };
  const records = parsed.frames.flatMap((f) => f.records);
  const frame = records[0] ? { w: records[0].box.w, h: records[0].box.h } : null;
  return {
    ...base,
    origin,
    ...recordedAt,
    status: "ok",
    frame,
    regions: records.map(({ box }) => ({ ...(box.object_id === undefined ? {} : { object_id: box.object_id }), x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 })),
  };
}
