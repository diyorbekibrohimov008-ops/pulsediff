import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "./src/server/app.ts";
import { runDueMonitors } from "./src/server/engine.ts";
import { ensureSeededWorkspace } from "./src/server/seed.ts";
import { getKvStore } from "./src/server/store.ts";

const isDev = process.argv.includes("--dev");
const defaultPort = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_REQUEST_BODY_BYTES = 1024 * 1024; // 1 MB

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff"
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

function applySecurityHeaders(res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!res.hasHeader(k)) res.setHeader(k, v);
  }
}

async function readNodeRequestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      const err = new Error("Request body too large");
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export async function createPulseDiffServer(options = {}) {
  const port = options.port ?? defaultPort;
  const host = options.host || "127.0.0.1";
  const devMode = options.isDev ?? isDev;
  const enableScheduler = options.enableScheduler ?? true;
  let origin = `http://localhost:${port}`;

  let vite = null;
  if (devMode) {
    const { createServer } = await import("vite");
    vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
  }

  const distDir = path.resolve(__dirname, "dist");

  const server = http.createServer(async (req, res) => {
    applySecurityHeaders(res);
    let reqUrl;
    try {
      reqUrl = new URL(req.url || "/", origin);
    } catch {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Malformed request URL" }));
      return;
    }

    if (reqUrl.pathname.startsWith("/api/")) {
      try {
        const bodyBuf = await readNodeRequestBody(req);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (v !== undefined) {
            headers.set(k, Array.isArray(v) ? v.join(", ") : v);
          }
        }
        const webReq = new Request(reqUrl.toString(), {
          method: req.method || "GET",
          headers,
          body: bodyBuf && bodyBuf.length > 0 ? new Uint8Array(bodyBuf) : undefined
        });

        const webRes = await handleApiRequest(webReq, {
          skipSeedProbe: options.skipSeedProbe,
          probeOptions: {
            internalOrigin: origin,
            allowPrivateNetwork: false
          }
        });
        res.statusCode = webRes.status;
        webRes.headers.forEach((v, k) => res.setHeader(k, v));
        const resBuf = Buffer.from(await webRes.arrayBuffer());
        res.end(resBuf);
      } catch (err) {
        if (err && typeof err === "object" && "statusCode" in err && err.statusCode === 413) {
          res.statusCode = 413;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "Request body too large" }));
          return;
        }
        console.error("API error:", err);
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
      return;
    }

    if (vite) {
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end("Not found");
      });
      return;
    }

    // Production static file serving + SPA fallback
    let decodedPathname;
    try {
      decodedPathname = decodeURIComponent(reqUrl.pathname);
    } catch {
      res.statusCode = 400;
      res.end("Bad request");
      return;
    }
    const cleanRel = decodedPathname.replace(/^\/+/, "");
    const candidate = path.resolve(distDir, cleanRel || "index.html");
    const safePath =
      candidate === distDir || candidate.startsWith(distDir + path.sep)
        ? candidate
        : path.join(distDir, "index.html");

    let filePath = safePath;
    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(distDir, "index.html");
      }
    } catch {
      filePath = path.join(distDir, "index.html");
    }

    try {
      const content = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.statusCode = 200;
      res.setHeader("content-type", MIME_TYPES[ext] || "application/octet-stream");
      res.end(content);
    } catch {
      res.statusCode = 404;
      res.end("Build output missing. Run npm run build.");
    }
  });

  await new Promise((resolve) => {
    server.listen(port, host, () => resolve());
  });
  const addr = server.address();
  if (addr && typeof addr !== "string") {
    origin = `http://${host === "0.0.0.0" ? "localhost" : host}:${addr.port}`;
  }

  let timer = null;
  let seedTimeout = null;
  if (enableScheduler) {
    const store = getKvStore();
    seedTimeout = setTimeout(async () => {
      await ensureSeededWorkspace(store, origin, {
        probeOptions: { internalOrigin: origin }
      }).catch((err) => console.error("Seed error:", err));
    }, 500);

    timer = setInterval(async () => {
      try {
        await runDueMonitors(store, {
          forceAll: false,
          probeOptions: { internalOrigin: origin }
        });
      } catch (err) {
        console.error("Background tick error:", err);
      }
    }, 15_000);
  }

  async function close() {
    if (seedTimeout) clearTimeout(seedTimeout);
    if (timer) clearInterval(timer);
    if (vite) await vite.close();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, origin, close };
}

async function main() {
  const host = process.env.HOST || "0.0.0.0";
  const instance = await createPulseDiffServer({ port: defaultPort, host, isDev, enableScheduler: true });
  console.log(`PulseDiff server listening on ${instance.origin} (${isDev ? "dev" : "prod"})`);
  const shutdown = () => {
    instance.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main();
}
