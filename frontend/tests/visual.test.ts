import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MetaGateway } from "../lib/integrity-copilot/gateway.ts";
import { visualEvidence, type VisualSource } from "../lib/integrity-copilot/visual.ts";

const recorded = JSON.parse(readFileSync(new URL("../lib/integrity-copilot/fixtures/sam-recorded.json", import.meta.url), "utf8"));
const src: VisualSource = {
  image_src: "/evidence/synthetic-pipe.png",
  image_ref: recorded.image_ref,
  image_data_url: "data:image/png;base64," + readFileSync(new URL("../public/evidence/synthetic-pipe.png", import.meta.url)).toString("base64"),
  prompt: recorded.prompt,
  recorded: { output: recorded.output, recorded_at: recorded.recorded_at },
};
const samResponse = (text: string) =>
  new Response(JSON.stringify({ status: "completed", model: "sam-3.1", store: false, output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 0, output_tokens: 0, images_processed: 1 } }), { status: 200 });

test("visual: no key -> the RECORDED live SAM output, labelled recorded, box on the drawn patch", async () => {
  const v = await visualEvidence(new MetaGateway({}), src);
  assert.equal(v.origin, "recorded");
  assert.equal(v.recorded_at, "2026-10-30");
  assert.equal(v.status, "ok");
  assert.deepEqual(v.frame, { w: 320, h: 160 });
  assert.deepEqual(v.regions, [{ object_id: 0, x1: 140, y1: 60, x2: 199, y2: 94 }]);
  assert.equal(v.basis, "model_inferred");
  assert.match(v.note, /not evidence of corrosion type, depth or wall thickness/);
});

test("visual: live -> one sam-3.1 call with the image, labelled live, no recorded_at", async () => {
  const bodies: any[] = [];
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return samResponse("<0f>3<|box;x1=10;y1=20;x2=29;y2=39;w=320;h=160|><|mask;x=0;y=0;data=20,20,~abc|>");
  }) as unknown as typeof fetch;
  const v = await visualEvidence(new MetaGateway({ apiKey: "k", fetchImpl }), src);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].model, "sam-3.1");
  assert.equal(bodies[0].store, false);
  assert.equal(bodies[0].reasoning, undefined);
  assert.equal(bodies[0].input[0].content[1].type, "input_image");
  assert.ok(bodies[0].input[0].content[1].image_url.startsWith("data:image/png;base64,"));
  assert.equal(v.origin, "live");
  assert.equal(v.recorded_at, undefined);
  assert.deepEqual(v.regions, [{ object_id: 3, x1: 10, y1: 20, x2: 29, y2: 39 }]);
});

test("visual: live failure or malformed output -> explicit status, no regions, never the recorded result", async () => {
  const fail = (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
  const v1 = await visualEvidence(new MetaGateway({ apiKey: "k", fetchImpl: fail, retries: 0 }), src);
  assert.equal(v1.origin, "live");
  assert.equal(v1.status, "error");
  assert.deepEqual(v1.regions, []);
  const bad = (async () => samResponse("<0f>garbage")) as unknown as typeof fetch;
  const v2 = await visualEvidence(new MetaGateway({ apiKey: "k", fetchImpl: bad }), src);
  assert.equal(v2.status, "error");
  assert.match(v2.detail ?? "", /malformed SAM output/);
  assert.deepEqual(v2.regions, []);
});
