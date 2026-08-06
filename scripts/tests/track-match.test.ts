import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickBestMatch, type SpotifyCandidate } from '../track-match.js';

function candidate(over: Partial<SpotifyCandidate> & { uri: string }): SpotifyCandidate {
  return {
    name: 'Bad Habit',
    artists: ['Steve Lacy'],
    album: 'Gemini Rights',
    explicit: false,
    popularity: 50,
    ...over,
  };
}

describe('pickBestMatch — explicit preference', () => {
  it('prefers the explicit version when all else is equal', () => {
    const clean = candidate({ uri: 'spotify:track:clean', explicit: false });
    const dirty = candidate({ uri: 'spotify:track:dirty', explicit: true });

    const best = pickBestMatch(
      { trackName: 'Bad Habit', artistName: 'Steve Lacy', albumName: 'Gemini Rights' },
      [clean, dirty],
    );

    assert.equal(best?.uri, 'spotify:track:dirty');
  });

  it('prefers explicit even when the clean version is more popular', () => {
    const clean = candidate({ uri: 'spotify:track:clean', explicit: false, popularity: 95 });
    const dirty = candidate({ uri: 'spotify:track:dirty', explicit: true, popularity: 40 });

    const best = pickBestMatch(
      { trackName: 'Bad Habit', artistName: 'Steve Lacy', albumName: 'Gemini Rights' },
      [clean, dirty],
    );

    assert.equal(best?.uri, 'spotify:track:dirty');
  });

  it('falls back to explicit preference when the target has no album', () => {
    const clean = candidate({ uri: 'spotify:track:clean', explicit: false, album: 'Some Comp' });
    const dirty = candidate({ uri: 'spotify:track:dirty', explicit: true, album: 'Other Comp' });

    const best = pickBestMatch(
      { trackName: 'Bad Habit', artistName: 'Steve Lacy', albumName: null },
      [clean, dirty],
    );

    assert.equal(best?.uri, 'spotify:track:dirty');
  });
});

describe('pickBestMatch — album takes priority over explicit', () => {
  it('picks the clean track on the scrobbled album over an explicit track elsewhere', () => {
    const rightAlbum = candidate({
      uri: 'spotify:track:right-album',
      album: 'Gemini Rights',
      explicit: false,
    });
    const wrongAlbum = candidate({
      uri: 'spotify:track:wrong-album',
      album: 'Now That’s What I Call Music 200',
      explicit: true,
    });

    const best = pickBestMatch(
      { trackName: 'Bad Habit', artistName: 'Steve Lacy', albumName: 'Gemini Rights' },
      [wrongAlbum, rightAlbum],
    );

    assert.equal(best?.uri, 'spotify:track:right-album');
  });

  it('prefers the explicit cut among candidates on the matching album', () => {
    const cleanRight = candidate({ uri: 'spotify:track:clean', album: 'Gemini Rights', explicit: false });
    const dirtyRight = candidate({ uri: 'spotify:track:dirty', album: 'Gemini Rights', explicit: true });
    const dirtyWrong = candidate({ uri: 'spotify:track:elsewhere', album: 'Gemini Rights (Deluxe)', explicit: true });

    const best = pickBestMatch(
      { trackName: 'Bad Habit', artistName: 'Steve Lacy', albumName: 'Gemini Rights' },
      [cleanRight, dirtyWrong, dirtyRight],
    );

    assert.equal(best?.uri, 'spotify:track:dirty');
  });
});

