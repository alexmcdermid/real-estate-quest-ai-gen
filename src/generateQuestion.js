import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

/**
 * Sends existing chapter questions to Claude as few-shot examples and asks it
 * to generate one new question in the same format and style.
 */
export async function generateQuestion(chapter, existingQuestions, nextQuestionNumber) {
  // Use a random sample of questions as few-shot context to vary the output week to week
  const shuffled = [...existingQuestions].sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, 10);

  const systemPrompt = `You are an expert question writer for the BC Real Estate Council (RECBC) licensing examination in British Columbia, Canada.

Your questions must conform to the following rules of the BC real estate licensing exam:
- Questions test knowledge of BC-specific real estate law, the Real Estate Services Act (RESA), the Real Estate Development Marketing Act (REDMA), the Land Title Act, agency relationships, ethics, and trading services as defined by the UBC Sauder Real Estate Division course materials
- All monetary amounts, time limits, deadlines, and statutory figures must be accurate under current BC legislation
- Plausible distractors: all four choices must be reasonable — never obviously wrong
- Only one choice is unambiguously correct
- Avoid trick questions or ambiguous wording
- Questions may present a scenario ("A licensee does X. Which of the following is TRUE?"), a direct knowledge test ("Which of the following correctly describes...?"), or multi-statement format (numbered statements 1–4 in the question body, with choices like "1 and 3 only", "2 and 4 only", "All of the above", etc.)
- Difficulty should match a licensing-level exam, not a trivia quiz

EXPLANATION FORMAT RULES — follow exactly:
- Always begin with "Correct Answer: N" where N is the 1-based position of the correct choice (e.g. correctChoice 0 → "Correct Answer: 1", correctChoice 2 → "Correct Answer: 3")
- Follow with two newlines, then a paragraph explaining why the correct answer is right
- For multi-statement questions, address each numbered statement individually (e.g. "Statement (2) is incorrect because...")
- Cite the relevant BC legislation, regulation, or principle (e.g. RESA s.3, Land Title Act, RECBC Rules)
- Explain why common distractors are wrong where helpful`;

  const userPrompt = `Below are ${sample.length} existing questions from Chapter ${chapter} of the BC real estate licensing prep course. Study their topic coverage, style, difficulty, and exact formatting carefully — then generate exactly ONE new, original question.

EXISTING QUESTIONS (for reference only — do NOT reproduce any of these):
${JSON.stringify(sample, null, 2)}

Requirements for your new question:
- Must cover a DIFFERENT specific topic or scenario than the examples above
- Must be novel — not a rephrasing or recombination of any existing question
- Must have exactly 4 answer choices
- "correctChoice" is the 0-based index of the correct answer in the choices array
- "premium" should be true
- Explanation must start with "Correct Answer: N" (N = correctChoice + 1) followed by two newlines, then the explanation body

Respond with ONLY a valid JSON object — no markdown fences, no extra commentary — matching this exact schema:
{
  "chapter": ${chapter},
  "questionNumber": ${nextQuestionNumber},
  "question": "...",
  "choices": ["...", "...", "...", "..."],
  "correctChoice": 0,
  "premium": true,
  "explanation": "Correct Answer: 1\\n\\n..."
}`;

  const message = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw = message.content[0].text.trim();

  // Strip markdown code fences if Claude adds them despite the instruction
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

  const question = JSON.parse(cleaned);
  validateQuestion(question, chapter, nextQuestionNumber);
  return question;
}

function validateQuestion(q, chapter, questionNumber) {
  if (q.chapter !== chapter) throw new Error(`chapter mismatch: got ${q.chapter}`);
  if (!Array.isArray(q.choices) || q.choices.length !== 4) throw new Error("choices must be an array of 4");
  if (typeof q.correctChoice !== "number" || q.correctChoice < 0 || q.correctChoice > 3) throw new Error("correctChoice must be 0-3");
  if (typeof q.question !== "string" || !q.question.trim()) throw new Error("question text is empty");
  if (typeof q.explanation !== "string" || !q.explanation.trim()) throw new Error("explanation is empty");

  const expectedPrefix = `Correct Answer: ${q.correctChoice + 1}`;
  if (!q.explanation.startsWith(expectedPrefix)) {
    throw new Error(`explanation must start with "${expectedPrefix}", got: "${q.explanation.slice(0, 30)}"`);
  }

  q.questionNumber = questionNumber;
  q.premium = true;
}
