import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { WEBRTC_CONSTRUCTORS, WEBRTC_OFF_SCRIPT } from "../lib/integrity-copilot/webrtc-off.ts";

test("WebRTC constructors become permanent throwing stubs, including computed access (the review's shape)", () => {
  const window: Record<string, unknown> = {};
  for (const k of WEBRTC_CONSTRUCTORS) window[k] = class Original {};
  const document = { defaultView: window };
  vm.runInNewContext(WEBRTC_OFF_SCRIPT, { window });
  const W = document.defaultView;
  const RTC = W["RTCPeer" + "Connection"] as new (cfg: unknown) => unknown;
  assert.throws(() => new RTC({ iceServers: [{ urls: "stun:" + "stun.example:3478" }] }), /WebRTC is disabled/);
  for (const k of WEBRTC_CONSTRUCTORS) {
    assert.throws(() => new (window[k] as new () => unknown)(), /WebRTC is disabled/, k);
    assert.throws(() => Object.defineProperty(window, k, { value: class Again {} }), TypeError, `${k} cannot be restored`);
  }
});

test("fresh same-origin windows are refused: frame-like createElement/createElementNS and window.open", () => {
  class Document {}
  (Document.prototype as any).createElement = (t: string) => ({ tag: t });
  (Document.prototype as any).createElementNS = (_ns: string, t: string) => ({ tag: t });
  const window: Record<string, unknown> = { Document, open: () => ({}) };
  vm.runInNewContext(WEBRTC_OFF_SCRIPT, { window });
  const doc = new Document() as any;
  for (const t of ["iframe", "IFRAME", "frame", "object", "embed", "fencedframe"]) {
    assert.throws(() => doc.createElement(t), /frames are disabled/, t);
  }
  assert.throws(() => doc.createElementNS("http://www.w3.org/1999/xhtml", "iframe"), /frames are disabled/);
  assert.throws(() => doc.createElementNS("x", "svg:iframe"), /frames are disabled/);
  assert.deepEqual(doc.createElement("div"), { tag: "div" });
  assert.throws(() => (window.open as () => unknown)(), /new windows are disabled/);
});

test("cross-origin top-level navigations are cancelled via the Navigation API; same-origin ones are not", () => {
  let handler: ((e: unknown) => void) | undefined;
  const window: Record<string, unknown> = { location: { origin: "http://127.0.0.1:3000" }, navigation: { addEventListener: (_t: string, h: (e: unknown) => void) => (handler = h) } };
  vm.runInNewContext(WEBRTC_OFF_SCRIPT, { window, URL });
  const fire = (url: string) => {
    let cancelled = false;
    handler!({ destination: { url }, cancelable: true, preventDefault: () => (cancelled = true) });
    return cancelled;
  };
  assert.equal(fire("http:" + "//127.0.0.1:3193/leak?d=secret"), true);
  assert.equal(fire("https://other.example/x"), true);
  assert.equal(fire("not a url"), true);
  assert.equal(fire("http://127.0.0.1:3000/api/integrity-copilot/replay"), false);
});
