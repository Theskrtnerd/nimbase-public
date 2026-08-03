import { isGod } from "@acme/api/operator";
import { ensureCrawlSchedule } from "@acme/cloud";

import { getSession } from "~/auth/server";

export const runtime = "nodejs";

// Operator-only, idempotent: creates the single recurring QStash schedule that
// drives /api/crawl/scheduler (no-op if it already exists). Run once per
// environment after deploy. Kept as an explicit action rather than a boot hook
// so serverless cold starts don't hammer the QStash schedules API.
export async function POST(): Promise<Response> {
  const session = await getSession();
  if (!isGod(session?.user.email)) {
    return new Response("forbidden", { status: 403 });
  }
  const scheduleId = await ensureCrawlSchedule();
  return Response.json({ ok: true, scheduleId });
}
