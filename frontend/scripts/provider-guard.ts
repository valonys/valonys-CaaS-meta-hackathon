import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"];
// The whole app is the hackathon artifact: every page and route is an entry point (C-004 P1).
const ENTRY_ROOTS = ["lib/integrity-copilot", "app"];
// node:fs/node:path: durable decision store only (no network surface).
const ALLOWED_EXTERNAL_IMPORTS = new Set(["next", "next/server", "react", "node:crypto", "node:fs", "node:path"]);
// The only API surface the release may expose.
const ALLOWED_API_PREFIX = "api/integrity-copilot";

// Allowlist, not denylist: the only outbound inference hosts the runtime may contain.
// api.meta.ai = Meta Model API; 127.0.0.1:11434 = local Meta Muse via the Ollama desktop runtime on
// loopback (the gateway only sends LOCAL_MODELS there).
const ALLOWED_HOSTS = new Set(["api.meta.ai", "127.0.0.1:11434"]);
// Build output also contains framework documentation links, so there only inference-style hosts
// (api.*, *inference*, *generative*, *llm*) are checked against the allowlist.
const INFERENCE_HOST = /^(?:api\.|[^/]*(?:inference|generative|llm))/i;
const ALLOWED_DEPENDENCIES = new Set(["next", "react", "react-dom"]);
const ALLOWED_DEV_DEPENDENCIES = new Set(["@types/node", "@types/react", "autoprefixer", "postcss", "tailwindcss", "typescript"]);
// Generic AI-SDK package shapes that must never be installed, without naming vendors.
const AI_PACKAGE = /(?:^|[/-])(?:ai|llm|genai|inference|generative-ai)(?:[/-]|$)/i;
const URL_HOST = /\bhttps?:\/\/([A-Za-z0-9.-]+(?::\d+)?)/g;

export interface GuardOptions {
  frontendRoot: string;
  includeRelease?: boolean;
  buildRequired?: boolean;
}

export interface GuardReport {
  reachableFiles: string[];
  moduleViolations: string[];
  manifestViolations: string[];
  buildViolations: string[];
  ok: boolean;
}

function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (SOURCE_EXTENSIONS.includes(extname(path))) out.push(resolve(path));
  }
  return out;
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.push(match[1]);
  }
  return specs;
}

