import crypto from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { runDueMonitors } from "../../src/server/engine.ts";
import { ensureSeededWorkspace } from "../../src/server/seed.ts";
import { getKvStore } from "../../src/server/store.ts";

function deriveOffsetToken(siteId: string): string {
  const secret =
    Netlify.env.get("INTERNAL_OFFSET_SECRET") ||
    Netlify.env.get("NETLIFY_SITE_ID") ||
    siteId ||
    "pulsediff-offset";
  return crypto.createHash("sha256").update(`offset:${secret}`).digest("hex");
}

export default async (_req: Request, context: Context): Promise<void> => {
  const store = getKvStore();
  const siteUrl = context.site?.url || Netlify.env.get("URL") || "";

  if (siteUrl) {
    await ensureSeededWorkspace(store, siteUrl, {
      skipInitialProbe: true,
      probeOptions: { internalOrigin: siteUrl }
    });
  }

  const summary = await runDueMonitors(store, {
    forceAll: false,
    probeOptions: { internalOrigin: siteUrl || undefined }
  });

  if (summary.hasSubMinuteNeeded && siteUrl) {
    const token = deriveOffsetToken(context.site?.id || "");
    await fetch(`${siteUrl}/_internal/probe-offset`, {
      method: "POST",
      headers: {
        "x-pulsediff-offset-token": token
      }
    }).catch((err) => {
      console.error("Failed to trigger 30s offset background probe:", err);
    });
  }
};

export const config: Config = {
  schedule: "* * * * *"
};
