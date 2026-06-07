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

export async function searchTrackUri(trackName: string, artistName: string): Promise<string | null> {
  const q = `track:${trackName} artist:${artistName}`;
  const res = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=1`);
  if (!res.ok) return null;
  const data = await res.json() as { tracks: { items: Array<{ uri: string }> } };
  return data.tracks?.items?.[0]?.uri ?? null;
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
  tracks: Array<{ trackName: string; artistName: string }>,
  concurrency = 10,
): Promise<Array<string | null>> {
  const results: Array<string | null> = new Array(tracks.length).fill(null);
  const queue = tracks.map((t, i) => ({ ...t, i }));

  async function worker(): Promise<void> {
    while (true) {
      const item = queue.shift();
      if (!item) break;
      results[item.i] = await searchTrackUri(item.trackName, item.artistName);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
