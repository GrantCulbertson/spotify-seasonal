import { pickBestMatch, type SpotifyCandidate } from './track-match.js';

let tokenPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = process.env;
  const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: SPOTIFY_REFRESH_TOKEN!,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify token refresh failed (${res.status}): ${body}`);
  }
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function getToken(): Promise<string> {
  if (!tokenPromise) tokenPromise = refreshAccessToken();
  return tokenPromise;
}

async function spotifyFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  return fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}

export async function getSpotifyUserId(): Promise<string> {
  const res = await spotifyFetch('/me');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify /me failed (${res.status}): ${body}`);
  }
  const data = await res.json() as { id: string };
  return data.id;
}

interface SearchItem {
  uri: string;
  name: string;
  explicit: boolean;
  popularity: number;
  artists: Array<{ name: string }>;
  album: { name: string };
}

async function search(q: string): Promise<SpotifyCandidate[]> {
  const res = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=20`);
  if (!res.ok) return [];
  const data = await res.json() as { tracks?: { items?: SearchItem[] } };
  return (data.tracks?.items ?? []).map((i) => ({
    uri: i.uri,
    name: i.name,
    artists: i.artists.map((a) => a.name),
    album: i.album?.name ?? '',
    explicit: i.explicit,
    popularity: i.popularity ?? 0,
  }));
}

export async function searchTrackUri(
  trackName: string,
  artistName: string,
  albumName?: string | null,
): Promise<string | null> {
  // Field-filtered search first; fall back to a loose query, which recalls
  // tracks whose Last.fm metadata doesn't line up with Spotify's fields.
  let candidates = await search(`track:${trackName} artist:${artistName}`);
  if (candidates.length === 0) {
    candidates = await search(`${trackName} ${artistName}`);
  }

  const match = pickBestMatch({ trackName, artistName, albumName }, candidates);
  if (!match) {
    console.warn(
      `  No confident match for "${trackName}" by "${artistName}" ` +
      `(${candidates.length} candidates considered) — skipping`,
    );
    return null;
  }
  return match.uri;
}

export async function createPlaylist(
  userId: string,
  name: string,
  description: string,
): Promise<{ id: string; externalUrl: string }> {
  const res = await spotifyFetch(`/users/${userId}/playlists`, {
    method: 'POST',
    body: JSON.stringify({ name, public: true, collaborative: false, description }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Create playlist failed (${res.status}): ${body}`);
  }
  const data = await res.json() as { id: string; external_urls: { spotify: string } };
  return { id: data.id, externalUrl: data.external_urls.spotify };
}

export async function getPlaylistCoverImage(playlistId: string): Promise<string | null> {
  const res = await spotifyFetch(`/playlists/${playlistId}/images`);
  if (!res.ok) return null;
  const data = await res.json() as Array<{ url: string; height: number | null; width: number | null }>;
  return data[0]?.url ?? null;
}

export async function addTracksToPlaylist(playlistId: string, uris: string[]): Promise<void> {
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    const res = await spotifyFetch(`/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: chunk }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Add tracks failed (${res.status}): ${body}`);
    }
  }
}

export async function resolveUris(
  tracks: Array<{ trackName: string; artistName: string; albumName?: string | null }>,
  concurrency = 10,
): Promise<Array<string | null>> {
  const results: Array<string | null> = new Array(tracks.length).fill(null);
  const queue = tracks.map((t, i) => ({ ...t, i }));

  async function worker(): Promise<void> {
    while (true) {
      const item = queue.shift();
      if (!item) break;
      try {
        results[item.i] = await searchTrackUri(item.trackName, item.artistName, item.albumName);
      } catch (err) {
        console.error(`Failed to resolve URI for "${item.trackName}" by "${item.artistName}":`, err);
        results[item.i] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
