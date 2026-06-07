import { getDb, closeDb } from './db.js';
import { fetchScrobbles } from './lastfm.js';
import { computeSeason, computeSeasonYear } from './season.js';

const BATCH_DAYS = 30;
const RATE_LIMIT_MS = 250;

// Adjust START_DATE if you want to go back further (Last.fm supports full history)
const START_DATE = new Date('2014-01-01T00:00:00Z');

async function main(): Promise<void> {
  const db = getDb();
  let totalInserted = 0;
  let totalSkipped = 0;

  const endDate = new Date();
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  endDate.setUTCHours(23, 59, 59, 0);

  console.log(`Backfilling from ${START_DATE.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`);
  console.log('This will take several minutes for a large history. Safe to re-run.\n');

  let cursor = new Date(START_DATE);

  while (cursor <= endDate) {
    const batchEnd = new Date(cursor);
    batchEnd.setUTCDate(batchEnd.getUTCDate() + BATCH_DAYS - 1);
    batchEnd.setUTCHours(23, 59, 59, 0);
    if (batchEnd > endDate) batchEnd.setTime(endDate.getTime());

    const fromUnix = Math.floor(cursor.getTime() / 1000);
    const toUnix = Math.floor(batchEnd.getTime() / 1000);
    const label = `${cursor.toISOString().slice(0, 10)} → ${batchEnd.toISOString().slice(0, 10)}`;

    process.stdout.write(`Fetching ${label} ... `);

    try {
      const scrobbles = await fetchScrobbles(fromUnix, toUnix);

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
        if (result.rowCount) totalInserted++;
        else totalSkipped++;
      }

      console.log(`${scrobbles.length} scrobbles (total: ${totalInserted} inserted, ${totalSkipped} skipped)`);
    } catch (err) {
      console.error(`\n  Error on batch ${label}:`, err);
    }

    cursor.setUTCDate(cursor.getUTCDate() + BATCH_DAYS);
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  console.log(`\n✅ Backfill complete: ${totalInserted} rows inserted, ${totalSkipped} duplicates skipped`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
