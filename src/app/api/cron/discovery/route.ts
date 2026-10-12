import { authorizeCron } from "@/lib/cron-auth";
import { runDiscovery } from "@/services/jobs";

export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;
  const force = new URL(request.url).searchParams.get("force") === "1";
  const { ok, detail } = await runDiscovery({ force });
  return Response.json({ ok, job: "discovery", detail }, { status: ok ? 200 : 500 });
}
