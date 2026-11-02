// POST {csv, campaign, comparability?}: import one inspection campaign in workbook layout. Approver token required.
import { NextRequest, NextResponse } from "next/server";
import { checkApproverToken, uploadCampaign } from "@/lib/integrity-copilot/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const gate = checkApproverToken(req.headers.get("x-integrity-copilot-token"));
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
  } catch {
    return NextResponse.json({ errors: ["body must be a JSON object"] }, { status: 400 });
  }
  const campaign = (body.campaign ?? {}) as Record<string, unknown>;
  const comparability = body.comparability as Record<string, unknown> | undefined;
  const out = uploadCampaign(body.csv, campaign as never, comparability as never);
  return NextResponse.json(out, { status: out.status === "accepted" ? 200 : 422 });
}
