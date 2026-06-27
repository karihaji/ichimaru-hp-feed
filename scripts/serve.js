import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./utils.js";

const port = Number(process.env.PORT || 4173);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    const target = resolveTarget(pathname);
    const stat = await fs.stat(target);
    const filePath = stat.isDirectory() ? path.join(target, "index.html") : target;
    const content = await fs.readFile(filePath);

    response.writeHead(200, {
      "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Serving http://localhost:${port}/`);
  console.log(`Compact http://localhost:${port}/compact/`);
  console.log(`List    http://localhost:${port}/list/`);
});

function resolveTarget(pathname) {
  const safe = pathname.replace(/^\/+/, "");
  const target = path.normalize(path.join(repoRoot, safe));
  if (!target.startsWith(repoRoot)) {
    throw new Error("Invalid path");
  }
  return target;
}
