import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TOTAL_CHAPTERS, chapters, getChapterName, getManualChapters } from "../src/chapters.js";

describe("chapters", () => {
  test("has the app's 20 chapters in order", () => {
    assert.equal(TOTAL_CHAPTERS, 20);
    assert.deepEqual(chapters.map((chapter) => chapter.id), Array.from({ length: 20 }, (_, index) => index + 1));
    assert.equal(getChapterName(8), "Contracts for Real Estate Transactions and Law of Agency");
  });

  test("maps every app chapter to course manual chapters in manual order, each with topics", () => {
    const manualChapterNumbers = chapters.flatMap((chapter) => getManualChapters(chapter.id).map((manual) => manual.number));
    assert.deepEqual(manualChapterNumbers, [...manualChapterNumbers].sort((first, second) => first - second));
    assert.equal(new Set(manualChapterNumbers).size, manualChapterNumbers.length, "no manual chapter is mapped twice");
    const isTrimmedNonEmptyText = (text) => typeof text === "string" && text.trim() === text && text !== "";
    for (const chapter of chapters) {
      for (const manualChapter of chapter.manualChapters) {
        assert.ok(Number.isInteger(manualChapter.number) && manualChapter.number >= 1 && manualChapter.number <= 26);
        assert.ok(manualChapter.title.trim() !== "");
        assert.ok(manualChapter.topics.length > 0, `manual chapter ${manualChapter.number} has topics`);
        assert.ok(manualChapter.topics.every(isTrimmedNonEmptyText));
      }
    }
  });

  test("still has no topics for app chapters 9 and 10 (manual chapters 13 and 14)", () => {
    assert.deepEqual(getManualChapters(9), []);
    assert.deepEqual(getManualChapters(10), []);
    assert.deepEqual(getManualChapters(8).map((manual) => manual.number), [11, 12]);
  });

  test("throws for an unknown chapter", () => {
    assert.throws(() => getManualChapters(21), /Unknown chapter 21/);
    assert.throws(() => getChapterName(0), /Unknown chapter 0/);
  });
});
