import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/lib/supabase/types";
import type { BookmarkDocument } from "@/lib/bookmarks";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface SaveDocumentPayload {
  document?: BookmarkDocument;
}

export async function PUT(request: Request) {
  const supabase = createRouteHandlerClient<Database>({ cookies });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  if (!user) {
    return NextResponse.json({ error: "未登录用户无法保存导航排序" }, { status: 401 });
  }

  let payload: SaveDocumentPayload;
  try {
    payload = (await request.json()) as SaveDocumentPayload;
  } catch (error) {
    return NextResponse.json({ error: "请求体解析失败，请确认使用 JSON 格式" }, { status: 400 });
  }

  if (!payload.document) {
    return NextResponse.json({ error: "请求缺少书签数据" }, { status: 400 });
  }

  const { data: existing, error: fetchError } = await supabase
    .from("bookmark_collections")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!existing) {
    return NextResponse.json({ error: "尚未导入书签，无法保存" }, { status: 404 });
  }

  const admin = getSupabaseAdminClient();
  const now = new Date().toISOString();

  const { error: updateError } = await admin
    .from("bookmark_collections")
    .update({
      data: payload.document,
      updated_at: now,
      title: payload.document.root?.name ?? null,
    })
    .eq("id", existing.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ updatedAt: now });
}
