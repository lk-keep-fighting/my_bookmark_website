import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard-shell";
import type { Database } from "@/lib/supabase/types";

type ShareSiteSummary = Pick<
  Database["public"]["Tables"]["share_sites"]["Row"],
  "id" | "name" | "share_slug" | "folder_id" | "created_at" | "updated_at"
>;

export default async function DashboardPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: collection } = await supabase
    .from("bookmark_collections")
    .select("data, updated_at, title")
    .eq("user_id", user.id)
    .maybeSingle<Pick<Database["public"]["Tables"]["bookmark_collections"]["Row"], "data" | "updated_at" | "title">>();

  const { data: shareSitesData } = await supabase
    .from("share_sites")
    .select("id, name, share_slug, folder_id, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const shareSites = (shareSitesData ?? []) as ShareSiteSummary[];

  return (
    <DashboardShell
      email={user.email ?? ""}
      initialDocument={collection?.data ?? null}
      initialShareSites={shareSites}
      initialUpdatedAt={collection?.updated_at ?? null}
      initialSiteTitle={collection?.title ?? null}
    />
  );
}
