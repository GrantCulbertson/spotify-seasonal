export interface SpotifyCandidate {
  uri: string;
  name: string;
  artists: string[];
  album: string;
  explicit: boolean;
  popularity: number;
}

export interface MatchTarget {
  trackName: string;
  artistName: string;
  albumName?: string | null;
}

/**
 * Variants Spotify search happily returns that are almost never what was
 * scrobbled — unless the scrobble itself says so.
 */
const JUNK_MARKERS = [
  'karaoke',
  'tribute',
  'made famous by',
  'originally performed',
  'cover version',
  'in the style of',
  '8-bit',
  'lullaby version',
];

function normalize(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip diacritics
    .toLowerCase()
    .replace(/[‘’]/g, "'")  // curly → straight quotes
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Title without trailing "- 2024 Remaster" / "(feat. X)" / "[Live]" decorations. */
function baseTitle(str: string): string {
  return normalize(
    str
      .replace(/\s*[-–—]\s*[^-–—]*$/, '')
      .replace(/\s*[([][^)\]]*[)\]]\s*$/, ''),
  );
}

function hasJunkMarker(str: string): boolean {
  const n = normalize(str);
  return JUNK_MARKERS.some((m) => n.includes(normalize(m)));
}

/** 3 = exact title, 2 = matches once decorations are stripped, 0 = different song. */
function titleScore(candidateName: string, targetName: string): number {
  const c = normalize(candidateName);
  const t = normalize(targetName);
  if (c === t) return 3;

  const cBase = baseTitle(candidateName);
  const tBase = baseTitle(targetName);
  if (cBase && (cBase === t || cBase === tBase)) return 2;
  if (tBase && tBase === c) return 2;
  return 0;
}

/** 2 = same album, 1 = same album modulo "(Deluxe)" etc., 0 = different or unknown. */
function albumScore(candidateAlbum: string, targetAlbum?: string | null): number {
  if (!targetAlbum) return 0;
  const c = normalize(candidateAlbum);
  const t = normalize(targetAlbum);
  if (c === t) return 2;

  const cBase = baseTitle(candidateAlbum);
  const tBase = baseTitle(targetAlbum);
  if (cBase && tBase && cBase === tBase) return 1;
  return 0;
}

function artistMatches(candidate: SpotifyCandidate, targetArtist: string): boolean {
  const t = normalize(targetArtist);
  return candidate.artists.some((a) => normalize(a) === t);
}

/**
 * Pick the Spotify track that best matches a scrobble, or null if nothing is a
 * confident match.
 *
 * Priority, highest first: title fidelity, then the scrobbled album, then the
 * explicit cut, then popularity as a tie-break. Album outranks explicit so a
 * clean track from the record actually listened to beats an explicit one lifted
 * off some unrelated compilation.
 */
export function pickBestMatch(
  target: MatchTarget,
  candidates: SpotifyCandidate[],
): SpotifyCandidate | null {
  const targetIsJunk = hasJunkMarker(target.trackName);

  let best: SpotifyCandidate | null = null;
  let bestScore = -Infinity;

  for (const c of candidates) {
    if (!artistMatches(c, target.artistName)) continue;

    const title = titleScore(c.name, target.trackName);
    if (title === 0) continue;

    if (!targetIsJunk && (hasJunkMarker(c.name) || c.artists.some(hasJunkMarker))) continue;

    const score =
      title * 1000 +
      albumScore(c.album, target.albumName) * 100 +
      (c.explicit ? 10 : 0) +
      (c.popularity ?? 0) / 1000;

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}
