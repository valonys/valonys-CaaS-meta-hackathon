import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
// The whole app is the hackathon artifact: every page and route is an entry point (C-004 P1).
const ENTRY_ROOTS = ["lib/integrity-copilot", "app", "instrumentation.ts"];
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
// Network egress rule (C-019/C-020 P1), checked on the parsed syntax tree (so Unicode escapes,
// parentheses and comments cannot hide anything). Positive rule:
//  - outside gateway.ts, a network name may appear only as `fetch("/same-origin-path", ...)`;
//  - in gateway.ts, network calls are only `fetchImpl(`${META_BASE_URL}...`)` or `fetchImpl(LOCAL_MUSE_URL)`;
//  - globals (globalThis/window/self/global) only in server.ts as `globalThis as <type>` for process
//    singletons, and that alias may not be indexed with a computed key;
//  - no eval/Function/require, no non-literal dynamic import, no parenthesized or indirect callees.
// The runtime layer (lib/integrity-copilot/egress.ts + the CSP header) is the actual boundary; this
// static rule keeps the source honest.
const GATEWAY_FILE = "lib/integrity-copilot/gateway.ts";
const GLOBALS_FILES = new Set(["lib/integrity-copilot/server.ts", "lib/integrity-copilot/egress.ts"]);
const NETWORK_NAMES = new Set([
  "fetch", "fetchImpl", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "importScripts", "eval", "Function", "require",
  // ways to obtain another Node transport or native code (C-021 P1)
  "getBuiltinModule", "binding", "_linkedBinding", "dlopen", "createRequire", "__non_webpack_require__", "module",
  // browser peer-to-peer transport (not governed by CSP connect-src) (C-023 P1)
  "RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCIceTransport",
  // reflective paths to constructors/code generation (C-023 P1)
  "constructor", "__proto__", "getPrototypeOf", "setPrototypeOf", "Reflect", "Proxy",
]);
// Browser top-level navigation globals (C-025 P1): flagged as free references or as document.<name>,
// not as keys/properties of our own records (e.g. { location: register entry }).
const NAV_NAMES = new Set(["location", "navigation", "history"]);
// `process` may only be used for these properties.
const PROCESS_PROPS = new Set(["env", "cwd", "pid"]);
// Per-file extra import allowance: only the egress module may load node:net (to install the socket allowlist).
const FILE_IMPORTS: Record<string, Set<string>> = {
  "lib/integrity-copilot/egress.ts": new Set(["node:net", "node:dgram", "node:child_process", "node:worker_threads", "node:module", "node:dns", "node:dns/promises"]),
};
// The gateway's two fixed endpoints: each declared exactly once, top level, with exactly this value.
const GATEWAY_CONSTANTS: Record<string, string> = { META_BASE_URL: "https://api.meta.ai/v1", LOCAL_MUSE_URL: "http://127.0.0.1:11434/api/chat" };
const GLOBAL_NAMES = new Set(["globalThis", "window", "self", "global"]);

