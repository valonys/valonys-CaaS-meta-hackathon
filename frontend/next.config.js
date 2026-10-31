/** @type {import('next').NextConfig} */

// Browser-side network boundary: the page may only talk to its own origin (no third-party hosts,
// whatever the client code does). 'unsafe-eval' is added only for `next dev` hot reload.
const dev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // No frames or workers: a fresh realm could otherwise bring back untouched WebRTC constructors.
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  // Trusted Types: HTML-string sinks (innerHTML, insertAdjacentHTML, document.write, DOMParser, srcdoc)
  // refuse plain strings, so no frame or script can be created from markup at runtime.
  "require-trusted-types-for 'script'",
  "trusted-types 'none'",
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Runs instrumentation.ts register() at server start, before application modules load.
    instrumentationHook: true,
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: csp }, { key: "X-Content-Type-Options", value: "nosniff" }] }];
  },
};
module.exports = nextConfig;
