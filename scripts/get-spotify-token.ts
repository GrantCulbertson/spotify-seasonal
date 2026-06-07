import http from 'node:http';
import { exec } from 'node:child_process';
import { URL } from 'node:url';

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:8888/callback';
const SCOPE = 'playlist-modify-public playlist-modify-private';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET env vars before running.');
  process.exit(1);
}

const authUrl =
  'https://accounts.spotify.com/authorize?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
  }).toString();

console.log('\nOpening browser for Spotify authorization...');
console.log('If the browser does not open, visit this URL manually:\n');
console.log(authUrl, '\n');

// Try to open browser on Windows (silently ignore failure)
exec(`start "" "${authUrl}"`, () => {});

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/callback')) return;

  const url = new URL(req.url, 'http://localhost:8888');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    res.end(`Auth failed: ${error ?? 'no code received'}`);
    server.close();
    return;
  }

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await tokenRes.json() as { refresh_token?: string; error?: string };

    if (data.error || !data.refresh_token) {
      res.end(`Token exchange failed: ${JSON.stringify(data)}`);
      server.close();
      return;
    }

    res.end('Success! Check your terminal for the refresh token. You can close this tab.');
    server.close();

    console.log('\n✅ SPOTIFY_REFRESH_TOKEN:');
    console.log(data.refresh_token);
    console.log('\nStore this value as the SPOTIFY_REFRESH_TOKEN GitHub secret.');
  } catch (err) {
    res.end('Internal error — check terminal.');
    server.close();
    console.error('Token exchange error:', err);
  }
});

server.listen(8888, () => {
  console.log('Listening on http://localhost:8888/callback — waiting for Spotify redirect...');
});
