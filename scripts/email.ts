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
  playlistImageUrl?: string;
}

export async function generateNarrative(stats: SeasonStats): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const vsText =
    stats.vsLastSeasonPct !== null
      ? `${Math.abs(stats.vsLastSeasonPct)}% ${stats.vsLastSeasonPct >= 0 ? 'more' : 'less'} than last season`
      : 'no prior season to compare against';

  const prompt =
    `Write a warm, personal 2–3 sentence summary of someone's listening season. ` +
    `They listened to ${stats.totalScrobbles} songs total (${vsText}). ` +
    `Their top artist was ${stats.topArtists[0]?.name ?? 'unknown'}, ` +
    `and their most-played track was "${stats.topTracks[0]?.name ?? 'unknown'}" ` +
    `by ${stats.topTracks[0]?.artist ?? 'unknown'}. ` +
    `Their most active listening day was ${stats.mostActiveDay}. ` +
    `Be specific and grounded in these exact details — no generic filler about "sonic journeys" or "discovering new sounds". ` +
    `Do not use markdown headers or formatting of any kind. Plain sentences only.`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 250,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  // Strip any leading markdown header lines (e.g. "# Title\n\n") Claude may emit
  return block.text.replace(/^#+\s+[^\n]*\n+/, '').trim();
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
  <p style="line-height:1.6">${esc(narrative)}</p>${stats.playlistImageUrl ? `
  <a href="${esc(stats.playlistUrl)}" style="display:block;margin:20px 0">
    <img src="${esc(stats.playlistImageUrl)}" alt="${esc(stats.seasonYear)} playlist cover"
         style="width:100%;max-width:300px;border-radius:8px;display:block">
  </a>` : ''}
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
    <a href="${esc(stats.playlistUrl)}"
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
