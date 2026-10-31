import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { scanProviderBoundary } from "../scripts/provider-guard.ts";

function fixture(source: string, dependencies: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "provider-guard-"));
  mkdirSync(join(root, "lib/integrity-copilot"), { recursive: true });
  mkdirSync(join(root, "app/api/integrity-copilot"), { recursive: true });
  writeFileSync(join(root, "lib/integrity-copilot/index.ts"), source);
  writeFileSync(join(root, "app/api/integrity-copilot/route.ts"), 'import "@/lib/integrity-copilot/index";');
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages: Object.fromEntries(Object.keys(dependencies).map((name) => [`node_modules/${name}`, {}])) }));
  return root;
}

test("current Integrity Copilot source import graph is Meta-only", () => {
  const root = new URL("..", import.meta.url).pathname;
  const report = scanProviderBoundary({ frontendRoot: root });
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.ok(report.reachableFiles.some((path) => path.endsWith("gateway.ts")));
  assert.ok(report.reachableFiles.some((path) => path.includes("app/api/integrity-copilot")));
});

test("guard rejects a legacy import and any non-allowlisted endpoint", (t) => {
  const root = fixture('import "@/lib/agent-runtime";\nconst endpoint = "https://api.example-llm.com/v1";');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const report = scanProviderBoundary({ frontendRoot: root });
  assert.equal(report.ok, false);
  assert.ok(report.moduleViolations.some((line) => line.includes("escapes Integrity Copilot boundary")));
  assert.ok(report.moduleViolations.some((line) => line.includes("outbound host not allowlisted: api.example-llm.com")));
});

test("release guard checks manifests, lockfile and requires built route output", (t) => {
  const root = fixture("export const ok = true;", { "@example/genai": "1.0.0" });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const report = scanProviderBoundary({ frontendRoot: root, includeRelease: true, buildRequired: true });
  assert.equal(report.ok, false);
  assert.ok(report.manifestViolations.some((line) => line.startsWith("package.json")));
  assert.ok(report.manifestViolations.some((line) => line.startsWith("package-lock.json")));
  assert.deepEqual(report.buildViolations, [".next: Integrity Copilot build output is missing"]);
});

test("guard allows only the Meta API and loopback local Muse hosts", (t) => {
  const root = fixture('const a = "https://api.meta.ai/v1";\nconst b = "http://127.0.0.1:11434/api/chat";\nconst c = "http://127.0.0.1:8080/v1";');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const report = scanProviderBoundary({ frontendRoot: root });
  assert.deepEqual(report.moduleViolations, ["lib/integrity-copilot/index.ts: outbound host not allowlisted: 127.0.0.1:8080"]);
});

// C-019 P1: constructed URLs and other egress outside the gateway are rejected.
const MIN_GATEWAY = 'export const META_BASE_URL = "https://api.meta.ai/v1";\nexport const LOCAL_MUSE_URL = "http://127.0.0.1:11434/api/chat";';
function appFixture(page: string, gateway = MIN_GATEWAY) {
  const root = fixture('import "@/lib/integrity-copilot/gateway";');
  writeFileSync(join(root, "lib/integrity-copilot/gateway.ts"), gateway);
  mkdirSync(join(root, "app"), { recursive: true });
  writeFileSync(join(root, "app/page.tsx"), page);
  return root;
}
test("C-019/C-020 guard: egress outside the gateway is rejected, however it is spelled", (t) => {
  const cases = [
    'export async function x() { await fetch("https:" + "//non-meta.example/v1/infer"); }', // the review's C-019 input
    'export async function x() { await globalThis.fetch("https:" + "//non-meta.example/v1/infer"); }'.replace("f", "\\u0066"), // C-020 input: escaped identifier
    "export async function x(base: string) { await fetch(`${base}/v1/infer`); }",
    "const f = fetch; export async function x() { await f('/ok'); }",
    'export async function x() { await (fetch)("https://h.example"); }',
    'export async function x() { await globalThis["fe" + "tch"]("/x"); }',
    'export async function x() { await window.fetch("/x"); }',
    'export async function x(o: any) { await o["fetch"]("https://h.example"); }',
    'export function x() { return new WebSocket("wss://" + "h.example"); }',
    "export function x(u: string) { return import(u); }",
    'export function x() { return eval("1"); }',
    'export function x() { return new Function("return 1"); }',
  ];
  for (const page of cases) {
    const root = appFixture(page);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const report = scanProviderBoundary({ frontendRoot: root });
    assert.ok(report.moduleViolations.some((v) => v.startsWith("app/page.tsx:") && v.includes("network egress rule")), `${page}\n${JSON.stringify(report.moduleViolations)}`);
  }
  const ok = appFixture('export async function x() { await fetch("/api/integrity-copilot/replay", { method: "GET" }); }');
  t.after(() => rmSync(ok, { recursive: true, force: true }));
  assert.deepEqual(scanProviderBoundary({ frontendRoot: ok }).moduleViolations, []);
});

