import { NextResponse } from "next/server";
import { collectFolderOptions, formatFolderTrail, type BookmarkDocument } from "@/lib/bookmarks";
import { getAuthenticatedSupabaseContext } from "@/lib/supabase/authenticate";

export async function GET(request: Request) {
  let authContext;
  try {
    authContext = await getAuthenticatedSupabaseContext(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法加载认证配置";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!authContext) {
    return NextResponse.json({ error: "请先登录导航站账户后再使用插件" }, { status: 401 });
  }

  const { supabase, user } = authContext;

  const { data: collection, error } = await supabase
    .from("bookmark_collections")
    .select("id, data, updated_at, title")
    .maybeSingle<{ id: string; data: BookmarkDocument | null; updated_at: string | null; title: string | null }>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const document = collection?.data ?? null;
  const folderOptions = collectFolderOptions(document).map((option) => ({
    id: option.id,
    label: formatFolderTrail(option.trail),
    directBookmarkCount: option.directBookmarkCount,
  }));

  const siteTitleCandidate =
    document?.metadata?.siteTitle?.trim() ??
    collection?.title?.trim() ??
    document?.root?.name?.trim() ??
    null;

  return NextResponse.json({
    userEmail: user.email ?? "",
    folderOptions,
    hasDocument: Boolean(document),
    siteTitle: siteTitleCandidate,
    updatedAt: collection?.updated_at ?? null,
  });
}
