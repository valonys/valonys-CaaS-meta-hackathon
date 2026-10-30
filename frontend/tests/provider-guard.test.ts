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