test("C-019/C-020 guard: the gateway may only call fetchImpl with its fixed Meta URL constants", (t) => {
  const good = 'const META_BASE_URL = "https://api.meta.ai/v1"; const LOCAL_MUSE_URL = "http://127.0.0.1:11434/api/chat";\nexport async function g(cfg: { fetchImpl?: typeof fetch }) { const fetchImpl = cfg.fetchImpl ?? fetch; await fetchImpl(`${META_BASE_URL}/responses`, {}); await fetchImpl(LOCAL_MUSE_URL, {}); }';
  const okRoot = appFixture("export {};", good);
  t.after(() => rmSync(okRoot, { recursive: true, force: true }));
  assert.deepEqual(scanProviderBoundary({ frontendRoot: okRoot }).moduleViolations, []);
  for (const body of [
    'export async function g(fetchImpl: typeof fetch, url: string) { return (fetchImpl)(url, {}); }', // C-020 input
    'export async function g(fetchImpl: typeof fetch) { await fetchImpl("https:" + "//other.example", {}); }',
    'export async function g(fetchImpl: typeof fetch) { const f = fetchImpl; await f("https://other.example"); }',
    'export async function g() { await fetch("https://other.example"); }',
    'export async function g(fetchImpl: typeof fetch) { await fetchImpl.call(null, "https://other.example"); }',
  ]) {
    const root = appFixture("export {};", body);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const v = scanProviderBoundary({ frontendRoot: root }).moduleViolations;
    assert.ok(v.some((x) => x.startsWith("lib/integrity-copilot/gateway.ts:") && x.includes("network egress rule")), `${body}\n${JSON.stringify(v)}`);
  }
});

test("C-021 guard: no other Node transport or native code can be obtained", (t) => {
  for (const page of [
    'const h = process.getBuiltinModule("node:" + "http");\nexport function x(port: number) { return h.get("http:" + "//127.0.0.1:" + port + "/probe"); }', // the review's exact input
    'export function x() { return (process as any).binding("tcp_wrap"); }',
    'export function x() { return process["getBuiltin" + "Module"]("node:net"); }',
    "export function x() { const p = process; return p; }",
    'import { createRequire } from "node:module";\nexport const r = createRequire("/");',
    'import net from "node:net";\nexport const s = net;',
  ]) {
    const root = appFixture(page);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const v = scanProviderBoundary({ frontendRoot: root }).moduleViolations;
    assert.ok(v.some((x) => x.startsWith("app/page.tsx")), `${page}\n${JSON.stringify(v)}`);
  }
  const ok = appFixture('export const e = process.env.X; export const c = process.cwd(); export const p = process.pid;');
  t.after(() => rmSync(ok, { recursive: true, force: true }));
  assert.deepEqual(scanProviderBoundary({ frontendRoot: ok }).moduleViolations, []);
});

test("C-021 guard: gateway endpoint constants are exact, declared once, and cannot be shadowed", (t) => {
  const good = 'export const META_BASE_URL = "https://api.meta.ai/v1";\nexport const LOCAL_MUSE_URL = "http://127.0.0.1:11434/api/chat";\nexport async function g(cfg: { fetchImpl?: typeof fetch }) { const fetchImpl = cfg.fetchImpl ?? fetch; await fetchImpl(LOCAL_MUSE_URL, {}); }';
  const okRoot = appFixture("export {};", good);
  t.after(() => rmSync(okRoot, { recursive: true, force: true }));
  assert.deepEqual(scanProviderBoundary({ frontendRoot: okRoot }).moduleViolations, []);
  for (const body of [
    good.replace("export async function g(cfg", 'export async function g(cfg').replace("{ const fetchImpl", '{ const LOCAL_MUSE_URL = "https:" + "//non-meta.example/v1"; const fetchImpl'), // the review's shadow
    good.replace('"http://127.0.0.1:11434/api/chat"', '"http://127.0.0.1:8080/api/chat"'),
    good.replace('export const META_BASE_URL = "https://api.meta.ai/v1";\n', 'export let META_BASE_URL = "https://api.meta.ai/v1";\n'),
    good.replace("export async function g(cfg: {", "export async function g(LOCAL_MUSE_URL: string, cfg: {"),
  ]) {
    const root = appFixture("export {};", body);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const v = scanProviderBoundary({ frontendRoot: root }).moduleViolations;
    assert.ok(v.some((x) => x.includes("must be declared once, top level")), `${body}\n${JSON.stringify(v)}`);
  }
});

