# Spotify Seasonal Playlists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a system that logs daily Last.fm scrobbles to Neon Postgres and, on the first day of each season, creates a Spotify playlist of that season's most-played tracks and sends a narrative email summary.

**Architecture:** Two GitHub Actions workflows run on cron schedules — a daily logger that pulls yesterday's scrobbles from Last.fm and inserts them into Neon, and a seasonal creator that queries qualifying tracks, creates a Spotify playlist, generates a Claude Haiku narrative, and sends an email via Resend. A one-time backfill script seeds the database with full Last.fm history before the first seasonal run.

**Tech Stack:** Node.js 20, TypeScript, tsx (script runner), pg (Postgres client), @anthropic-ai/sdk, resend, GitHub Actions, Neon Postgres, Last.fm API, Spotify Web API, Resend, Claude Haiku 4.5

---

## File Structure

```
scripts/
  db.ts                   # Neon Pool singleton + closeDb
  season.ts               # Pure functions: computeSeason, computeSeasonYear, getEndedSeasonYear
  lastfm.ts               # fetchScrobbles(from, to) with Last.fm pagination
  spotify.ts              # Token refresh, searchTrackUri, createPlaylist, addTracksToPlaylist, resolveUris
  email.ts                # generateNarrative (Claude Haiku) + sendEmail (Resend)
  daily-log.ts            # Entry point: fetch yesterday → insert Neon
  seasonal-playlist.ts    # Entry point: query Neon → Spotify playlist → email
  backfill.ts             # One-time: page through full Last.fm history → Neon
  get-spotify-token.ts    # One-time local OAuth helper to get refresh token
  schema.sql              # CREATE TABLE + indexes (apply once in Neon console)
  tests/
    season.test.ts        # Unit tests for all season utility functions

.github/workflows/
  daily-log.yml           # Cron: 0 9 * * *
  seasonal-playlist.yml   # Cron: 0 9 1 3,6,9,12 *

tsconfig.scripts.json     # NodeNext tsconfig for type-checking scripts/
package.json              # Add: pg, @anthropic-ai/sdk, resend, tsx, @types/pg
```

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.scripts.json`

- [ ] **Step 1: Initialize package.json**

```bash
npm init -y
```

- [ ] **Step 2: Install runtime dependencies**

```bash
npm install pg @anthropic-ai/sdk resend
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D tsx @types/node @types/pg typescript
```

- [ ] **Step 4: Create tsconfig.scripts.json**

Create `tsconfig.scripts.json` in the repo root:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["scripts/**/*.ts"]
}
```

- [ ] **Step 5: Add npm scripts to package.json**

Open `package.json` and replace the `"scripts"` block with:

```json
"scripts": {
  "test:scripts": "node --import tsx/esm --test scripts/tests/*.test.ts",
  "typecheck:scripts": "tsc --noEmit -p tsconfig.scripts.json",
  "daily-log": "npx tsx scripts/daily-log.ts",
  "seasonal-playlist": "npx tsx scripts/seasonal-playlist.ts",
  "backfill": "npx tsx scripts/backfill.ts",
  "get-spotify-token": "npx tsx scripts/get-spotify-token.ts"
}
```

- [ ] **Step 6: Create the database schema file**

Create `scripts/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS scrobbles (
  id          BIGSERIAL PRIMARY KEY,
  track_name  TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  album_name  TEXT,
  played_at   TIMESTAMPTZ NOT NULL,
  date        DATE NOT NULL,
  season      TEXT NOT NULL,
  season_year TEXT NOT NULL,
  UNIQUE (track_name, artist_name, played_at)
);

CREATE INDEX IF NOT EXISTS idx_scrobbles_season_year ON scrobbles (season_year);
CREATE INDEX IF NOT EXISTS idx_scrobbles_date ON scrobbles (date);
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.scripts.json scripts/schema.sql
git commit -m "chore: project setup — deps, tsconfig, schema"
```

---

## Task 2: Database Module

**Files:**
- Create: `scripts/db.ts`

- [ ] **Step 1: Create scripts/db.ts**

```typescript
import { Pool } from 'pg';

let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck:scripts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/db.ts
git commit -m "feat: add Neon database connection helper"
```

---

## Task 3: Season Utilities (TDD)

**Files:**
- Create: `scripts/season.ts`
- Create: `scripts/tests/season.test.ts`

- [ ] **Step 1: Create the test file first**

