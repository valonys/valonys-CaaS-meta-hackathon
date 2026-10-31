// In-process network allowlist for the server (not an OS sandbox).
//
// Two layers, installed once when server.ts loads:
//  1. Socket level: every outbound TCP/TLS connection made inside this Node process goes through
//     net.Socket.prototype.connect: fetch/undici, http, https and tls all do, however the module
//     was obtained. Only api.meta.ai:443 and 127.0.0.1:11434 may connect; anything else fails
//     before a connection is made. Local IPC paths (unix sockets/pipes) are not network egress
//     and are left alone.
//  2. fetch level: the global fetch rejects non-allowlisted origins early, with a clear error.
//  3. Unused transports disabled: UDP (dgram), child processes, worker threads and the public DNS
//     resolver (Resolver, resolve*, setServers, reverse, lookupService) throw on use; dns.lookup is
//     limited to the allowlisted host names (net uses it to reach api.meta.ai).
//     Patching the built-in module objects applies however the module is obtained
//     (process.getBuiltinModule, a Function-constructor path, ...), not just to static imports.
// Scope: TCP/TLS inside this process. Other transports are also made unobtainable statically by the
// provider guard instead: every import (static, re-export, require-equals, dynamic with a string or
// template literal) must be on the module allowlist, so node:dgram (UDP), node:child_process,
// node:worker_threads, node:http2 and node:dns cannot be loaded; process.getBuiltinModule/binding/
// dlopen, require and createRequire are banned. Not an OS sandbox.
// The browser side is held by the Content-Security-Policy `connect-src 'self'` header.

import net from "node:net";
import dgram from "node:dgram";
import childProcess from "node:child_process";
import workerThreads from "node:worker_threads";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";

export const ALLOWED_ORIGINS = new Set(["https://api.meta.ai", "http://127.0.0.1:11434"]);
export const ALLOWED_SOCKETS = new Set(["api.meta.ai:443", "127.0.0.1:11434"]);
export const ALLOWED_LOOKUP_NAMES = new Set(["api.meta.ai", "localhost"]);
// An IP literal needs no DNS query (server.listen and connect also call lookup for them).
const lookupAllowed = (hostname: unknown) => net.isIP(String(hostname)) !== 0 || ALLOWED_LOOKUP_NAMES.has(String(hostname).toLowerCase());

export class EgressBlockedError extends TypeError {
  constructor(target: string) {
    super(`egress blocked: ${target} is not an allowlisted Meta endpoint`);
    this.name = "EgressBlockedError";
  }
}

// Origin of a fetch target, or null when it cannot be resolved to an absolute URL.
export function targetOrigin(input: unknown): string | null {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url?: unknown })?.url;
    if (typeof raw !== "string") return null;
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

type FetchLike = (input: unknown, init?: unknown) => Promise<unknown>;

// Wrap a fetch implementation so non-allowlisted targets throw instead of connecting.
export function guardFetch(inner: FetchLike): FetchLike {
  return (input, init) => {
    const origin = targetOrigin(input);
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return Promise.reject(new EgressBlockedError(origin ?? "an unresolvable target"));
    return inner(input, init);
  };
}

// "host:port" for a Socket#connect call, or null for a local IPC path.
// Accepts connect(options[, cb]), connect(port[, host][, cb]) and connect(path[, cb]).
export function socketTarget(args: unknown[]): string | null {
  const [a, b] = args;
  if (Array.isArray(a)) return socketTarget(a); // internal normalized form
  if (a && typeof a === "object") {
    const o = a as { path?: unknown; port?: unknown; host?: unknown };
    if (typeof o.path === "string") return null;
    return `${typeof o.host === "string" && o.host ? o.host : "localhost"}:${String(o.port)}`.toLowerCase();
  }
  if (typeof a === "string" && !/^\d+$/.test(a)) return null; // IPC path
  return `${typeof b === "string" && b ? b : "localhost"}:${String(a)}`.toLowerCase();
}

