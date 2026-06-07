const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
const LASTFM_USER = 'shura4K';

export interface Scrobble {
  trackName: string;
  artistName: string;
  albumName: string | null;
  playedAt: Date;
}

export async function fetchScrobbles(fromUnix: number, toUnix: number): Promise<Scrobble[]> {
  const results: Scrobble[] = [];
  let page = 1;

  while (true) {
    const url = new URL(LASTFM_BASE);
    url.searchParams.set('method', 'user.getRecentTracks');
    url.searchParams.set('user', LASTFM_USER);
    url.searchParams.set('api_key', process.env.LASTFM_API_KEY!);
    url.searchParams.set('format', 'json');
    url.searchParams.set('from', String(fromUnix));
    url.searchParams.set('to', String(toUnix));
    url.searchParams.set('limit', '200');
    url.searchParams.set('page', String(page));

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Last.fm API error: HTTP ${res.status}`);
    const data = await res.json() as {
      recenttracks: {
        track: Array<{
          name: string;
          artist: { '#text': string };
          album?: { '#text': string };
          date?: { uts: string };
          '@attr'?: { nowplaying?: string };
        }>;
        '@attr': { totalPages: string };
      };
    };

    const rawTracks = data.recenttracks?.track;
    const tracks = Array.isArray(rawTracks) ? rawTracks : rawTracks ? [rawTracks] : [];
    const totalPages = Number(data.recenttracks?.['@attr']?.totalPages ?? 1);

    for (const t of tracks) {
      if (t['@attr']?.nowplaying) continue;
      if (!t.date?.uts) continue;
      results.push({
        trackName: t.name,
        artistName: t.artist['#text'],
        albumName: t.album?.['#text'] || null,
        playedAt: new Date(Number(t.date.uts) * 1000),
      });
    }

    if (page >= totalPages) break;
    page++;
    await new Promise((r) => setTimeout(r, 200));
  }

  return results;
}
