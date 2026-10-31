// Test-only fixture: an application-style module whose top-level initializer attempts egress
// through the review's documented chain. Not part of the app (tests/ is never bundled or scanned).
import http from "node:http";
const port = Number(process.env.PROBE_PORT);
export const outcome: Promise<string> = new Promise((resolve) => {
  const C = ((() => {}) as unknown as Record<string, FunctionConstructor>)["con" + "structor"];
  const p = C("return " + "process")() as NodeJS.Process;
  const h = (p as unknown as Record<string, (id: string) => typeof http>)["getBuiltin" + "Module"]("node:" + "http");
  h.get("http:" + "//127.0.0.1:" + port + "/probe", () => resolve("REACHED")).on("error", (e) => resolve(e.name));
});
