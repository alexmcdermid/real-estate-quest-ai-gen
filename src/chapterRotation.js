import { TOTAL_CHAPTERS } from "./chapters.js";

/**
 * Picks the chapter for a date by rotating through the chapters week by week, based on the week of the year.
 * The rotation repeats every TOTAL_CHAPTERS weeks.
 */
export function pickChapterForDate(date) {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil(((date - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  return ((week - 1) % TOTAL_CHAPTERS) + 1;
}
