import type { Config, Context } from "@netlify/functions";
import { handleApiRequest } from "../../src/server/app.ts";

export default async (req: Request, context: Context): Promise<Response> => {
  const siteUrl = context.site?.url || new URL(req.url).origin;
  return handleApiRequest(req, {
    probeOptions: {
      internalOrigin: siteUrl
    }
  });
};

export const config: Config = {
  path: "/api/*"
};
