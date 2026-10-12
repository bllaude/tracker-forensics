import { NextResponse } from "next/server";
import { verify, type VerifyInput, type Tri, type SmsState, type Platform } from "@/lib/verify";

export const runtime = "nodejs";

const TRI: Tri[] = ["yes", "no", "unsure"];
const SMS: SmsState[] = ["reply", "none", "unsure"];
const PLATFORMS: Platform[] = ["sinotrackpro", "clone-app", "unsure"];

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sms = (v: unknown): SmsState => (SMS.includes(v as SmsState) ? (v as SmsState) : "unsure");
  const checklist: Record<string, Tri> = {};
  if (body.checklist && typeof body.checklist === "object") {
    for (const [k, v] of Object.entries(body.checklist as Record<string, unknown>)) {
      if (TRI.includes(v as Tri)) checklist[k.slice(0, 40)] = v as Tri;
    }
  }

  const input: VerifyInput = {
    model: str(body.model, 40),
    imei: str(body.imei, 40),
    deviceId: str(body.deviceId, 40),
    rconfSms: sms(body.rconfSms),
    rconfText: str(body.rconfText, 2000),
    cxztSms: sms(body.cxztSms),
    cxztText: str(body.cxztText, 2000),
    platform: PLATFORMS.includes(body.platform as Platform) ? (body.platform as Platform) : "unsure",
    checklist,
  };

  return NextResponse.json(verify(input));
}