function resolveLocalImport(frontendRoot: string, from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = resolve(frontendRoot, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null;

  const candidates = extname(base)
    ? [base]
    : [...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`), ...SOURCE_EXTENSIONS.map((ext) => join(base, `index${ext}`))];
  return candidates.find((candidate) => existsSync(candidate)) ?? base;
}

function inside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

// Runtime source: every URL host must be allowlisted.
function scanText(path: string, text: string, violations: string[]): void {
  for (const m of text.matchAll(URL_HOST)) {
    if (!ALLOWED_HOSTS.has(m[1].toLowerCase())) violations.push(`${path}: outbound host not allowlisted: ${m[1]}`);
  }
}

// Build output: inference-style hosts must be allowlisted.
function scanBuiltText(path: string, text: string, violations: string[]): void {
  for (const m of text.matchAll(URL_HOST)) {
    const host = m[1].toLowerCase();
    if (INFERENCE_HOST.test(host) && !ALLOWED_HOSTS.has(host)) violations.push(`${path}: inference host not allowlisted: ${host}`);
  }
}

function scanModule(frontendRoot: string): { reachableFiles: string[]; violations: string[] } {
  const allowedRoots = ENTRY_ROOTS.map((root) => resolve(frontendRoot, root));
  const queue = allowedRoots.flatMap(filesUnder);
  const seen = new Set<string>();
  const violations: string[] = [];

  while (queue.length) {
    const path = resolve(queue.shift()!);
    if (seen.has(path)) continue;
    seen.add(path);
    if (!existsSync(path)) {
      violations.push(`${relative(frontendRoot, path)}: unresolved local import`);
      continue;
    }
    const text = readFileSync(path, "utf8");
    const rel = relative(frontendRoot, path);
    scanText(rel, text, violations);
    if (extname(path) === ".json") continue;

    for (const specifier of importSpecifiers(text)) {
      const local = resolveLocalImport(frontendRoot, path, specifier);
      if (local) {
        if (!allowedRoots.some((root) => inside(local, root))) {
          violations.push(`${rel}: import escapes Integrity Copilot boundary: ${specifier}`);
        } else {
          queue.push(local);
        }
      } else if (!ALLOWED_EXTERNAL_IMPORTS.has(specifier)) {
        violations.push(`${rel}: external import is not allowlisted: ${specifier}`);
      }
    }
  }
  return { reachableFiles: [...seen].map((path) => relative(frontendRoot, path)).sort(), violations };
}

function scanManifest(frontendRoot: string): string[] {
  const violations: string[] = [];
  const packagePath = join(frontendRoot, "package.json");
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as Record<string, Record<string, string> | undefined>;
  const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  void declared;
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (!ALLOWED_DEPENDENCIES.has(name)) violations.push(`package.json: runtime dependency not allowlisted: ${name}`);
  }
  for (const name of Object.keys({ ...pkg.devDependencies, ...pkg.optionalDependencies })) {
    if (!ALLOWED_DEV_DEPENDENCIES.has(name)) violations.push(`package.json: dev dependency not allowlisted: ${name}`);
  }

  const lockPath = join(frontendRoot, "package-lock.json");
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { packages?: Record<string, unknown> };
    for (const key of Object.keys(lock.packages ?? {})) {
      const name = key.replace(/^.*node_modules\//, "");
      if (key && AI_PACKAGE.test(name)) violations.push(`package-lock.json: AI SDK-shaped package not allowed: ${name}`);
    }
  }
  return violations;
}

// Every API route.ts under app/ (source) or route.js under .next/server/app (build), as "api/...".
function apiRoutes(root: string, file: RegExp): string[] {
  return filesUnder(join(root, "api"))
    .filter((path) => file.test(path))
    .map((path) => relative(root, dirname(path)).split(sep).join("/"));
}

function scanRoutes(frontendRoot: string): string[] {
  return apiRoutes(join(frontendRoot, "app"), /[\\/]route\.(ts|tsx|js)$/)
    .filter((route) => route !== ALLOWED_API_PREFIX && !route.startsWith(`${ALLOWED_API_PREFIX}/`))
    .map((route) => `app/${route}: API route outside the Integrity Copilot surface`);
}

function scanBuild(frontendRoot: string, required: boolean): string[] {
  const serverApp = join(frontendRoot, ".next/server/app");
  const files = [...filesUnder(join(frontendRoot, ".next/server")), ...filesUnder(join(frontendRoot, ".next/static/chunks"))];
  const copilotBuilt = files.some((path) => inside(path, join(serverApp, ALLOWED_API_PREFIX)));
  if (!copilotBuilt) return required ? [".next: Integrity Copilot build output is missing"] : [];
  const violations: string[] = [];
  for (const path of files) scanBuiltText(relative(frontendRoot, path), readFileSync(path, "utf8"), violations);
  for (const route of apiRoutes(serverApp, /[\\/]route\.js$/)) {
    if (route !== ALLOWED_API_PREFIX && !route.startsWith(`${ALLOWED_API_PREFIX}/`)) violations.push(`.next/server/app/${route}: built API route outside the Integrity Copilot surface`);
  }
  return violations;
}

export function scanProviderBoundary(options: GuardOptions): GuardReport {
  const frontendRoot = resolve(options.frontendRoot);
  const module = scanModule(frontendRoot);
  module.violations.push(...scanRoutes(frontendRoot));
  const manifestViolations = options.includeRelease ? scanManifest(frontendRoot) : [];
  const buildViolations = options.includeRelease ? scanBuild(frontendRoot, options.buildRequired ?? false) : [];
  return {
    reachableFiles: module.reachableFiles,
    moduleViolations: module.violations,
    manifestViolations,
    buildViolations,
    ok: module.violations.length + manifestViolations.length + buildViolations.length === 0,
  };
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const frontendRoot = resolve(here, "..");
  const release = process.argv.includes("--release");
  const report = scanProviderBoundary({ frontendRoot, includeRelease: release, buildRequired: release });
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.ok, true, `provider guard failed with ${report.moduleViolations.length + report.manifestViolations.length + report.buildViolations.length} violation(s)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
