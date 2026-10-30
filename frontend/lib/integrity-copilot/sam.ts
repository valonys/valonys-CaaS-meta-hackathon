// SAM 3.1 output parser (dev.meta.ai/docs/sam/reading-segmentation, read 2026-10-28).
//
// Documented grammar, one line per frame:
//   <Nf><|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..[;c=..]|><|mask;x=0;y=0[;c=..];data=H,W,<enc>payload|>, ...
// Boxes are source-pixel xyxy; every record is exactly one box then one mask; zero matches is valid.
// Frame indices are explicit and may skip. SAM returns no timestamps: callers derive time
// from container PTS or a verified constant frame rate (VisualObservation.frame_time).
//
// LIVE-VERIFIED 2026-10-30 (one synthetic image, sam-3.1 via POST /v1/responses with an inline
// data: URL, store:false): each record is prefixed by a numeric object id, e.g.
//   <0f>0<|box;x1=140;y1=60;x2=199;y2=94;w=320;h=160|><|mask;x=0;y=0;data=35,60,~<base85>|>
// The box is inclusive pixel xyxy (it matched the drawn patch exactly) and the mask was box-sized
// (35x60 = box height x width). Usage reports images_processed with zero tokens.
// Still UNVERIFIED: the base85 mask payload layout (masks stay encoded) and multi-object/video output.

export interface SamBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number; // source frame width
  h: number; // source frame height
  c?: number;
  extra: Record<string, string>;
  object_id?: number; // numeric prefix before the box (live-verified)
}

export interface SamMask {
  rows: number; // H
  cols: number; // W
  encoding: "lossless" | "one_bit";
  payload: string; // base85, undecoded
  c?: number;
  extra: Record<string, string>;
}

export interface SamFrame {
  frame_index: number;
  records: { box: SamBox; mask: SamMask }[];
}

export type SamParse = { status: "ok"; frames: SamFrame[] } | { status: "malformed"; line: number; detail: string };

// Sticky: tokens must tile the whole line (optionally separated by ", "); any leftover text is malformed.
// An optional numeric object id may precede a box (never a mask).
const TOKEN = /\s*,?\s*(\d+)?<\|(box|mask);([^|]*)\|>/y;
const BASE85 = /^[!-{}~]+$/; // printable ASCII except '|' (the token delimiter) and space

function fields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  // `data=` is last and may contain ';' inside base85, so split it off first.
  const dataAt = body.indexOf("data=");
  const head = dataAt >= 0 ? body.slice(0, dataAt) : body;
  for (const part of head.split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  if (dataAt >= 0) out.data = body.slice(dataAt + 5);
  return out;
}

function int(f: Record<string, string>, k: string): number {
  const v = f[k];
  if (v === undefined || !/^-?\d+$/.test(v)) throw new Error(`field "${k}" missing or not an integer`);
  return Number(v);
}

function conf(f: Record<string, string>): number | undefined {
  if (f.c === undefined) return undefined;
  const c = Number(f.c);
  if (!(c >= 0 && c <= 1)) throw new Error(`confidence "${f.c}" outside 0..1`);
  return c;
}

const rest = (f: Record<string, string>, known: string[]) =>
  Object.fromEntries(Object.entries(f).filter(([k]) => !known.includes(k)));

export function parseSamOutput(text: string): SamParse {
  const frames: SamFrame[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const head = /^<(\d+)f>/.exec(line);
    if (!head) return { status: "malformed", line: i, detail: "line does not start with <Nf>" };
    try {
      const body = line.slice(head[0].length);
      const tokens: { type: string; f: Record<string, string>; id?: number }[] = [];
      let end = 0; // a failed sticky exec resets lastIndex, so track consumption explicitly
      let m: RegExpExecArray | null;
      TOKEN.lastIndex = 0;
      while ((m = TOKEN.exec(body))) {
        if (m[1] !== undefined && m[2] !== "box") throw new Error("an object id may only precede a box");
        if (m[1] !== undefined && !Number.isSafeInteger(Number(m[1]))) throw new Error(`object id ${m[1].slice(0, 24)} is not a safe integer`);
        tokens.push({ type: m[2], f: fields(m[3]), id: m[1] === undefined ? undefined : Number(m[1]) });
        end = TOKEN.lastIndex;
      }
      if (body.slice(end).trim()) throw new Error(`unparsed text at column ${head[0].length + end}`);
      if (tokens.length % 2 !== 0) throw new Error("box/mask tokens are not paired");
      const records: SamFrame["records"] = [];
      for (let t = 0; t < tokens.length; t += 2) {
        const [b, m] = [tokens[t], tokens[t + 1]];
        if (b.type !== "box" || m.type !== "mask") throw new Error("record must be box then mask");
        const box: SamBox = {
          x1: int(b.f, "x1"), y1: int(b.f, "y1"), x2: int(b.f, "x2"), y2: int(b.f, "y2"),
          w: int(b.f, "w"), h: int(b.f, "h"), c: conf(b.f),
          extra: rest(b.f, ["x1", "y1", "x2", "y2", "w", "h", "c"]),
          ...(b.id === undefined ? {} : { object_id: b.id }),
        };
        // Inclusive pixel xyxy (live-verified): the last valid column/row is w-1/h-1.
        if (!(box.w > 0 && box.h > 0 && box.x1 >= 0 && box.y1 >= 0 && box.x1 <= box.x2 && box.y1 <= box.y2 && box.x2 < box.w && box.y2 < box.h)) {
          throw new Error(`box outside frame or inverted: ${JSON.stringify(box)}`);
        }
        const data = /^(\d+),(\d+),(.)([\s\S]*)$/.exec(m.f.data ?? "");
        if (!data) throw new Error("mask data must be H,W,<enc>payload");
        if (!(Number(data[1]) > 0 && Number(data[2]) > 0)) throw new Error("mask dimensions must be positive");
        if (data[3] !== "~" && data[3] !== "!") throw new Error(`unknown mask encoding "${data[3]}"`);
        if (!BASE85.test(data[4])) throw new Error("mask payload must be non-empty base85");
        const mask: SamMask = {
          rows: Number(data[1]),
          cols: Number(data[2]),
          encoding: data[3] === "~" ? "lossless" : "one_bit",
          payload: data[4],
          c: conf(m.f),
          extra: rest(m.f, ["data", "c"]),
        };
        records.push({ box, mask });
      }
      frames.push({ frame_index: Number(head[1]), records });
    } catch (e) {
      return { status: "malformed", line: i, detail: (e as Error).message };
    }
  }
  return { status: "ok", frames };
}

// Time for a frame from a verified constant frame rate. Prefer container PTS when available.
export function frameTimeFromVerifiedCfr(frameIndex: number, fps: number, timebase: string) {
  if (!(Number.isInteger(frameIndex) && frameIndex >= 0) || !(fps > 0)) throw new Error("invalid frame index or fps");
  return { seconds: frameIndex / fps, derivation: "verified_cfr" as const, timebase };
}
