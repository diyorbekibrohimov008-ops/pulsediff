import { getStore } from "@netlify/blobs";
import fs from "node:fs/promises";
import path from "node:path";

export interface KvStore {
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
}

const STORE_NAME = "pulsediff-data-v1";

export function isNetlifyRuntime(): boolean {
  if (typeof globalThis !== "undefined" && "Netlify" in globalThis) {
    return true;
  }
  return Boolean(
    process.env.NETLIFY ||
      process.env.NETLIFY_BLOBS_CONTEXT ||
      process.env.CONTEXT
  );
}

function isVercelBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

class NetlifyBlobsKvStore implements KvStore {
  private getHandle() {
    return getStore({ name: STORE_NAME, consistency: "strong" });
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const store = this.getHandle();
    const data = await store.get(key, { type: "json", consistency: "strong" });
    return (data as T | null) ?? null;
  }

  async setJSON(key: string, value: unknown): Promise<void> {
    const store = this.getHandle();
    await store.setJSON(key, value);
  }

  async delete(key: string): Promise<void> {
    const store = this.getHandle();
    await store.delete(key);
  }

  async listKeys(prefix: string): Promise<string[]> {
    const store = this.getHandle();
    const { blobs } = await store.list({ prefix });
    return blobs.map((b) => b.key).sort();
  }
}

export class MemoryKvStore implements KvStore {
  private data = new Map<string, string>();

  async getJSON<T>(key: string): Promise<T | null> {
    const raw = this.data.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setJSON(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async listKeys(prefix: string): Promise<string[]> {
    return Array.from(this.data.keys())
      .filter((k) => k.startsWith(prefix))
      .sort();
  }
}

class FileKvStore implements KvStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private keyToPath(key: string): string {
    const safeSegments = key
      .split("/")
      .filter(Boolean)
      .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, "_"));
    return path.join(this.rootDir, ...safeSegments) + ".json";
  }

  async getJSON<T>(key: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(this.keyToPath(key), "utf8");
      return JSON.parse(raw) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async setJSON(key: string, value: unknown): Promise<void> {
    const filePath = this.keyToPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.keyToPath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    const results: string[] = [];
    const walk = async (dir: string, relParts: string[]) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return;
        }
        throw err;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), [...relParts, entry.name]);
        } else if (entry.isFile() && entry.name.endsWith(".json")) {
          const key = [...relParts, entry.name.slice(0, -5)].join("/");
          if (key.startsWith(prefix)) {
            results.push(key);
          }
        }
      }
    };
    await walk(this.rootDir, []);
    return results.sort();
  }
}

export interface VercelBlobSdk {
  put: (
    pathname: string,
    body: string,
    options: {
      access: "private";
      allowOverwrite?: boolean;
      addRandomSuffix?: boolean;
      contentType?: string;
    }
  ) => Promise<unknown>;
  get: (
    pathname: string,
    options: { access: "private"; useCache?: boolean }
  ) => Promise<{
    statusCode: number;
    stream: ReadableStream<Uint8Array> | null;
  } | null>;
  del: (urlOrPathname: string) => Promise<void>;
  list: (options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }) => Promise<{
    blobs: Array<{ pathname: string }>;
    cursor?: string;
  }>;
}

let vercelBlobSdkPromise: Promise<VercelBlobSdk> | null = null;

async function loadVercelBlobSdk(): Promise<VercelBlobSdk> {
  if (!vercelBlobSdkPromise) {
    // Literal specifier ensures @vercel/nft bundles @vercel/blob in Vercel functions.
    // @ts-ignore Resolved by Vercel cloud install via package.json dependencies.
    vercelBlobSdkPromise = import("@vercel/blob") as Promise<VercelBlobSdk>;
  }
  return vercelBlobSdkPromise;
}

export class VercelBlobKvStore implements KvStore {
  private readonly getSdk: () => Promise<VercelBlobSdk>;

  constructor(getSdk: () => Promise<VercelBlobSdk> = loadVercelBlobSdk) {
    this.getSdk = getSdk;
  }

  private normalizePrefix(prefix: string): string {
    const clean = prefix
      .split("/")
      .filter(Boolean)
      .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, "_"))
      .join("/");
    return clean ? `${STORE_NAME}/${clean}` : `${STORE_NAME}/`;
  }

  private keyToPathname(key: string): string {
    const safeSegments = key
      .split("/")
      .filter(Boolean)
      .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, "_"));
    return `${STORE_NAME}/${safeSegments.join("/")}.json`;
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const { get } = await this.getSdk();
    const res = await get(this.keyToPathname(key), {
      access: "private",
      useCache: false
    });
    if (!res || !res.stream) {
      return null;
    }
    const raw = await new Response(res.stream).text();
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setJSON(key: string, value: unknown): Promise<void> {
    const { put } = await this.getSdk();
    await put(this.keyToPathname(key), JSON.stringify(value), {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json"
    });
  }

  async delete(key: string): Promise<void> {
    const { del } = await this.getSdk();
    try {
      await del(this.keyToPathname(key));
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name !== "BlobNotFoundError") {
        throw err;
      }
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    const { list } = await this.getSdk();
    const keys: string[] = [];
    const blobPrefix = this.normalizePrefix(prefix);
    const rootPrefix = `${STORE_NAME}/`;
    let cursor: string | undefined;

    do {
      const page = await list({ prefix: blobPrefix, limit: 1000, cursor });
      for (const blob of page.blobs) {
        if (!blob.pathname.startsWith(rootPrefix) || !blob.pathname.endsWith(".json")) {
          continue;
        }
        const logicalKey = blob.pathname.slice(rootPrefix.length, -5);
        if (logicalKey.startsWith(prefix)) {
          keys.push(logicalKey);
        }
      }
      cursor = page.cursor;
    } while (cursor);

    return keys.sort();
  }
}

let singletonStore: KvStore | null = null;

export function getKvStore(): KvStore {
  if (singletonStore) {
    return singletonStore;
  }
  if (isVercelBlobConfigured()) {
    singletonStore = new VercelBlobKvStore();
    return singletonStore;
  }
  if (isNetlifyRuntime()) {
    try {
      // Verify Netlify Blobs context exists before committing to it.
      getStore({ name: STORE_NAME, consistency: "strong" });
      singletonStore = new NetlifyBlobsKvStore();
      return singletonStore;
    } catch {
      // Fall through to local file store if running Netlify CLI without Blobs context.
    }
  }
  const baseDir = process.env.VERCEL ? "/tmp" : process.cwd();
  const localDataDir = path.join(baseDir, ".local-data");
  singletonStore = new FileKvStore(localDataDir);
  return singletonStore;
}

export function setKvStoreForTests(store: KvStore | null): void {
  singletonStore = store;
}

export function reverseTimestampKey(timestampMs: number): string {
  const maxMs = 9999999999999;
  const inverted = Math.max(0, maxMs - Math.floor(timestampMs));
  return String(inverted).padStart(13, "0");
}
