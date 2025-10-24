import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

let cachedAdminClient: SupabaseClient<Database> | null = null;

export function getSupabaseAdminClient(): SupabaseClient<Database> {
  if (cachedAdminClient) {
    return cachedAdminClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("缺少 Supabase Service Role 配置，请设置 NEXT_PUBLIC_SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY。");
  }

  cachedAdminClient = createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  });

  return cachedAdminClient;
}
