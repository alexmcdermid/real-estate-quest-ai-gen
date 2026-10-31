import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pickChapterForDate } from "../src/chapterRotation.js";

/**
 * Local noon on the given day, so the expected chapters don't depend on the machine's time zone.
 */
function localNoon(year, monthIndex, day) {
  return new Date(year, monthIndex, day, 12);
}

describe("pickChapterForDate", () => {
  test("maps fixed dates to the expected chapters", () => {
    assert.equal(pickChapterForDate(localNoon(2026, 0, 1)), 1); // Thursday, week 1
    assert.equal(pickChapterForDate(localNoon(2026, 0, 5)), 2); // Monday, week 2
    assert.equal(pickChapterForDate(localNoon(2026, 4, 18)), 1); // Monday, week 21: the rotation starts over
    assert.equal(pickChapterForDate(localNoon(2026, 9, 26)), 4); // Monday, week 44
    assert.equal(pickChapterForDate(localNoon(2026, 11, 31)), 13); // Thursday, week 53
    assert.equal(pickChapterForDate(localNoon(2027, 0, 1)), 1); // a new year starts at chapter 1
  });

  test("gives the same chapter all week, from Monday to Friday", () => {
    const mondayChapter = pickChapterForDate(localNoon(2026, 9, 26));
    for (let day = 27; day <= 30; day++) {
      assert.equal(pickChapterForDate(localNoon(2026, 9, day)), mondayChapter);
    }
  });

  test("always returns an integer chapter from 1 to 20", () => {
    for (const year of [2025, 2026, 2027, 2028]) {
      for (let date = localNoon(year, 0, 1); date.getFullYear() === year; date = new Date(date.getTime() + 86400000)) {
        const chapter = pickChapterForDate(date);
        assert.ok(Number.isInteger(chapter) && chapter >= 1 && chapter <= 20, `${date.toDateString()} gave ${chapter}`);
      }
    }
  });
});
