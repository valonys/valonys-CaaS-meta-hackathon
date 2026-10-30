// GET: run the one-circuit replay workflow. Live Meta calls are opt-in (INTEGRITY_COPILOT_LIVE=1)
// and then require the approver token, because they spend credits.
import { NextRequest, NextResponse } from "next/server";
import { checkApproverToken, replay } from "@/lib/integrity-copilot/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (process.env.INTEGRITY_COPILOT_LIVE === "1") {
    const gate = checkApproverToken(req.headers.get("x-integrity-copilot-token"));
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  return NextResponse.json(await replay());
}
