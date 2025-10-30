import { NextResponse } from "next/server";

const DISABLED_MESSAGE = "AI 自动整理功能已暂时下线，请稍后再试。";

export async function POST() {
  return NextResponse.json({ error: DISABLED_MESSAGE }, { status: 503 });
}
