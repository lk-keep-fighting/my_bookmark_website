import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/lib/supabase/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { BookmarkDocument } from "@/lib/bookmarks";

interface SettingsPayload {
  siteTitle?: string | null;
  contactEmail?: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    return NextResponse.json({ error: "未登录用户无法保存站点信息" }, { status: 401 });
  }

  let payload: SettingsPayload;
  try {
    payload = (await request.json()) as SettingsPayload;
  } catch (error) {
    return NextResponse.json({ error: "请求体解析失败，请确认使用 JSON 格式" }, { status: 400 });
  }

  const hasSiteTitle = Object.prototype.hasOwnProperty.call(payload, "siteTitle");
  const hasContactEmail = Object.prototype.hasOwnProperty.call(payload, "contactEmail");

  if (!hasSiteTitle && !hasContactEmail) {
    return NextResponse.json({ error: "请提供需更新的站点标题或邮箱" }, { status: 400 });
  }

  let nextSiteTitle: string | null | undefined = undefined;
  if (hasSiteTitle) {
    const raw = payload.siteTitle;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      nextSiteTitle = trimmed.length > 0 ? trimmed : null;
    } else if (raw === null) {
      nextSiteTitle = null;
    } else {
      return NextResponse.json({ error: "站点标题格式不正确" }, { status: 400 });
    }
  }

  let nextContactEmail: string | null | undefined = undefined;
  if (hasContactEmail) {
    const raw = payload.contactEmail;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        nextContactEmail = null;
      } else if (!EMAIL_PATTERN.test(trimmed)) {
        return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
      } else {
        nextContactEmail = trimmed;
      }
    } else if (raw === null) {
      nextContactEmail = null;
    } else {
      return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
    }
  }

  const { data: existing, error: fetchError } = await supabase
    .from("bookmark_collections")
    .select("id, data, title")
    .eq("user_id", user.id)
    .maybeSingle<{ id: string; data: BookmarkDocument | null; title: string | null }>();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!existing || !existing.data) {
    return NextResponse.json({ error: "尚未导入书签，无法保存站点信息" }, { status: 404 });
  }

  const document = existing.data;
  const currentMetadata = document.metadata ?? {};
  const nextMetadata = { ...currentMetadata };
  let metadataChanged = false;

  if (hasSiteTitle) {
    metadataChanged = metadataChanged || (currentMetadata.siteTitle ?? null) !== (nextSiteTitle ?? null);
    nextMetadata.siteTitle = nextSiteTitle ?? null;
  }

  if (hasContactEmail) {
    metadataChanged = metadataChanged || (currentMetadata.contactEmail ?? null) !== (nextContactEmail ?? null);
    nextMetadata.contactEmail = nextContactEmail ?? null;
  }

  let nextDocument: BookmarkDocument = document;
  if (metadataChanged) {
    nextDocument = {
      ...document,
      metadata: nextMetadata,
    };
  }

  const admin = getSupabaseAdminClient();
  const now = new Date().toISOString();
  const updates: Database["public"]["Tables"]["bookmark_collections"]["Update"] = {
    updated_at: now,
  };

  if (metadataChanged) {
    updates.data = nextDocument;
  }

  if (hasSiteTitle) {
    updates.title = nextSiteTitle ?? null;
  }

  const { error: updateError } = await admin
    .from("bookmark_collections")
    .update(updates)
    .eq("id", existing.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const finalSiteTitle = hasSiteTitle ? nextSiteTitle ?? null : currentMetadata.siteTitle ?? existing.title ?? null;
  const finalContactEmail = hasContactEmail ? nextContactEmail ?? null : currentMetadata.contactEmail ?? null;

  return NextResponse.json({
    siteTitle: finalSiteTitle,
    contactEmail: finalContactEmail,
    updatedAt: now,
  });
}
