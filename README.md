# real-estate-quest-ai-gen

Cloud Functions that use Claude, through the [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript), to write new BC real estate licensing exam practice questions. Every generated question waits in a review queue until an admin approves it on the [real-estate-quest](https://github.com/alexmcdermid/real-estate-quest) admin page. Only approved questions reach students.

The design is in [docs/ai-question-flow.md](docs/ai-question-flow.md). Setup, data and deploys are in [dev.md](dev.md).

## How it works

1. **Trigger:** `generateAiQuestions` runs every Monday at 9am Pacific while weekly generation is on. The admin page's **Generate now** button calls `generateAiQuestionsNow` (admins only) for a chapter, a question count and an optional dry run.
2. **Context:** reads the chapter's human questions and published AI questions from the `(default)` Firestore database, read only, plus every question generated for the chapter before, rejected ones included, from the `ai` database.
3. **Generate:** one Claude Opus 5.5 request for all of the run's questions, with JSON schema structured output, and up to 3 attempts for any that are missing or invalid.
4. **Validate:** exactly 4 distinct choices, a valid `correctChoice`, an explanation that starts with `Correct Answer: N`, length limits, no ChatGPT citation artifacts, and no duplicates of existing questions.
5. **Queue:** valid questions go to `questionsAiPending` in the `ai` database, and the run is recorded in `generationRuns`.
6. **Review and publish (app repo):** approving a question commits it to the private AI questions repo and imports it into `questionsAi`. Rejected questions stay in the queue so their topics aren't generated again.

Both functions run as the `ai-gen` service account, which can write only the `ai` database and only read `(default)`.

## Project structure

```
src/
  index.js                 function exports: generateAiQuestions (weekly) and generateAiQuestionsNow (callable)
  runGeneration.js         shared core: settings, lock, daily cap, context, writes, run record
  collectValidQuestions.js the attempt loop: request, validate, retry for the missing questions
  generateQuestions.js     the Claude request and response handling
  questionValidation.js    question rules and the duplicate check
  chapterRotation.js       this week's chapter
  chapters.js              chapter names
  aiSettings.js            metadata/aiQuestions defaults
  firestore.js             (default) for reads, ai for every write
scripts/
  generateLocally.js       local runner (npm run generate:local)
  previewGeneration.js     preview from local question files, no Firebase (npm run preview:local)
  setup-ai-gen-access.sh   one-time database, service account and IAM setup
  check-ai-gen-access.sh   checks the access boundary
test/                      unit tests (npm test)
firebase.json              the ai-gen functions codebase and the ai database rules
firestore.ai.rules         deny-all rules for the ai database
```

## Commands

```bash
npm install
npm test                                  # unit tests, no credentials needed
npm run preview:local                     # preview questions from local files, only needs ANTHROPIC_API_KEY
npm run generate:local                    # one run from your machine, see dev.md
firebase deploy --only functions:ai-gen   # this repo's functions only
firebase deploy --only firestore          # the ai database's rules only
```
