import { Request, Response, NextFunction } from "express";

interface CacheEntry {
  body: string;
  statusCode: number;
  storedAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Lightweight in-memory TTL cache for Express responses.
 *
 * Cache key = `req.originalUrl` (includes query params).
 * Only caches successful GET responses (2xx).
 * Returns `X-Cache: HIT` or `X-Cache: MISS` header for debugging.
 *
 * On Lambda, the cache lives as long as the warm execution environment,
 * which is typically reused across multiple invocations.
 */
export function responseCache(ttlMs: number = DEFAULT_TTL_MS) {
  const cache = new Map<string, CacheEntry>();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== "GET") {
      next();
      return;
    }

    // Browser / CDN caching: serve stale while revalidating in the background.
    const maxAgeSec = Math.round(ttlMs / 1000);
    res.setHeader(
      "Cache-Control",
      `public, max-age=${maxAgeSec}, stale-while-revalidate=${maxAgeSec * 2}`,
    );

    const key = req.originalUrl;
    const cached = cache.get(key);

    if (cached && Date.now() - cached.storedAt < ttlMs) {
      res.setHeader("X-Cache", "HIT");
      res.status(cached.statusCode).json(JSON.parse(cached.body));
      return;
    }

    // Intercept res.json to capture the response body before sending.
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.set(key, {
          body: JSON.stringify(body),
          statusCode: res.statusCode,
          storedAt: Date.now(),
        });
      }
      res.setHeader("X-Cache", "MISS");
      return originalJson(body);
    };

    next();
  };
}
