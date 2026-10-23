const RETENTION_SECONDS = 24 * 60 * 60;

/**
 * Remove abandoned rate-limit windows without touching any recent window.
 * window_start is stored as a Unix timestamp in seconds and auth windows are
 * ten minutes long. The 24-hour retention is intentionally much longer than
 * an active limit window.
 */
export async function cleanupExpiredRateLimits(env, nowMs = Date.now()) {
  const now = Number(nowMs);
  if (!Number.isFinite(now)) throw new TypeError('nowMs must be a finite timestamp.');
  const cutoff = Math.floor(now / 1000) - RETENTION_SECONDS;
  const result = await env.DB.prepare(
    'DELETE FROM auth_rate_limits WHERE window_start < ?'
  ).bind(cutoff).run();
  return { cutoff, deleted: Number(result?.meta?.changes ?? 0) };
}
