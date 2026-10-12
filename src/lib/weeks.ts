// Week arithmetic for the Monday brief. Weeks run Monday 00:00 to Sunday 24:00 in India Standard Time (UTC+5:30, no DST).
const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** Monday (YYYY-MM-DD) of the IST week containing `now`. */
export function istWeekStart(now = new Date()): string {
  const ist = new Date(now.getTime() + IST_MS);
  ist.setUTCDate(ist.getUTCDate() - ((ist.getUTCDay() + 6) % 7));
  return ist.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday of the most recent COMPLETED week: on Monday 07:00 IST this is last week's Monday, never today's. */
export function reportWeekStart(now = new Date()): string {
  return addDays(istWeekStart(now), -7);
}

/** Instants bounding an IST week: from Monday 00:00 IST (inclusive) to the next Monday 00:00 IST (exclusive). */
export function weekRange(weekStart: string): { from: Date; to: Date } {
  const from = new Date(Date.parse(`${weekStart}T00:00:00Z`) - IST_MS);
  return { from, to: new Date(from.getTime() + 7 * DAY_MS) };
}

export function weekLabel(weekStart: string): string {
  return `${weekStart} to ${addDays(weekStart, 6)}`;
}

/** Hour and minute (IST) of an instant, for delivery-time checks. */
export function istClock(now = new Date()): { weekday: number; hour: number; minute: number } {
  const ist = new Date(now.getTime() + IST_MS);
  return { weekday: ist.getUTCDay(), hour: ist.getUTCHours(), minute: ist.getUTCMinutes() };
}

/** A brief generated before its week was over (an early or test run) is incomplete and must be rebuilt, even if it was sent. */
export function generatedBeforeWeekEnded(generatedAt: Date | null | undefined, weekStart: string): boolean {
  return !!generatedAt && generatedAt.getTime() < weekRange(weekStart).to.getTime();
}
