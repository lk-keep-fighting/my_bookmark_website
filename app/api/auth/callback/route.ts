import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import type { Session } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

interface AuthCallbackBody {
  event: string;
  session: Session | null;
}

export async function POST(request: Request) {
  const supabase = createRouteHandlerClient<Database>({ cookies });
  let body: AuthCallbackBody;

  try {
    body = (await request.json()) as AuthCallbackBody;
  } catch {
    return NextResponse.json({ error: "Invalid auth callback payload" }, { status: 400 });
  }

  const { event, session } = body;

  if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
    if (!session) {
      return NextResponse.json({ error: "Missing session data" }, { status: 400 });
    }

    const { error } = await supabase.auth.setSession(session);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (event === "SIGNED_OUT") {
    const { error } = await supabase.auth.signOut();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
