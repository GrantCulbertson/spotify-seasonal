# Spotify Seasonal Playlists

Automatically creates a Spotify playlist each season from your Last.fm scrobble history, then emails you a recap with stats and a Claude-generated narrative.

## How It Works

1. **Daily logging** — a GitHub Action runs every morning and pulls the previous day's scrobbles from Last.fm into a Neon Postgres database
2. **Seasonal playlist** — on March 1, June 1, September 1, and December 1, another Action queries for tracks with ≥10 plays that season, creates a Spotify playlist, generates a narrative with Claude Haiku, and emails you a recap via Resend

## Management Dashboards

| Service | URL | What you manage there |
|---|---|---|
| **GitHub** | [github.com/GrantCulbertson/spotify-seasonal](https://github.com/GrantCulbertson/spotify-seasonal) | Source code, GitHub Secrets, Actions workflows |
| **Neon** (database) | [console.neon.tech](https://console.neon.tech) | Postgres database, connection string, usage |
| **Spotify Developer** | [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) | App credentials (Client ID, Client Secret, Redirect URIs) |
| **Last.fm API** | [last.fm/api/accounts](https://www.last.fm/api/accounts) | API key |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) | API key, usage, billing |
| **Resend** | [resend.com](https://resend.com) | API key, email logs, domain verification |

## GitHub Secrets

All secrets are stored at [github.com/GrantCulbertson/spotify-seasonal/settings/secrets/actions](https://github.com/GrantCulbertson/spotify-seasonal/settings/secrets/actions).

| Secret | Where to get it |
|---|---|
| `DATABASE_URL` | Neon dashboard → Connect |
| `LASTFM_API_KEY` | last.fm/api/accounts |
| `SPOTIFY_CLIENT_ID` | Spotify Developer dashboard |
| `SPOTIFY_CLIENT_SECRET` | Spotify Developer dashboard |
| `SPOTIFY_REFRESH_TOKEN` | Run `npm run get-spotify-token` locally (one-time setup) |
| `RESEND_API_KEY` | Resend dashboard → API Keys |
| `RESEND_TO_EMAIL` | The email address to send recaps to (must match your Resend account email in sandbox mode) |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |

## Scheduled Workflows

| Workflow | Schedule | What it does |
|---|---|---|
| `daily-log.yml` | 9am UTC every day | Pulls yesterday's Last.fm scrobbles into Neon |
| `seasonal-playlist.yml` | 9am UTC on Mar 1, Jun 1, Sep 1, Dec 1 | Creates Spotify playlist, generates narrative, sends email |

## Manual Testing

To trigger a playlist for any season from the GitHub UI:

1. Go to [Actions → Seasonal Playlist Creator](https://github.com/GrantCulbertson/spotify-seasonal/actions/workflows/seasonal-playlist.yml)
2. Click **Run workflow**
3. Enter a season in the **Season override** field (e.g. `Spring'26`)
4. Click **Run workflow**

## Local Development

```bash
npm install

# Run tests
npm test

# Type check
npm run typecheck:scripts

# Backfill historical scrobbles (safe to re-run)
DATABASE_URL=<url> LASTFM_API_KEY=<key> npm run backfill

# Get a new Spotify refresh token (one-time setup)
SPOTIFY_CLIENT_ID=<id> SPOTIFY_CLIENT_SECRET=<secret> npm run get-spotify-token
```

## Seasons

| Season | Months | Label format |
|---|---|---|
| Winter | Dec – Feb | `Winter'24-25` |
| Spring | Mar – May | `Spring'25` |
| Summer | Jun – Aug | `Summer'25` |
| Fall | Sep – Nov | `Fall'25` |
