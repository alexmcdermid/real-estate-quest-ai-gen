import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { COURSE_GLOSSARY_TERMS } from "../src/glossaryTerms.js";

describe("course glossary terms", () => {
  test("are trimmed, non-empty terms with no duplicates", () => {
    assert.ok(COURSE_GLOSSARY_TERMS.length >= 200);
    const normalizedTerms = COURSE_GLOSSARY_TERMS.map((term) => term.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
    assert.equal(new Set(normalizedTerms).size, COURSE_GLOSSARY_TERMS.length);
    assert.ok(COURSE_GLOSSARY_TERMS.every((term) => typeof term === "string" && term.trim() === term && term !== ""));
  });

  test("hold terms only, never definitions", () => {
    // The longest glossary headword is a few words; a definition would be a sentence.
    assert.ok(COURSE_GLOSSARY_TERMS.every((term) => term.length <= 60 && !/[.:]$/.test(term)), "no sentence-like entries");
  });
});
