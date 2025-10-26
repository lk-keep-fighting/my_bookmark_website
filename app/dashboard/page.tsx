import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard-shell";
import type { Database } from "@/lib/supabase/types";

export default async function DashboardPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data } = await supabase
    .from("bookmark_collections")
    .select("data, share_slug, updated_at, title")
    .eq("user_id", user.id)
    .maybeSingle<Database["public"]["Tables"]["bookmark_collections"]["Row"]>();

  return (
    <DashboardShell
      email={user.email ?? ""}
      initialDocument={data?.data ?? null}
      initialShareSlug={data?.share_slug ?? null}
      initialUpdatedAt={data?.updated_at ?? null}
      initialSiteTitle={data?.title ?? null}
    />
  );
}