test("C-022 guard: every import is checked from the syntax tree, whatever its spelling", (t) => {
  for (const page of [
    // the review's exact inputs
    'export async function udpProbe(port: number): Promise<void> {\n  const dgram = await import(`node:dgram`);\n  const socket = dgram.createSocket("udp4");\n  socket.send(Buffer.from("udp-reached"), port, "127.0.0.1");\n}',
    'export async function x() { const cp = await import(`node:child_process`); cp.execFile("curl", ["http:" + "//non-allowlisted.example/"]); }',
    'export async function x() { return import("node:worker_threads"); }',
    'export * from "node:http2";',
    'export { lookup } from "node:dns";',
    'import * as cp from "node:child_process";\nexport const c = cp;',
    'export async function x(n: string) { return import(`node:${n}`); }',
  ]) {
    const root = appFixture(page);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const v = scanProviderBoundary({ frontendRoot: root }).moduleViolations;
    assert.ok(v.some((x) => x.startsWith("app/page.tsx")), `${page}\n${JSON.stringify(v)}`);
  }
  const ok = appFixture('import type { Socket } from "node:net";\nexport type S = Socket;\nexport const r = await import(`react`);');
  t.after(() => rmSync(ok, { recursive: true, force: true }));
  assert.deepEqual(scanProviderBoundary({ frontendRoot: ok }).moduleViolations, []);
});

test("C-023 guard: .jsx entry points are scanned; WebRTC and reflective constructor paths are rejected", (t) => {
  // .jsx page with the C-022 import (the review's input)
  const jsx = fixture('export const ok = true;');
  writeFileSync(join(jsx, "lib/integrity-copilot/gateway.ts"), MIN_GATEWAY);
  mkdirSync(join(jsx, "app"), { recursive: true });
  writeFileSync(join(jsx, "app/page.jsx"), 'export default function P() { import("node:dgram"); return <div />; }');
  t.after(() => rmSync(jsx, { recursive: true, force: true }));
  const r = scanProviderBoundary({ frontendRoot: jsx });
  assert.ok(r.reachableFiles.includes("app/page.jsx"), JSON.stringify(r.reachableFiles));
  assert.ok(r.moduleViolations.some((v) => v.startsWith("app/page.jsx")), JSON.stringify(r.moduleViolations));
  for (const page of [
    // the review's exact Function-constructor input
    'export function x(port: number) {\n  const p = (() => {}).constructor("return " + "process")();\n  const load = p["getBuiltin" + "Module"];\n  const dgram = load("node:" + "dgram");\n  dgram.createSocket("udp4").send(Buffer.from("udp-reached"), port, "127.0.0.1");\n}',
    // the review's WebRTC shape
    'export async function x() { const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:" + "stun.example:3478" }] }); pc.createDataChannel("d"); await pc.setLocalDescription(await pc.createOffer()); }',
    'export function x(f: () => void) { return Object.getPrototypeOf(f); }',
    'export function x() { return Reflect.ownKeys({}); }',
  ]) {
    const root = appFixture(page);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const v = scanProviderBoundary({ frontendRoot: root }).moduleViolations;
    assert.ok(v.some((x) => x.startsWith("app/page.tsx")), `${page}\n${JSON.stringify(v)}`);
  }
});

test("C-025 guard: browser navigation globals are rejected; record keys named location are fine", (t) => {
  for (const page of [
    'export function x(port: number) {\n  location.assign("http:" + "//127.0.0.1:" + port + "/leak?d=secret");\n}', // the review's exact input
    'export function x() { document.location = "http://h.example"; }',
    "export function x() { return history.length; }",
    'export function x() { navigation.navigate("http://h.example"); }',
  ]) {
    const root = appFixture(page);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const v = scanProviderBoundary({ frontendRoot: root }).moduleViolations;
    assert.ok(v.some((x) => x.startsWith("app/page.tsx") && x.includes("navigation")), `${page}\n${JSON.stringify(v)}`);
  }
  const ok = appFixture("export function x(r: { location: string }) { const o = { location: r.location }; return o.location; }");
  t.after(() => rmSync(ok, { recursive: true, force: true }));
  assert.deepEqual(scanProviderBoundary({ frontendRoot: ok }).moduleViolations, []);
});
