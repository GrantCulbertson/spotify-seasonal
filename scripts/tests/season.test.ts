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