export class TransportDisabledError extends Error {
  constructor(what: string) {
    super(`transport disabled: ${what} is not used by Integrity Copilot`);
    this.name = "TransportDisabledError";
  }
}

// Replace every entry point of the unused transports with a function that throws.
function disableUnusedTransports(): void {
  const refuse = (what: string) =>
    function refused(): never {
      throw new TransportDisabledError(what);
    };
  const setAll = (obj: object, names: string[], what: string) => {
    for (const name of names) Object.defineProperty(obj, name, { value: refuse(`${what}.${name}`), configurable: true, writable: true });
  };
  setAll(dgram, ["createSocket"], "dgram");
  setAll(dgram.Socket.prototype, ["send", "bind", "connect"], "dgram.Socket");
  setAll(childProcess, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"], "child_process");
  setAll(childProcess.ChildProcess.prototype, ["spawn"], "child_process.ChildProcess");
  setAll(workerThreads, ["Worker"], "worker_threads");
  // DNS: no resolver traffic of our own choosing; lookups only for allowlisted names.
  const RESOLVER_FNS = ["resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTlsa", "resolveTxt", "reverse", "setServers", "lookupService"];
  for (const [mod, label] of [[dns, "dns"], [dnsPromises, "dns/promises"]] as const) {
    // Patch the real class prototype FIRST (covers Resolver instances created before install),
    // then replace the exported constructor and functions.
    const RealResolver = (mod as { Resolver: { prototype: object } }).Resolver;
    setAll(RealResolver.prototype, RESOLVER_FNS, `${label}.Resolver`);
    setAll(mod, [...RESOLVER_FNS, "Resolver"], label);
  }
  const lookup = dns.lookup as (...a: unknown[]) => unknown;
  Object.defineProperty(dns, "lookup", {
    configurable: true,
    writable: true,
    value: function guardedLookup(hostname: string, ...rest: unknown[]) {
      if (!lookupAllowed(hostname)) {
        const cb = rest.find((r) => typeof r === "function") as ((e: Error) => void) | undefined;
        const err = new EgressBlockedError(`dns lookup of ${hostname}`);
        if (cb) setImmediate(() => cb(err));
        return undefined;
      }
      return lookup(hostname, ...rest);
    },
  });
  const pLookup = dnsPromises.lookup as (...a: unknown[]) => Promise<unknown>;
  Object.defineProperty(dnsPromises, "lookup", {
    configurable: true,
    writable: true,
    value: (hostname: string, ...rest: unknown[]) =>
      lookupAllowed(hostname) ? pLookup(hostname, ...rest) : Promise.reject(new EgressBlockedError(`dns lookup of ${hostname}`)),
  });
  syncBuiltinESMExports(); // keep ESM named exports of these built-ins in step
}

// Install once per process (idempotent).
export function installEgressAllowlist(): void {
  const g = globalThis as typeof globalThis & { __integrityCopilotEgress?: boolean };
  if (g.__integrityCopilotEgress) return;
  const proto = net.Socket.prototype as unknown as { connect: (...args: unknown[]) => unknown };
  const connect = proto.connect;
  proto.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    const target = socketTarget(args);
    if (target !== null && !ALLOWED_SOCKETS.has(target)) {
      const err = new EgressBlockedError(target);
      // TLS sockets are still being configured by tls.connect after connect() returns (servername,
      // session), so destroying them synchronously crashes the process; defer those by one turn.
      // Plain TCP is destroyed at once (Node emits the error on a later tick, after handlers attach).
      if ((this as unknown as { encrypted?: boolean }).encrypted === true) setImmediate(() => this.destroy(err));
      else this.destroy(err);
      return this;
    }
    return connect.apply(this, args);
  };
  disableUnusedTransports();
  const inner = globalThis.fetch as unknown as FetchLike;
  globalThis.fetch = guardFetch(inner) as unknown as typeof globalThis.fetch;
  g.__integrityCopilotEgress = true;
}
