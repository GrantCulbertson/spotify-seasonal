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
