import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "./types";

export type AuthenticatedSupabaseContext =
  | {
      type: "session";
      supabase: SupabaseClient<Database>;
      user: User;
      accessToken: string | null;
    }
  | {
      type: "bearer";
      supabase: SupabaseClient<Database>;
      user: User;
      accessToken: string;
    };

export async function getAuthenticatedSupabaseContext(request: Request): Promise<AuthenticatedSupabaseContext | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("缺少 Supabase 配置，请设置 NEXT_PUBLIC_SUPABASE_URL 与 NEXT_PUBLIC_SUPABASE_ANON_KEY。");
  }

  const authHeader = request.headers.get("authorization") ?? request.headers.get("Authorization");

  if (authHeader?.startsWith("Bearer ")) {
    const accessToken = authHeader.slice("Bearer ".length).trim();

    if (accessToken.length > 0) {
      const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
        },
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      });

      const { data, error } = await supabase.auth.getUser(accessToken);

      if (!error && data?.user) {
        return {
          type: "bearer",
          supabase,
          user: data.user,
          accessToken,
        };
      }

      return null;
    }
  }

  const supabase = createRouteHandlerClient<Database>({ cookies });
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token ?? null;

  return {
    type: "session",
    supabase,
    user,
    accessToken,
  };
}
