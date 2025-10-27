import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/lib/supabase/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { findFolderWithTrail, type BookmarkDocument } from "@/lib/bookmarks";

interface ShareSitePayload {
  name?: string;
  folderId?: string;
}

type ShareSiteSummary = Pick<
  Database["public"]["Tables"]["share_sites"]["Row"],
  "id" | "name" | "share_slug" | "folder_id" | "created_at" | "updated_at"
>;

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const supabase = createRouteHandlerClient<Database>({ cookies });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  if (!user) {
    return NextResponse.json({ error: "未登录用户无法编辑分享站" }, { status: 401 });
  }

  let payload: ShareSitePayload;
  try {
    payload = (await request.json()) as ShareSitePayload;
  } catch {
    return NextResponse.json({ error: "请求体解析失败，请确认使用 JSON 格式" }, { status: 400 });
  }

  const hasName = Object.prototype.hasOwnProperty.call(payload, "name");
  const hasFolder = Object.prototype.hasOwnProperty.call(payload, "folderId");

  if (!hasName && !hasFolder) {
    return NextResponse.json({ error: "请提供需更新的名称或目录" }, { status: 400 });
  }

  const { data: existing, error: fetchError } = await supabase
    .from("share_sites")
    .select("id, collection_id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle<{ id: string; collection_id: string }>();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!existing) {
    return NextResponse.json({ error: "未找到对应的分享站" }, { status: 404 });
  }

  const updates: Database["public"]["Tables"]["share_sites"]["Update"] = {
    updated_at: new Date().toISOString(),
  };

  if (hasName) {
    const rawName = typeof payload.name === "string" ? payload.name.trim() : "";
    if (!rawName) {
      return NextResponse.json({ error: "分享站名称不能为空" }, { status: 400 });
    }
    updates.name = rawName;
  }

  if (hasFolder) {
    const folderId = typeof payload.folderId === "string" ? payload.folderId.trim() : "";
    if (!folderId) {
      return NextResponse.json({ error: "请选择要分享的目录" }, { status: 400 });
    }

    const { data: collection, error: collectionError } = await supabase
      .from("bookmark_collections")
      .select("data")
      .eq("id", existing.collection_id)
      .maybeSingle<{ data: BookmarkDocument | null }>();

    if (collectionError) {
      return NextResponse.json({ error: collectionError.message }, { status: 500 });
    }

    if (!collection || !collection.data) {
      return NextResponse.json({ error: "原始书签数据不存在，无法更新分享站" }, { status: 404 });
    }

    if (!findFolderWithTrail(collection.data.root, folderId)) {
      return NextResponse.json({ error: "未找到指定目录，请重新选择" }, { status: 404 });
    }
    updates.folder_id = folderId;
  }

  const admin = getSupabaseAdminClient();
  const { data: updated, error: updateError } = await admin
    .from("share_sites")
    .update(updates)
    .eq("id", existing.id)
    .select("id, name, share_slug, folder_id, created_at, updated_at")
    .single<ShareSiteSummary>();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ item: updated });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createRouteHandlerClient<Database>({ cookies });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  if (!user) {
    return NextResponse.json({ error: "未登录用户无法删除分享站" }, { status: 401 });
  }

  const { data: existing, error: fetchError } = await supabase
    .from("share_sites")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!existing) {
    return NextResponse.json({ error: "未找到对应的分享站" }, { status: 404 });
  }

  const admin = getSupabaseAdminClient();
  const { error: deleteError } = await admin.from("share_sites").delete().eq("id", existing.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
