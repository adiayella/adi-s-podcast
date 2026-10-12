import { authorizeCron } from "@/lib/cron-auth";
import { runDaily } from "@/services/jobs";

export const maxDuration = 300; // Hobby and Pro both allow 300 s with Fluid compute

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;
  const { ok, detail } = await runDaily();
  return Response.json({ ok, job: "daily", detail }, { status: ok ? 200 : 500 });
}
