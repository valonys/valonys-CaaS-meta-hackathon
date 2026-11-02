// GET: deterministic "Next spots" ranking across all lines. Never calls a model, so no token gate.
import { NextResponse } from "next/server";
import { portfolioView } from "@/lib/integrity-copilot/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  return NextResponse.json(await portfolioView());
}
