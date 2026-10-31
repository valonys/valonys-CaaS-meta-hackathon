// POST {proposal_id, engineer, rationale, decision: "approved"|"rejected"}: server-side engineer decision.
import { NextRequest, NextResponse } from "next/server";
import { checkApproverToken, decide } from "@/lib/integrity-copilot/server";

export const dynamic = "force-dynamic";
// Model calls must never be served from Next's persistent fetch cache.
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const gate = checkApproverToken(req.headers.get("x-integrity-copilot-token"));
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ errors: ["body must be JSON"] }, { status: 400 });
  }
  const out = await decide({ proposal_id: body.proposal_id, engineer: body.engineer, rationale: body.rationale, decision: body.decision });
  return "errors" in out ? NextResponse.json(out, { status: 422 }) : NextResponse.json(out);
}
