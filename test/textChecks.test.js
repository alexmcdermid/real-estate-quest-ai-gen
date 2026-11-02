import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeForDuplicateCheck, removeCitationArtifacts } from "../src/textChecks.js";

describe("normalizeForDuplicateCheck", () => {
  test("lowercases, collapses whitespace and trims", () => {
    assert.equal(normalizeForDuplicateCheck("  What IS\n\tthe   Answer?  "), "what is the answer?");
    assert.equal(normalizeForDuplicateCheck(" Dual   AGENCY "), "dual agency");
  });
});

describe("removeCitationArtifacts", () => {
  test("removes each artifact with the &#8203; entity, a literal zero-width space, or nothing in front", () => {
    const explanationFromChapter8 = "an unfair result&#8203;:contentReference[oaicite:0]{index=0}" +
      "&#8203;:contentReference[oaicite:1]{index=1}. Therefore";
    assert.equal(removeCitationArtifacts(explanationFromChapter8), "an unfair result. Therefore");
    assert.equal(removeCitationArtifacts("A choice​:contentReference[oaicite:12]{index=12}"), "A choice");
    assert.equal(removeCitationArtifacts("A question?:contentReference[oaicite:3]{index=3}"), "A question?");
    assert.equal(removeCitationArtifacts("No artifacts: RESA s.3"), "No artifacts: RESA s.3");
  });
});
