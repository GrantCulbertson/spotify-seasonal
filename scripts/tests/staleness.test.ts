import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { daysSince, shouldAlert, STALE_AFTER_DAYS } from '../staleness.js';

describe('daysSince', () => {
  it('counts whole UTC days between two timestamps', () => {
    assert.equal(
      daysSince(new Date('2026-07-23T15:16:00Z'), new Date('2026-08-06T11:28:00Z')),
      14,
    );
  });

  it('returns 0 when the last scrobble was earlier the same UTC day', () => {
    assert.equal(
      daysSince(new Date('2026-08-06T01:00:00Z'), new Date('2026-08-06T23:00:00Z')),
      0,
    );
  });

  it('returns 1 for yesterday even if only a few hours apart', () => {
    assert.equal(
      daysSince(new Date('2026-08-05T23:00:00Z'), new Date('2026-08-06T01:00:00Z')),
      1,
    );
  });

  it('never returns a negative count for a clock skew into the future', () => {
    assert.equal(
      daysSince(new Date('2026-08-07T00:00:00Z'), new Date('2026-08-06T00:00:00Z')),
      0,
    );
  });
});

describe('shouldAlert', () => {
  it('stays quiet for a normal quiet day', () => {
    assert.equal(shouldAlert(1), false);
  });

  it('stays quiet just below the threshold', () => {
    assert.equal(shouldAlert(STALE_AFTER_DAYS - 1), false);
  });

  it('fires the first time the gap reaches the threshold', () => {
    assert.equal(shouldAlert(STALE_AFTER_DAYS), true);
  });

  it('stays quiet on the days right after the first alert', () => {
    assert.equal(shouldAlert(STALE_AFTER_DAYS + 1), false);
    assert.equal(shouldAlert(STALE_AFTER_DAYS + 6), false);
  });

  it('re-alerts once a week so a long outage keeps nagging', () => {
    assert.equal(shouldAlert(STALE_AFTER_DAYS + 7), true);
    assert.equal(shouldAlert(STALE_AFTER_DAYS + 14), true);
  });

  it('would have fired for the real July 23 outage', () => {
    const days = daysSince(new Date('2026-07-23T15:16:00Z'), new Date('2026-07-26T11:28:00Z'));
    assert.equal(days, 3);
    assert.equal(shouldAlert(days), true);
  });
});
