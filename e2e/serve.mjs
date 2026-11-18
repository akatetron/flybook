// Serves a production build at the site root, like flybookapp.in on GitHub Pages.
// Run directly to serve dist/; tests can also start one for a copied build.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
  ".wasm": "application/wasm", ".data": "application/octet-stream", ".woff2": "font/woff2",
};

export function startServer(root, port) {
  const base = root.endsWith("/") ? root : root + "/";
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let path = normalize(join(base, decodeURIComponent(url.pathname.slice(1))));
    if (!path.startsWith(base)) return void res.writeHead(403).end();
    try {
      if ((await stat(path)).isDirectory()) path = join(path, "index.html");
      const body = await readFile(path);
      // Like GitHub Pages: a short cache lifetime, so updated files are fetched again.
      res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream", "content-length": body.length, "cache-control": "max-age=0" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4173);
  await startServer(fileURLToPath(new URL("../dist/", import.meta.url)), port);
  console.log(`serving dist at http://localhost:${port}/`);
}
