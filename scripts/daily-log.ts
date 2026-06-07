import { getDb, closeDb } from './db.js';
import { fetchScrobbles } from './lastfm.js';
import { computeSeason, computeSeasonYear } from './season.js';

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
