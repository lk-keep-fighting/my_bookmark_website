import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/lib/supabase/types";
import { generateShareSlug } from "@/lib/utils";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = createRouteHandlerClient<Database>({ cookies });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未登录用户无法生成分享链接" }, { status: 401 });
  }

  // 读取 body 以避免部分客户端在无 body 时报错
  try {
    if (request.headers.get("content-type")?.includes("application/json")) {
      await request.json();
    }
  } catch (error) {
    console.error("Failed to parse share action body", error);
  }

  const { data: existing } = await supabase
    .from("bookmark_collections")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "请先导入书签后再生成分享链接" }, { status: 400 });
  }

  const shareSlug = generateShareSlug();
  const now = new Date().toISOString();
  const admin = getSupabaseAdminClient();

  const { error } = await admin
    .from("bookmark_collections")
    .update({ share_slug: shareSlug, updated_at: now })
    .eq("id", existing.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ shareSlug, updatedAt: now });
}
