import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/lib/supabase/types";
import { generateShareSlug } from "@/lib/utils";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { findFolderWithTrail, type BookmarkDocument } from "@/lib/bookmarks";
import {
  mapShareSiteRow,
  mapShareSiteRows,
  type ShareSiteRow,
  type ShareSiteSummary,
} from "@/lib/share-sites";

interface ShareSitePayload {
  name?: string;
  folderId?: string;
}

export async function GET() {
  const supabase = createRouteHandlerClient<Database>({ cookies });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  if (!user) {
    return NextResponse.json({ error: "未登录用户无法查看分享站" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("share_sites")
    .select("id, name, share_slug, folder_id, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: mapShareSiteRows(data as ShareSiteRow[] | null) });
}

export async function POST(request: Request) {
  const supabase = createRouteHandlerClient<Database>({ cookies });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  if (!user) {
    return NextResponse.json({ error: "未登录用户无法创建分享站" }, { status: 401 });
  }

  let payload: ShareSitePayload;
  try {
    payload = (await request.json()) as ShareSitePayload;
  } catch {
    return NextResponse.json({ error: "请求体解析失败，请确认使用 JSON 格式" }, { status: 400 });
  }

  const rawName = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!rawName) {
    return NextResponse.json({ error: "请填写分享站名称" }, { status: 400 });
  }

  const folderId = typeof payload.folderId === "string" ? payload.folderId.trim() : "";
  if (!folderId) {
    return NextResponse.json({ error: "请选择要分享的目录" }, { status: 400 });
  }

  const { data: collection, error: collectionError } = await supabase
    .from("bookmark_collections")
    .select("id, data")
    .eq("user_id", user.id)
    .maybeSingle<{ id: string; data: BookmarkDocument | null }>();

  if (collectionError) {
    return NextResponse.json({ error: collectionError.message }, { status: 500 });
  }

  if (!collection || !collection.data) {
    return NextResponse.json({ error: "尚未导入书签，无法创建分享站" }, { status: 404 });
  }

  const document = collection.data as BookmarkDocument;
  if (!findFolderWithTrail(document.root, folderId)) {
    return NextResponse.json({ error: "未找到指定目录，请重新选择" }, { status: 404 });
  }

  const admin = getSupabaseAdminClient();
  const now = new Date().toISOString();
  const baseInsert = {
    user_id: user.id,
    collection_id: collection.id,
    name: rawName,
    folder_id: folderId,
    created_at: now,
    updated_at: now,
  } satisfies Omit<Database["public"]["Tables"]["share_sites"]["Insert"], "share_slug">;

  let inserted: ShareSiteSummary | null = null;
  let attemptError: string | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shareSlug = generateShareSlug();
    const { data: insertData, error: insertError } = await admin
      .from("share_sites")
      .insert({ ...baseInsert, share_slug: shareSlug })
      .select("id, name, share_slug, folder_id, created_at, updated_at")
      .single<ShareSiteRow>();

    if (!insertError && insertData) {
      inserted = mapShareSiteRow(insertData);
      break;
    }

    if (insertError?.code === "23505") {
      attemptError = insertError.message;
      continue;
    }

    return NextResponse.json({ error: insertError?.message ?? "创建分享站失败" }, { status: 500 });
  }

  if (!inserted) {
    return NextResponse.json({ error: attemptError ?? "重复的分享链接，请重试" }, { status: 500 });
  }

  return NextResponse.json({ item: inserted });
}
