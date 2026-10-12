import { Suspense } from "react";
import { connection } from "next/server";
import { Lock } from "lucide-react";
import { PageHeader, Panel, PanelSkeleton } from "@/components/ui";
import { LoginForm } from "@/components/login-form";
import { isAdmin } from "@/lib/admin";
import { signOut } from "./actions";

export default function AdminPage() {
  return (
    <>
      <PageHeader title="Admin" subtitle="Sign in to manage podcasts and send briefs. Viewing the dashboards never needs a login." />
      <Suspense fallback={<PanelSkeleton className="h-48" />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  await connection();
  const admin = await isAdmin();
  return (
    <Panel title={admin ? "You are signed in" : "Admin login"} icon={Lock} className="max-w-md">
      {admin ? (
        <form action={signOut}>
          <button type="submit" className="rounded-xl bg-panel2 px-4 py-2.5 text-[15px] ring-1 ring-line hover:ring-accent/60">
            Sign out
          </button>
        </form>
      ) : (
        <LoginForm />
      )}
    </Panel>
  );
}
