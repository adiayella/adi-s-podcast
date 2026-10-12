import { authorizeCron } from "@/lib/cron-auth";
import { runFocused } from "@/services/jobs";

export const maxDuration = 300; // Hobby and Pro both allow 300 s with Fluid compute

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;
  const force = new URL(request.url).searchParams.get("force") === "1";
  const { ok, detail } = await runFocused({ force });
  return Response.json({ ok, job: "focused", detail }, { status: ok ? 200 : 500 });
}