Create `scripts/tests/season.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSeason, computeSeasonYear, getEndedSeasonYear } from '../season.js';

describe('computeSeason', () => {
  it('returns Winter for December', () => assert.equal(computeSeason(12), 'Winter'));
  it('returns Winter for January',  () => assert.equal(computeSeason(1),  'Winter'));
  it('returns Winter for February', () => assert.equal(computeSeason(2),  'Winter'));
  it('returns Spring for March',    () => assert.equal(computeSeason(3),  'Spring'));
  it('returns Spring for May',      () => assert.equal(computeSeason(5),  'Spring'));
  it('returns Summer for June',     () => assert.equal(computeSeason(6),  'Summer'));
  it('returns Summer for August',   () => assert.equal(computeSeason(8),  'Summer'));
  it('returns Fall for September',  () => assert.equal(computeSeason(9),  'Fall'));
  it('returns Fall for November',   () => assert.equal(computeSeason(11), 'Fall'));
});

describe('computeSeasonYear', () => {
  it("labels December as Winter start year",  () => assert.equal(computeSeasonYear(12, 2024), "Winter'24-25"));
  it("labels January as Winter of prior Dec", () => assert.equal(computeSeasonYear(1,  2025), "Winter'24-25"));
  it("labels February same as January",       () => assert.equal(computeSeasonYear(2,  2025), "Winter'24-25"));
  it("labels March as Spring",                () => assert.equal(computeSeasonYear(3,  2025), "Spring'25"));
  it("labels June as Summer",                 () => assert.equal(computeSeasonYear(6,  2025), "Summer'25"));
  it("labels September as Fall",              () => assert.equal(computeSeasonYear(9,  2025), "Fall'25"));
  it("labels December 1999 as Winter'99-00",  () => assert.equal(computeSeasonYear(12, 1999), "Winter'99-00"));
});

describe('getEndedSeasonYear', () => {
  it("Mar 1 → Winter that just ended", () =>
    assert.equal(getEndedSeasonYear(new Date('2025-03-01T09:00:00Z')), "Winter'24-25"));
  it("Jun 1 → Spring that just ended", () =>
    assert.equal(getEndedSeasonYear(new Date('2025-06-01T09:00:00Z')), "Spring'25"));
  it("Sep 1 → Summer that just ended", () =>
    assert.equal(getEndedSeasonYear(new Date('2025-09-01T09:00:00Z')), "Summer'25"));
  it("Dec 1 → Fall that just ended",   () =>
    assert.equal(getEndedSeasonYear(new Date('2025-12-01T09:00:00Z')), "Fall'25"));
});
```

- [ ] **Step 2: Run tests — verify they fail (module not found)**

```bash
npm run test:scripts
```

Expected: Error — `Cannot find module '../season.js'`

- [ ] **Step 3: Create scripts/season.ts**

```typescript
export type Season = 'Winter' | 'Spring' | 'Summer' | 'Fall';

export function computeSeason(month: number): Season {
  if (month === 12 || month <= 2) return 'Winter';
  if (month <= 5) return 'Spring';
  if (month <= 8) return 'Summer';
  return 'Fall';
}

export function computeSeasonYear(month: number, year: number): string {
  if (month === 12 || month <= 2) {
    const winterStart = month === 12 ? year : year - 1;
    const yy1 = String(winterStart % 100).padStart(2, '0');
    const yy2 = String((winterStart + 1) % 100).padStart(2, '0');
    return `Winter'${yy1}-${yy2}`;
  }
  const season = computeSeason(month);
  const yy = String(year % 100).padStart(2, '0');
  return `${season}'${yy}`;
}

