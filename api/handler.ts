import { handleApiRequest } from "../src/server/app.ts";

export default {
  async fetch(request: Request): Promise<Response> {
    const rawUrl = new URL(request.url);
    const routedPath = rawUrl.searchParams.get("__path");
    let overrideUrl: string | undefined;

    if (routedPath) {
      const cleanParams = new URLSearchParams(rawUrl.searchParams);
      cleanParams.delete("__path");
      const normalized = routedPath.startsWith("/") ? routedPath : `/${routedPath}`;
      const qs = cleanParams.toString();
      overrideUrl = `${rawUrl.origin}${normalized}${qs ? `?${qs}` : ""}`;
    }

    const effectiveOrigin = new URL(overrideUrl ?? rawUrl.toString()).origin;
    return handleApiRequest(request, {
      overrideUrl,
      probeOptions: {
        internalOrigin: effectiveOrigin
      }
    });
  }
};
