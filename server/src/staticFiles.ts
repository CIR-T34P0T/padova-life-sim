// Serves the built client (client/dist) from the game server (M12), so in
// production one process and one address carry the page, the matchmaking
// requests and the WebSockets, behind one HTTPS proxy. Off unless the server
// is given the folder (CLIENT_DIST); development uses Vite instead.
//
// Only GET and HEAD, only files inside the folder (no dotfiles, no paths that
// climb out), and anything not found goes on to the next handler (the game's
// own routes and Colyseus's matchmaking).

import { createReadStream, statSync, type Stats } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export type NextHandler = () => void;
export type StaticHandler = (req: IncomingMessage, res: ServerResponse, next: NextHandler) => void;

/** The file a request path names inside `root`, or null when it isn't a servable file there. */
export function resolveStaticFile(root: string, urlPath: string): { path: string; stats: Stats } | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(urlPath, "http://local").pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0") || pathname.split("/").some((part) => part.startsWith("."))) return null;
  if (pathname.endsWith("/")) pathname += "index.html";
  const base = resolve(root);
  const path = resolve(base, `.${pathname}`);
  if (!path.startsWith(base + sep)) return null;
  try {
    const stats = statSync(path);
    return stats.isFile() ? { path, stats } : null;
  } catch {
    return null;
  }
}

/** Express-style handler serving the files in `root`. */
export function staticFileHandler(root: string): StaticHandler {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const file = resolveStaticFile(root, req.url ?? "/");
    if (!file) return next();
    res.statusCode = 200;
    res.setHeader("Content-Type", TYPES[extname(file.path).toLowerCase()] ?? "application/octet-stream");
    res.setHeader("Content-Length", String(file.stats.size));
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Vite names built assets by their content, so they never change; pages always revalidate.
    const immutable = file.path.includes(`${sep}assets${sep}`);
    res.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = createReadStream(file.path);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  };
}