export function getEndedSeasonYear(now: Date = new Date()): string {
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  if (month === 3) {
    const yy1 = String((year - 1) % 100).padStart(2, '0');
    const yy2 = String(year % 100).padStart(2, '0');
    return `Winter'${yy1}-${yy2}`;
  }
  if (month === 6) return `Spring'${String(year % 100).padStart(2, '0')}`;
  if (month === 9) return `Summer'${String(year % 100).padStart(2, '0')}`;
  if (month === 12) return `Fall'${String(year % 100).padStart(2, '0')}`;
  throw new Error(`getEndedSeasonYear called on unexpected month: ${month}. Expected 3, 6, 9, or 12.`);
}
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
npm run test:scripts
```

Expected: All 20 tests pass, no failures.

- [ ] **Step 5: Type-check**

```bash
npm run typecheck:scripts
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/season.ts scripts/tests/season.test.ts
git commit -m "feat: add season utilities with full test coverage"
```

---

## Task 4: Last.fm Client

**Files:**
- Create: `scripts/lastfm.ts`

- [ ] **Step 1: Create scripts/lastfm.ts**

```typescript
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
          album: { '#text': string };
          date?: { uts: string };
          '@attr'?: { nowplaying?: string };
        }>;
        '@attr': { totalPages: string };
      };
    };

    const tracks = data.recenttracks?.track ?? [];
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
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck:scripts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/lastfm.ts
git commit -m "feat: add Last.fm API client with paginated scrobble fetching"
```

---

## Task 5: Daily Log Script

**Files:**
- Create: `scripts/daily-log.ts`

- [ ] **Step 1: Create scripts/daily-log.ts**

```typescript
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
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck:scripts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/daily-log.ts
git commit -m "feat: add daily scrobble logger"
```

---

## Task 6: Spotify Helpers

**Files:**
- Create: `scripts/spotify.ts`

- [ ] **Step 1: Create scripts/spotify.ts**

```typescript
let cachedAccessToken: string | null = null;

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
  if (!cachedAccessToken) cachedAccessToken = await refreshAccessToken();
  return cachedAccessToken;
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
  if (!res.ok) throw new Error(`Spotify /me failed: ${res.status}`);
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
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck:scripts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/spotify.ts
git commit -m "feat: add Spotify API helpers (auth, search, playlist creation)"
```

---

## Task 7: One-Time Spotify OAuth Helper

**Files:**
- Create: `scripts/get-spotify-token.ts`

This script is run **once locally** to obtain a refresh token. It starts a local HTTP server, opens the Spotify OAuth page in your browser, captures the callback code, and exchanges it for tokens.

- [ ] **Step 1: Create scripts/get-spotify-token.ts**

```typescript
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

// Try to open browser (Windows, then macOS, silently ignore failure)
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
    throw err;
  }
});

server.listen(8888, () => {
  console.log('Listening on http://localhost:8888/callback — waiting for Spotify redirect...');
});
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck:scripts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/get-spotify-token.ts
git commit -m "feat: add one-time Spotify OAuth helper script"
```

---

## Task 8: Email & Narrative Helper

**Files:**
- Create: `scripts/email.ts`

- [ ] **Step 1: Create scripts/email.ts**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';

export interface SeasonStats {
  seasonYear: string;
  totalScrobbles: number;
  topArtists: Array<{ name: string; count: number }>;
  topTracks: Array<{ name: string; artist: string; count: number }>;
  mostActiveDay: string;
  vsLastSeasonPct: number | null;
  playlistUrl: string;
  playlistTrackCount: number;
}

export async function generateNarrative(stats: SeasonStats): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const vsText =
    stats.vsLastSeasonPct !== null
      ? `${Math.abs(stats.vsLastSeasonPct)}% ${stats.vsLastSeasonPct >= 0 ? 'more' : 'less'} than last season`
      : 'no prior season to compare against';

  const prompt =
    `Write a warm, personal 2–3 sentence summary of someone's listening season. ` +
    `They listened to ${stats.totalScrobbles} songs total. ` +
    `Their top artist was ${stats.topArtists[0]?.name ?? 'unknown'}, ` +
    `and their most-played track was "${stats.topTracks[0]?.name ?? 'unknown'}" ` +
    `by ${stats.topTracks[0]?.artist ?? 'unknown'}. ` +
    `They scrobbled ${vsText}. ` +
    `Their most active listening day was ${stats.mostActiveDay}. ` +
    `Keep it specific, warm, and fun — like a note from a friend who noticed what you were listening to.`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 250,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text;
}

