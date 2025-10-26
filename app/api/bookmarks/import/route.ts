import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/lib/supabase/types";
import { parseBookmarksHtml } from "@/lib/bookmarks";
import type { BookmarkDocument } from "@/lib/bookmarks";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateShareSlug } from "@/lib/utils";

export async function POST(request: Request) {
  const supabase = createRouteHandlerClient<Database>({ cookies });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未登录用户无法导入书签" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传有效的书签 HTML 文件" }, { status: 400 });
  }

  let document: BookmarkDocument;
  try {
    const content = await file.text();
    document = parseBookmarksHtml(content, file.name ?? "import");
  } catch (error) {
    const message = error instanceof Error ? error.message : "书签解析失败";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const { data: existing } = await supabase
    .from("bookmark_collections")
    .select("id, share_slug, data, title")
    .eq("user_id", user.id)
    .maybeSingle<{
      id: string;
      share_slug: string | null;
      data: BookmarkDocument | null;
      title: string | null;
    }>();

  const previousMetadata = existing?.data?.metadata ?? null;
  const mergedSiteTitle =
    previousMetadata?.siteTitle ??
    existing?.title ??
    document.metadata?.siteTitle ??
    document.root.name ??
    "我的导航站";
  const mergedContactEmail = previousMetadata?.contactEmail ?? null;

  document = {
    ...document,
    metadata: {
      siteTitle: mergedSiteTitle,
      contactEmail: mergedContactEmail,
    },
  };

  const shareSlug = existing?.share_slug ?? generateShareSlug();
  const now = new Date().toISOString();
  const admin = getSupabaseAdminClient();

  if (existing?.id) {
    const { error: updateError } = await admin
      .from("bookmark_collections")
      .update({
        data: document,
        share_slug: shareSlug,
        updated_at: now,
        title: document.metadata?.siteTitle ?? document.root.name ?? null,
      })
      .eq("id", existing.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  } else {
    const { error: insertError } = await admin.from("bookmark_collections").insert({
      user_id: user.id,
      data: document,
      share_slug: shareSlug,
      created_at: now,
      updated_at: now,
      title: document.metadata?.siteTitle ?? document.root.name ?? null,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ document, shareSlug, updatedAt: now });
}
