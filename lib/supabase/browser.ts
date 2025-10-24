import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("缺少 Supabase 浏览器端配置，请在环境变量中设置 NEXT_PUBLIC_SUPABASE_URL 与 NEXT_PUBLIC_SUPABASE_ANON_KEY。");
  }

  return createClient<Database>(url, anonKey);
}