export async function sendEmail(stats: SeasonStats, narrative: string): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);

  const vsDisplay =
    stats.vsLastSeasonPct !== null
      ? `${stats.vsLastSeasonPct >= 0 ? '+' : ''}${stats.vsLastSeasonPct}%`
      : 'N/A';

  const artistRows = stats.topArtists
    .map((a, i) => `<tr><td>${i + 1}. ${esc(a.name)}</td><td style="text-align:right;padding-left:16px">${a.count}</td></tr>`)
    .join('');

  const trackRows = stats.topTracks
    .map((t, i) => `<tr><td>${i + 1}. ${esc(t.name)}<br><span style="color:#666;font-size:0.9em">${esc(t.artist)}</span></td><td style="text-align:right;padding-left:16px">${t.count}</td></tr>`)
    .join('');

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111;background:#fff">
  <h2 style="margin-top:0">Your ${esc(stats.seasonYear)} playlist is ready 🎵</h2>
  <p style="line-height:1.6">${esc(narrative)}</p>
  <hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0">
  <h3 style="text-transform:uppercase;letter-spacing:0.08em;font-size:0.8em;color:#444;margin-bottom:12px">
    ${esc(stats.seasonYear)} by the numbers
  </h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
    <tr><td style="padding:4px 0">Total scrobbles</td><td style="text-align:right"><strong>${stats.totalScrobbles.toLocaleString()}</strong></td></tr>
    <tr><td style="padding:4px 0">vs. last season</td><td style="text-align:right"><strong>${vsDisplay}</strong></td></tr>
    <tr><td style="padding:4px 0">Most active day</td><td style="text-align:right"><strong>${esc(stats.mostActiveDay)}</strong></td></tr>
    <tr><td style="padding:4px 0">Tracks in playlist</td><td style="text-align:right"><strong>${stats.playlistTrackCount}</strong></td></tr>
  </table>
  <table style="width:100%;border-collapse:collapse">
    <tr>
      <td style="vertical-align:top;width:50%;padding-right:16px">
        <h4 style="margin:0 0 8px;font-size:0.85em;text-transform:uppercase;letter-spacing:0.05em">Top Artists</h4>
        <table style="width:100%;border-collapse:collapse">${artistRows}</table>
      </td>
      <td style="vertical-align:top;width:50%">
        <h4 style="margin:0 0 8px;font-size:0.85em;text-transform:uppercase;letter-spacing:0.05em">Top Tracks</h4>
        <table style="width:100%;border-collapse:collapse">${trackRows}</table>
      </td>
    </tr>
  </table>
  <hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0">
  <p>
    <a href="${stats.playlistUrl}"
       style="background:#1DB954;color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:bold;display:inline-block">
      Open playlist in Spotify →
    </a>
  </p>
</body>
</html>`;

  await resend.emails.send({
    from: 'Seasonal Playlists <onboarding@resend.dev>',
    to: process.env.RESEND_TO_EMAIL!,
    subject: `Your ${stats.seasonYear} playlist is ready`,
    html,
  });

  console.log(`Email sent to ${process.env.RESEND_TO_EMAIL}`);
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

```

> **Note on `from` address:** `onboarding@resend.dev` is Resend's sandbox sender that works without domain verification. Once you verify `grantculbertson.com` in Resend, change this to `noreply@grantculbertson.com`.

- [ ] **Step 2: Type-check**

```bash
npm run typecheck:scripts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/email.ts
git commit -m "feat: add Claude Haiku narrative generation and Resend email helper"
```

---

## Task 9: Seasonal Playlist Script

**Files:**
- Create: `scripts/seasonal-playlist.ts`

- [ ] **Step 1: Create scripts/seasonal-playlist.ts**

```typescript
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
    await closeDb();
    return;
  }

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
    db.query<{ dow: number; cnt: string }>(
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
  const mostActiveDow = activeDayRes.rows[0]?.dow ?? 0;
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

  await closeDb();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck:scripts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/seasonal-playlist.ts
git commit -m "feat: add seasonal playlist creator script"
```

---

## Task 10: Backfill Script

**Files:**
- Create: `scripts/backfill.ts`

- [ ] **Step 1: Create scripts/backfill.ts**

```typescript
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
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck:scripts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill.ts
git commit -m "feat: add one-time historical backfill script"
```

---

## Task 11: GitHub Actions Workflows

**Files:**
- Create: `.github/workflows/daily-log.yml`
- Create: `.github/workflows/seasonal-playlist.yml`

- [ ] **Step 1: Create .github/workflows directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create .github/workflows/daily-log.yml**

```yaml
name: Daily Scrobble Log

on:
  schedule:
    - cron: '0 9 * * *'
  workflow_dispatch:

jobs:
  log:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Fetch yesterday's scrobbles and insert into Neon
        run: npx tsx scripts/daily-log.ts
        env:
          LASTFM_API_KEY: ${{ secrets.LASTFM_API_KEY }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

- [ ] **Step 3: Create .github/workflows/seasonal-playlist.yml**

```yaml
name: Seasonal Playlist Creator

