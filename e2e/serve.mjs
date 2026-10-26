// Serves the production build under /flybook/, like GitHub Pages does.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("../dist/", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 4173);
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
  ".wasm": "application/wasm", ".data": "application/octet-stream",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (!url.pathname.startsWith("/flybook/")) {
    res.writeHead(url.pathname === "/flybook" ? 301 : 404, { location: "/flybook/" }).end();
    return;
  }
  let path = normalize(join(root, decodeURIComponent(url.pathname.slice("/flybook/".length))));
  if (!path.startsWith(root)) return void res.writeHead(403).end();
  try {
    if ((await stat(path)).isDirectory()) path = join(path, "index.html");
    const body = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream", "content-length": body.length });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`serving dist at http://localhost:${port}/flybook/`));
