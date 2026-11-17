import crypto from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { runDueMonitors } from "../../src/server/engine.ts";
import { getKvStore } from "../../src/server/store.ts";

function deriveOffsetToken(siteId: string): string {
  const secret =
    Netlify.env.get("INTERNAL_OFFSET_SECRET") ||
    Netlify.env.get("NETLIFY_SITE_ID") ||
    siteId ||
    "pulsediff-offset";
  return crypto.createHash("sha256").update(`offset:${secret}`).digest("hex");
}

export default async (req: Request, context: Context): Promise<Response> => {
  const expected = deriveOffsetToken(context.site?.id || "");
  const provided = req.headers.get("x-pulsediff-offset-token") || "";
  if (provided !== expected) {
    return new Response("Forbidden", { status: 403 });
  }

  // Wait ~29 seconds to execute the mid-minute 30-second probe cycle.
  await new Promise((resolve) => setTimeout(resolve, 29_000));

  const store = getKvStore();
  const siteUrl = context.site?.url || Netlify.env.get("URL") || "";
  const summary = await runDueMonitors(store, {
    forceAll: false,
    probeOptions: { internalOrigin: siteUrl || undefined }
  });

  return Response.json(summary);
};

type BackgroundConfig = Config & { background: boolean };

export const config: BackgroundConfig = {
  background: true,
  path: "/_internal/probe-offset"
};