function scanEgress(path: string, text: string, violations: string[]): void {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, /\.(tsx|jsx|js)$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const gateway = path === GATEWAY_FILE;
  const globalAliases = new Set<string>();
  const flag = (node: ts.Node, why: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    violations.push(`${path}:${line + 1}: network egress rule (${why})`);
  };
  const literalText = (n: ts.Node | undefined) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined);

  // Is this identifier occurrence an allowed use?
  const allowed = (id: ts.Identifier): boolean => {
    const name = id.text; // unescaped
    const parent = id.parent;
    if (ts.isTypeQueryNode(parent) || ts.isTypeReferenceNode(parent) || ts.isQualifiedName(parent)) return name === "fetch" && gateway; // `typeof fetch`
    // egress.ts may only touch `globalThis.fetch` (to wrap it with the runtime allowlist).
    if (path === "lib/integrity-copilot/egress.ts") {
      return name === "fetch" && ts.isPropertyAccessExpression(parent) && parent.name === id && ts.isIdentifier(parent.expression) && parent.expression.text === "globalThis";
    }
    if (!gateway) {
      if (name !== "fetch") return false;
      return ts.isCallExpression(parent) && parent.expression === id && (literalText(parent.arguments[0]) ?? "").startsWith("/");
    }
    // gateway.ts
    if (name === "fetchImpl") {
      if ((ts.isPropertySignature(parent) || ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) && parent.name === id) return true; // config field
      if (ts.isPropertyAccessExpression(parent) && parent.name === id) return true; // this.cfg.fetchImpl
      if (ts.isVariableDeclaration(parent) && parent.name === id) return true; // const fetchImpl = ...
      if (ts.isCallExpression(parent) && parent.expression === id) {
        const a = parent.arguments[0];
        if (a && ts.isIdentifier(a) && a.text === "LOCAL_MUSE_URL") return true;
        if (a && ts.isTemplateExpression(a) && a.head.text === "" && ts.isIdentifier(a.templateSpans[0]?.expression) && a.templateSpans[0].expression.text === "META_BASE_URL") return true;
        return false;
      }
      return false;
    }
    if (name === "fetch") {
      // only `this.cfg.fetchImpl ?? fetch` as a default value, and `typeof fetch` (handled above)
      return ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && parent.right === id;
    }
    return false;
  };

  // Type positions are erased before runtime: identifiers inside them cannot reach the network.
  const inType = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isTypeNode(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) return true;
      if (ts.isStatement(p) || ts.isSourceFile(p)) return false;
    }
    return false;
  };

  // Gateway endpoint constants: exactly one top-level `const NAME = "<exact value>"`, never shadowed.
  if (gateway) {
    const decls = new Map<string, ts.Node[]>();
    const collect = (n: ts.Node): void => {
      const named = (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name && ts.isIdentifier(n.name) ? n.name.text : undefined;
      if (named && named in GATEWAY_CONSTANTS) decls.set(named, [...(decls.get(named) ?? []), n]);
      ts.forEachChild(n, collect);
    };
    collect(sf);
    for (const [name, value] of Object.entries(GATEWAY_CONSTANTS)) {
      const found = decls.get(name) ?? [];
      const d = found[0];
      const exact =
        found.length === 1 && ts.isVariableDeclaration(d) && ts.isVariableDeclarationList(d.parent) && (d.parent.flags & ts.NodeFlags.Const) !== 0 &&
        ts.isVariableStatement(d.parent.parent) && d.parent.parent.parent === sf && d.initializer !== undefined && ts.isStringLiteral(d.initializer) && d.initializer.text === value;
      if (!exact) violations.push(`${path}: network egress rule (${name} must be declared once, top level, as const "${value}"; found ${found.length})`);
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !inType(node) && node.text === "process") {
      const p = node.parent;
      const isOwnPropertyName = ts.isPropertyAccessExpression(p) && p.name === node;
      const okProcess = ts.isPropertyAccessExpression(p) && p.expression === node && PROCESS_PROPS.has(p.name.text);
      if (!isOwnPropertyName && !okProcess) flag(node, `"process" beyond ${[...PROCESS_PROPS].join("/")}`);
    }
    if (ts.isIdentifier(node) && !inType(node) && NAV_NAMES.has(node.text)) {
      const p = node.parent;
      const isKeyOrMember =
        (ts.isPropertyAccessExpression(p) && p.name === node && !(ts.isIdentifier(p.expression) && p.expression.text === "document")) ||
        ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p)) && p.name === node) ||
        (ts.isBindingElement(p) && p.propertyName === node);
      if (!isKeyOrMember) flag(node, `browser navigation "${node.text}"`);
    }
    if (ts.isIdentifier(node) && !inType(node)) {
      const name = node.text;
      if (NETWORK_NAMES.has(name) && !allowed(node)) flag(node, `"${name}" outside the allowed call forms`);
      if (GLOBAL_NAMES.has(name)) {
        const p = node.parent;
        const okGlobal = GLOBALS_FILES.has(path) && ((ts.isAsExpression(p) && p.expression === node) || (path.endsWith("egress.ts") && ts.isPropertyAccessExpression(p) && p.expression === node && p.name.text === "fetch"));
        if (!okGlobal) flag(node, `global "${name}"`);
        else if (ts.isAsExpression(p) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) globalAliases.add(p.parent.name.text);
      }
    }
    if (ts.isParenthesizedExpression(node) && ts.isCallExpression(node.parent) && node.parent.expression === node) flag(node, "parenthesized callee");
    if (ts.isElementAccessExpression(node)) {
      const key = literalText(node.argumentExpression);
      if (key !== undefined && (NETWORK_NAMES.has(key) || GLOBAL_NAMES.has(key))) flag(node, `computed access to "${key}"`);
      if (key === undefined && ts.isIdentifier(node.expression) && (GLOBAL_NAMES.has(node.expression.text) || globalAliases.has(node.expression.text))) flag(node, "computed key on a global");
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && literalText(node.arguments[0]) === undefined) flag(node, "non-literal dynamic import");
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && NETWORK_NAMES.has(node.expression.text)) flag(node, `new ${node.expression.text}`);
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

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
  if (!statSync(root).isDirectory()) return SOURCE_EXTENSIONS.includes(extname(root)) ? [resolve(root)] : [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (SOURCE_EXTENSIONS.includes(extname(path))) out.push(resolve(path));
  }
  return out;
}

// Every module specifier, from the parsed syntax tree (C-022 P1): static import/export-from,
// `import x = require("…")`, and dynamic import() with a string OR no-substitution template literal.
// (A non-literal dynamic import is flagged separately by scanEgress.) Type-only imports are erased and skipped.
function importSpecifiers(source: string, path = "x.ts"): string[] {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, /\.(tsx|jsx|js)$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const specs: string[] = [];
  const lit = (n: ts.Node | undefined) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined);
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && !n.importClause?.isTypeOnly) {
      const spec = lit(n.moduleSpecifier);
      if (spec !== undefined) specs.push(spec);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && !n.isTypeOnly) {
      const spec = lit(n.moduleSpecifier);
      if (spec !== undefined) specs.push(spec);
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      const spec = lit(n.moduleReference.expression);
      if (spec !== undefined) specs.push(spec);
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const spec = lit(n.arguments[0]);
      if (spec !== undefined) specs.push(spec);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
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
    if (extname(path) !== ".json") scanEgress(rel.split(sep).join("/"), text, violations);
    if (extname(path) === ".json") continue;

    for (const specifier of importSpecifiers(text, path)) {
      const local = resolveLocalImport(frontendRoot, path, specifier);
      if (local) {
        if (!allowedRoots.some((root) => inside(local, root))) {
          violations.push(`${rel}: import escapes Integrity Copilot boundary: ${specifier}`);
        } else {
          queue.push(local);
        }
      } else if (!ALLOWED_EXTERNAL_IMPORTS.has(specifier) && !FILE_IMPORTS[rel.split(sep).join("/")]?.has(specifier)) {
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
