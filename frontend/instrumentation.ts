// Next.js instrumentation hook: register() runs once when the server starts, before any application
// module (routes, pages, lib) is loaded. Installing the in-process egress controls here means no
// module initializer can run before them. server.ts also calls the idempotent installer.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installEgressAllowlist } = await import("./lib/integrity-copilot/egress.ts");
    installEgressAllowlist();
    console.log("integrity-copilot: in-process egress controls installed at server start");
  }
}
