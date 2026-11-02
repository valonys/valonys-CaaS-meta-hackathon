// GET: run the replay workflow for one line (?line=<tag>; default: the original PC-01 circuit). Live Meta calls are opt-in (INTEGRITY_COPILOT_LIVE=1)
// and then require the approver token, because they spend credits.
import { NextRequest, NextResponse } from "next/server";
import { checkApproverToken, replay, UnknownLineError } from "@/lib/integrity-copilot/server";

export const dynamic = "force-dynamic";
// Model calls must never be served from Next's persistent fetch cache.
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  if (process.env.INTEGRITY_COPILOT_LIVE === "1") {
    const gate = checkApproverToken(req.headers.get("x-integrity-copilot-token"));
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  try {
    // The line is sent as a header so client code can keep fetch() on a plain same-origin literal.
    return NextResponse.json(await replay(req.headers.get("x-integrity-copilot-line") ?? req.nextUrl.searchParams.get("line")));
  } catch (e) {
    if (e instanceof UnknownLineError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