describe('pickBestMatch — title matching', () => {
  it('prefers the plain title over a remastered variant', () => {
    const remaster = candidate({ uri: 'spotify:track:remaster', name: 'Bad Habit - 2024 Remaster' });
    const plain = candidate({ uri: 'spotify:track:plain', name: 'Bad Habit' });

    const best = pickBestMatch(
      { trackName: 'Bad Habit', artistName: 'Steve Lacy', albumName: 'Gemini Rights' },
      [remaster, plain],
    );

    assert.equal(best?.uri, 'spotify:track:plain');
  });

  it('still matches when casing, punctuation and accents differ', () => {
    const c = candidate({ uri: 'spotify:track:x', name: 'BAD  HABIT!', artists: ['Stevé Lacy'] });

    const best = pickBestMatch(
      { trackName: 'bad habit', artistName: 'Steve Lacy', albumName: 'Gemini Rights' },
      [c],
    );

    assert.equal(best?.uri, 'spotify:track:x');
  });

  it('accepts a feat. suffix Spotify adds to the title', () => {
    const c = candidate({ uri: 'spotify:track:feat', name: 'Bad Habit (feat. Fousheé)' });

    const best = pickBestMatch(
      { trackName: 'Bad Habit', artistName: 'Steve Lacy', albumName: 'Gemini Rights' },
      [c],
    );

    assert.equal(best?.uri, 'spotify:track:feat');
  });
});

describe('pickBestMatch — rejecting bad matches', () => {
  it('returns null when no candidates come back', () => {
    assert.equal(
      pickBestMatch({ trackName: 'Bad Habit', artistName: 'Steve Lacy', albumName: null }, []),
      null,
    );
  });

  it('returns null when the artist does not match', () => {
    const c = candidate({ uri: 'spotify:track:wrong', artists: ['Some Other Band'] });

    assert.equal(
      pickBestMatch({ trackName: 'Bad Habit', artistName: 'Steve Lacy', albumName: null }, [c]),
      null,
    );
  });

  it('returns null when the title is a different song by the same artist', () => {
    const c = candidate({ uri: 'spotify:track:other', name: 'Mercury' });

    assert.equal(
      pickBestMatch({ trackName: 'Bad Habit', artistName: 'Steve Lacy', albumName: null }, [c]),
      null,
    );
  });

  it('rejects karaoke versions', () => {
    const c = candidate({
      uri: 'spotify:track:karaoke',
      name: 'Bad Habit (Karaoke Version)',
      artists: ['Steve Lacy'],
    });

    assert.equal(
      pickBestMatch({ trackName: 'Bad Habit', artistName: 'Steve Lacy', albumName: null }, [c]),
      null,
    );
  });

  it('rejects tribute-band covers', () => {
    const c = candidate({
      uri: 'spotify:track:tribute',
      name: 'Bad Habit (Made Famous by Steve Lacy)',
      artists: ['The Tribute Players'],
    });

    assert.equal(
      pickBestMatch({ trackName: 'Bad Habit', artistName: 'Steve Lacy', albumName: null }, [c]),
      null,
    );
  });

  it('keeps a karaoke track if that is genuinely what was scrobbled', () => {
    const c = candidate({ uri: 'spotify:track:karaoke', name: 'Bad Habit (Karaoke Version)' });

    const best = pickBestMatch(
      { trackName: 'Bad Habit (Karaoke Version)', artistName: 'Steve Lacy', albumName: null },
      [c],
    );

    assert.equal(best?.uri, 'spotify:track:karaoke');
  });
});

describe('pickBestMatch — tie-breaking', () => {
  it('uses popularity to break an otherwise exact tie', () => {
    const low = candidate({ uri: 'spotify:track:low', popularity: 12 });
    const high = candidate({ uri: 'spotify:track:high', popularity: 88 });

    const best = pickBestMatch(
      { trackName: 'Bad Habit', artistName: 'Steve Lacy', albumName: 'Gemini Rights' },
      [low, high],
    );

    assert.equal(best?.uri, 'spotify:track:high');
  });

  it('matches the artist when Spotify lists them as a secondary credit', () => {
    const c = candidate({ uri: 'spotify:track:collab', artists: ['Fousheé', 'Steve Lacy'] });

    const best = pickBestMatch(
      { trackName: 'Bad Habit', artistName: 'Steve Lacy', albumName: null },
      [c],
    );

    assert.equal(best?.uri, 'spotify:track:collab');
  });
});
