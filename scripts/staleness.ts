/** Consecutive scrobble-free days before we treat the feed as broken. */
export const STALE_AFTER_DAYS = 3;

/** How often to re-alert while the outage continues. */
const REMINDER_INTERVAL_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/** Whole UTC days between the last scrobble and now. Never negative. */
export function daysSince(lastPlayedAt: Date, now: Date): number {
  const startOfDay = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.max(0, Math.round((startOfDay(now) - startOfDay(lastPlayedAt)) / MS_PER_DAY));
}

/**
 * Alert on the day the gap first reaches the threshold, then weekly. A quiet
 * day or two is normal; a week of silence means the Last.fm → Spotify link has
 * almost certainly broken, and a single email that never repeats is easy to
 * miss.
 */
export function shouldAlert(daysSinceLastScrobble: number): boolean {
  if (daysSinceLastScrobble < STALE_AFTER_DAYS) return false;
  return (daysSinceLastScrobble - STALE_AFTER_DAYS) % REMINDER_INTERVAL_DAYS === 0;
}