on:
  schedule:
    - cron: '0 9 1 3,6,9,12 *'
  workflow_dispatch:

jobs:
  create-playlist:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Create seasonal playlist, generate narrative, send email
        run: npx tsx scripts/seasonal-playlist.ts
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          LASTFM_API_KEY: ${{ secrets.LASTFM_API_KEY }}
          SPOTIFY_CLIENT_ID: ${{ secrets.SPOTIFY_CLIENT_ID }}
          SPOTIFY_CLIENT_SECRET: ${{ secrets.SPOTIFY_CLIENT_SECRET }}
          SPOTIFY_REFRESH_TOKEN: ${{ secrets.SPOTIFY_REFRESH_TOKEN }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          RESEND_TO_EMAIL: ${{ secrets.RESEND_TO_EMAIL }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/daily-log.yml .github/workflows/seasonal-playlist.yml
git commit -m "feat: add GitHub Actions workflows for daily log and seasonal playlist"
```

---

## Task 12: Setup Checklist (One-Time)

These steps are done once outside of code — not automated. Complete them after Task 11 is pushed.

### A. Neon Database

- [ ] **Step 1: Create Neon project**

  Go to [neon.tech](https://neon.tech), sign up/in, create a new project named `spotify-seasonal`. Choose the closest region to you.

- [ ] **Step 2: Apply schema**

  In the Neon console → SQL Editor, paste and run the contents of `scripts/schema.sql`.

- [ ] **Step 3: Copy connection string**

  In Neon console → Connection Details → copy the **connection string** (starts with `postgresql://...`). This is your `DATABASE_URL`.

### B. Spotify App

- [ ] **Step 4: Create Spotify developer app**

  Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → Create App. Set the redirect URI to `http://localhost:8888/callback`. Copy the **Client ID** and **Client Secret**.

- [ ] **Step 5: Get the refresh token**

  Run the OAuth helper locally:
  ```bash
  SPOTIFY_CLIENT_ID=<your_id> SPOTIFY_CLIENT_SECRET=<your_secret> npm run get-spotify-token
  ```
  Authorize in the browser. Copy the `SPOTIFY_REFRESH_TOKEN` printed in the terminal.

### C. Last.fm API Key

- [ ] **Step 6: Get Last.fm API key**

  Go to [last.fm/api/account/create](https://www.last.fm/api/account/create). Create an application. Copy the **API key**.

### D. GitHub Secrets

- [ ] **Step 7: Add all secrets to the GitHub repo**

  Go to [github.com/GrantCulbertson/spotify-seasonal](https://github.com/GrantCulbertson/spotify-seasonal) → Settings → Secrets and variables → Actions → New repository secret. Add each:

  | Secret name | Value |
  |---|---|
  | `DATABASE_URL` | Neon connection string |
  | `LASTFM_API_KEY` | Last.fm API key |
  | `SPOTIFY_CLIENT_ID` | Spotify app client ID |
  | `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
  | `SPOTIFY_REFRESH_TOKEN` | Token from Step 5 |
  | `RESEND_API_KEY` | From your Resend dashboard |
  | `RESEND_TO_EMAIL` | Your email address |
  | `ANTHROPIC_API_KEY` | From console.anthropic.com |

### E. Backfill

- [ ] **Step 8: Run the backfill**

  With `DATABASE_URL` and `LASTFM_API_KEY` set in your environment:
  ```bash
  DATABASE_URL=<neon_url> LASTFM_API_KEY=<key> npm run backfill
  ```
  This will take 10–20 minutes for 81k scrobbles. Safe to re-run if interrupted.

### F. Smoke Test

- [ ] **Step 9: Trigger the daily log manually**

  Go to GitHub → Actions → Daily Scrobble Log → Run workflow. Check the logs — you should see scrobble counts and no errors.

- [ ] **Step 10: Trigger the seasonal playlist manually**

  Go to GitHub → Actions → Seasonal Playlist Creator → Run workflow. Verify a playlist appears in your Spotify account and an email arrives.

  > **Note:** The workflow runs on the current date. If you trigger it on a non-seasonal-start date (not Mar/Jun/Sep/Dec 1), `getEndedSeasonYear()` will throw. To test outside a season boundary, temporarily change the function call in `seasonal-playlist.ts` to pass a hardcoded date, run the test, then revert.
