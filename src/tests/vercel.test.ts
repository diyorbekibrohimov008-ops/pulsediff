import { afterEach, describe, expect, it } from "vitest";
import apiHandler from "../../api/handler.ts";
import { handleApiRequest } from "../server/app.ts";
import { MemoryKvStore, setKvStoreForTests, VercelBlobKvStore, type VercelBlobSdk } from "../server/store.ts";

function createMockBlobSdk(): {
  sdk: VercelBlobSdk;
  putOptions: Array<Record<string, unknown>>;
  getOptions: Array<Record<string, unknown>>;
} {
  const objects = new Map<string, string>();
  const putOptions: Array<Record<string, unknown>> = [];
  const getOptions: Array<Record<string, unknown>> = [];

  const sdk: VercelBlobSdk = {
    async put(pathname, body, options) {
      putOptions.push({ pathname, ...options });
      objects.set(pathname, body);
      return { pathname };
    },
    async get(pathname, options) {
      getOptions.push({ pathname, ...options });
      const raw = objects.get(pathname);
      if (raw === undefined) {
        return null;
      }
      const bytes = new TextEncoder().encode(raw);
      return {
        statusCode: 200,
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          }
        })
      };
    },
    async del(pathname) {
      if (!objects.has(pathname)) {
        const err = new Error("Blob not found");
        err.name = "BlobNotFoundError";
        throw err;
      }
      objects.delete(pathname);
    },
    async list(options) {
      const prefix = options?.prefix ?? "";
      const all = Array.from(objects.keys())
        .filter((pathname) => pathname.startsWith(prefix))
        .sort();
      const offset = options?.cursor ? Number(options.cursor) : 0;
      // Paginate 2 items per page to exercise cursor looping.
      const pageSize = 2;
      const slice = all.slice(offset, offset + pageSize);
      const nextOffset = offset + slice.length;
      return {
        blobs: slice.map((pathname) => ({ pathname })),
        cursor: nextOffset < all.length ? String(nextOffset) : undefined
      };
    }
  };

  return { sdk, putOptions, getOptions };
}

afterEach(() => {
  setKvStoreForTests(null);
  delete process.env.VERCEL;
});

describe("VercelBlobKvStore & api/handler", () => {
  it("stores, reads strongly consistently, paginates prefixes, and deletes private JSON blobs", async () => {
    const { sdk, putOptions, getOptions } = createMockBlobSdk();
    const store = new VercelBlobKvStore(async () => sdk);

    await store.setJSON("monitors/mon_1", { name: "API", ok: true });
    await store.setJSON("monitors/mon_2", { name: "Web", ok: false });
    await store.setJSON("monitors/mon_3", { name: "Worker", ok: true });
    await store.setJSON("monitors-other/unrelated", { name: "Skip" });

    expect(putOptions[0]).toMatchObject({
      pathname: "pulsediff-data-v1/monitors/mon_1.json",
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json"
    });

    const loaded = await store.getJSON<{ name: string; ok: boolean }>("monitors/mon_1");
    expect(loaded).toEqual({ name: "API", ok: true });
    expect(getOptions[0]).toMatchObject({
      pathname: "pulsediff-data-v1/monitors/mon_1.json",
      access: "private",
      useCache: false
    });

    expect(await store.listKeys("monitors/")).toEqual([
      "monitors/mon_1",
      "monitors/mon_2",
      "monitors/mon_3"
    ]);

    await store.delete("monitors/mon_2");
    expect(await store.getJSON("monitors/mon_2")).toBeNull();
    await expect(store.delete("monitors/missing")).resolves.toBeUndefined();
  });

  it("rewrites ?__path=/api/... queries in api/handler and reports vercel environment", async () => {
    const store = new MemoryKvStore();
    setKvStoreForTests(store);
    process.env.VERCEL = "1";

    // Seed workspace without external network calls before hitting the rewritten serverless handler.
    const seedRes = await handleApiRequest(
      new Request("https://pulsediff-uptime.vercel.app/api/dashboard"),
      {
        store,
        skipSeedProbe: true,
        probeOptions: { internalOrigin: "https://pulsediff-uptime.vercel.app" }
      }
    );
    expect(seedRes.status).toBe(200);

    const healthReq = new Request(
      "https://pulsediff-uptime.vercel.app/api/handler?__path=/api/health&probe=1"
    );
    const healthRes = await apiHandler.fetch(healthReq);
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toMatchObject({
      ok: true,
      service: "pulsediff"
    });

    const dashReq = new Request(
      "https://pulsediff-uptime.vercel.app/api/handler?__path=/api/dashboard"
    );
    const dashRes = await apiHandler.fetch(dashReq);
    expect(dashRes.status).toBe(200);
    const dashPayload = (await dashRes.json()) as {
      monitors: unknown[];
      runtimeInfo: { environment: string; schedulerMode: string };
    };
    expect(dashPayload.monitors).toHaveLength(3);
    expect(dashPayload.runtimeInfo.environment).toBe("vercel");
  });
});
