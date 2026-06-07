import { getDb, closeDb } from './db.js';
import { getEndedSeasonYear } from './season.js';
import { resolveUris, getSpotifyUserId, createPlaylist, addTracksToPlaylist } from './spotify.js';
import { generateNarrative, sendEmail, type SeasonStats } from './email.js';

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function main(): Promise<void> {
  const seasonYear = getEndedSeasonYear();
  console.log(`Running seasonal playlist for: ${seasonYear}`);

  const db = getDb();

  // 1. Qualifying tracks (≥15 plays this season)
  const tracksResult = await db.query<{
    track_name: string;
    artist_name: string;
    play_count: string;
  }>(
    `SELECT track_name, artist_name, COUNT(*) AS play_count
     FROM scrobbles
     WHERE season_year = $1
     GROUP BY track_name, artist_name
     HAVING COUNT(*) >= 15
     ORDER BY COUNT(*) DESC`,
    [seasonYear],
  );

  const tracks = tracksResult.rows;
  console.log(`Found ${tracks.length} qualifying tracks (≥15 plays)`);

  if (tracks.length === 0) {
    console.log('No qualifying tracks — skipping playlist and email.');
    return;
  }

  try {
  // 2. Resolve Spotify URIs
  console.log('Resolving Spotify URIs (concurrency: 10)...');
  const uris = await resolveUris(
    tracks.map((t) => ({ trackName: t.track_name, artistName: t.artist_name })),
  );
  const resolvedUris = uris.filter((u): u is string => u !== null);
  console.log(`Resolved ${resolvedUris.length}/${tracks.length} URIs (${tracks.length - resolvedUris.length} unmatched, skipped)`);

  // 3. Create Spotify playlist
  const userId = await getSpotifyUserId();
  const { id: playlistId, externalUrl: playlistUrl } = await createPlaylist(
    userId,
    seasonYear,
    `Tracks with ≥15 plays during ${seasonYear}`,
  );
  await addTracksToPlaylist(playlistId, resolvedUris);
  console.log(`Playlist created: ${playlistUrl}`);

  // 4. Gather stats
  const [totalRes, topArtistsRes, topTracksRes, activeDayRes, prevSeasonRes] = await Promise.all([
    db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM scrobbles WHERE season_year = $1`,
      [seasonYear],
    ),
    db.query<{ artist_name: string; cnt: string }>(
      `SELECT artist_name, COUNT(*) AS cnt
       FROM scrobbles WHERE season_year = $1
       GROUP BY artist_name ORDER BY cnt DESC LIMIT 3`,
      [seasonYear],
    ),
    db.query<{ track_name: string; artist_name: string; cnt: string }>(
      `SELECT track_name, artist_name, COUNT(*) AS cnt
       FROM scrobbles WHERE season_year = $1
       GROUP BY track_name, artist_name ORDER BY cnt DESC LIMIT 3`,
      [seasonYear],
    ),
    db.query<{ dow: string; cnt: string }>(
      `SELECT EXTRACT(DOW FROM date)::int AS dow, COUNT(*) AS cnt
       FROM scrobbles WHERE season_year = $1
       GROUP BY dow ORDER BY cnt DESC LIMIT 1`,
      [seasonYear],
    ),
    db.query<{ season_year: string; total: string }>(
      `SELECT season_year, COUNT(*) AS total
       FROM scrobbles
       WHERE season_year != $1
       GROUP BY season_year
       ORDER BY MAX(played_at) DESC
       LIMIT 1`,
      [seasonYear],
    ),
  ]);

  const totalScrobbles = Number(totalRes.rows[0]?.total ?? 0);
  const topArtists = topArtistsRes.rows.map((r) => ({ name: r.artist_name, count: Number(r.cnt) }));
  const topTracks = topTracksRes.rows.map((r) => ({
    name: r.track_name,
    artist: r.artist_name,
    count: Number(r.cnt),
  }));
  const mostActiveDow = Number(activeDayRes.rows[0]?.dow ?? 0);
  const mostActiveDay = DOW_NAMES[mostActiveDow] ?? 'Unknown';

  let vsLastSeasonPct: number | null = null;
  if (prevSeasonRes.rows.length > 0) {
    const prevTotal = Number(prevSeasonRes.rows[0].total);
    if (prevTotal > 0) {
      vsLastSeasonPct = Math.round(((totalScrobbles - prevTotal) / prevTotal) * 100);
    }
  }

  const stats: SeasonStats = {
    seasonYear,
    totalScrobbles,
    topArtists,
    topTracks,
    mostActiveDay,
    vsLastSeasonPct,
    playlistUrl,
    playlistTrackCount: resolvedUris.length,
  };

  // 5. Generate narrative and send email
  console.log('Generating narrative with Claude Haiku...');
  const narrative = await generateNarrative(stats);
  console.log(`Narrative: ${narrative}`);

  console.log('Sending email...');
  await sendEmail(stats, narrative);

  console.log('Done.');
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
