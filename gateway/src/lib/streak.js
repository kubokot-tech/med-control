/**
 * Consecutive TAKEN days ending today (or yesterday if today is still open: no mark yet, or only some of the day's
 * doses); PAUSED days and days without a scheduled dose (OFF) are skipped over. A past day with only some doses
 * (PARTIAL) ends the streak.
 */
export function streakLength(days) {
  let n = 0;
  let i = days.length - 1;
  if (days[i]?.status === 'TAKEN') n = 1;
  else if (days[i]?.status !== null && days[i]?.status !== 'PAUSED' && days[i]?.status !== 'OFF' && days[i]?.status !== 'PARTIAL') return 0;
  for (i = i - 1; i >= 0; i--) {
    if (days[i].status === 'TAKEN') n++;
    else if (days[i].status === 'PAUSED' || days[i].status === 'OFF') continue;
    else break;
  }
  return n;
}
