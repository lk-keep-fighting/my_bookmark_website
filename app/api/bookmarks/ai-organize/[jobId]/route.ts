import { NextResponse } from "next/server";
import type { AiOrganizeJobResponse } from "@/lib/bookmarks/ai";
import { getAiOrganizeJob, markAiOrganizeJobCancelRequested } from "@/lib/bookmarks/ai-jobs";

export async function GET(_request: Request, { params }: { params: { jobId: string } }) {
  const job = getAiOrganizeJob(params.jobId);
  if (!job) {
    return NextResponse.json({ error: "未找到对应的 AI 整理任务" }, { status: 404 });
  }

  const response: AiOrganizeJobResponse = { job };
  return NextResponse.json(response);
}

export async function DELETE(_request: Request, { params }: { params: { jobId: string } }) {
  const job = markAiOrganizeJobCancelRequested(params.jobId);
  if (!job) {
    return NextResponse.json({ error: "未找到对应的 AI 整理任务" }, { status: 404 });
  }

  const response: AiOrganizeJobResponse & { message: string } = {
    job,
    message: job.status === "cancelled" ? "AI 整理任务已停止" : "已提交停止请求，任务即将中止",
  };

  return NextResponse.json(response);
}
