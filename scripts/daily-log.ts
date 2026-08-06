import { getDb, closeDb } from './db.js';
import { fetchScrobbles } from './lastfm.js';
import { computeSeason, computeSeasonYear } from './season.js';
import { daysSince, shouldAlert, STALE_AFTER_DAYS } from './staleness.js';
import { sendStaleAlert } from './email.js';

/**
 * A dead upstream and a genuinely quiet day both look like "0 scrobbles", so
 * check how long the silence has run and shout if it's gone on too long.
 * Returns true if the feed looks broken.
 */
async function checkStaleness(now: Date): Promise<boolean> {
  const db = getDb();
  const res = await db.query<{ last: Date | null }>(
    `SELECT MAX(played_at) AS last FROM scrobbles`,
  );

  const last = res.rows[0]?.last;
  if (!last) {
    console.log('No scrobbles in the database yet — skipping staleness check.');
    return false;
  }

  const days = daysSince(new Date(last), now);
  const lastDate = new Date(last).toISOString().slice(0, 10);
  console.log(`Last scrobble in database: ${lastDate} (${days} days ago)`);

  if (days < STALE_AFTER_DAYS) return false;

  console.error(`No scrobbles for ${days} days — the Last.fm feed looks broken.`);
  if (shouldAlert(days)) {
    await sendStaleAlert(days, lastDate);
  } else {
    console.log('Alert already sent for this outage — next reminder in a few days.');
  }
  return true;
}

async function main(): Promise<void> {
  const now = new Date();
  const yesterday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 1,
  ));
  const fromUnix = Math.floor(yesterday.getTime() / 1000);
  const toUnix = fromUnix + 86399;

  console.log(`Fetching scrobbles for ${yesterday.toISOString().slice(0, 10)}`);
  const scrobbles = await fetchScrobbles(fromUnix, toUnix);
  console.log(`Found ${scrobbles.length} scrobbles`);

  if (scrobbles.length === 0) {
    console.log('Nothing to insert.');
    try {
      if (await checkStaleness(now)) {
        process.exitCode = 1;  // fail the run so the outage is visible in Actions
      }
    } finally {
      await closeDb();
    }
    return;
  }

  const db = getDb();
  let inserted = 0;

  for (const s of scrobbles) {
    const month = s.playedAt.getUTCMonth() + 1;
    const year = s.playedAt.getUTCFullYear();
    const result = await db.query(
      `INSERT INTO scrobbles (track_name, artist_name, album_name, played_at, date, season, season_year)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (track_name, artist_name, played_at) DO NOTHING`,
      [
        s.trackName,
        s.artistName,
        s.albumName,
        s.playedAt.toISOString(),
        s.playedAt.toISOString().slice(0, 10),
        computeSeason(month),
        computeSeasonYear(month, year),
      ],
    );
    if (result.rowCount) inserted++;
  }

  console.log(`Inserted ${inserted} new rows (${scrobbles.length - inserted} duplicates skipped)`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
