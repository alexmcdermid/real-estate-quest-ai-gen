# real-estate-quest-ai-gen

Cloud Functions that use Claude, through the [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript), to write new BC real estate licensing exam practice questions and study flashcards. Everything generated waits in a review queue until an admin approves it on the [real-estate-quest](https://github.com/alexmcdermid/real-estate-quest) admin page. Only approved questions and flashcards reach students.

The design is in [docs/ai-question-flow.md](docs/ai-question-flow.md). Setup, data and deploys are in [dev.md](dev.md).

## How it works

1. **Trigger:** `generateAiContent` runs every Monday at 9am Pacific while weekly generation is on: a questions run, then a flashcards run, for this week's chapter. The admin page's **Generate now** button calls `generateAiContentNow` (admins only) for questions or flashcards, a chapter, an item count and an optional dry run.
2. **Context:** reads the chapter's human and published AI questions (or flashcards) from the `(default)` Firestore database, read only, plus everything generated for the chapter before, rejected items included, from the `ai` database. For flashcards it also reads the front of every card in every chapter, and the prompt offers only the course glossary terms that no card covers yet.
3. **Generate:** one Claude Opus 5.5 request for all of the run's items, with JSON schema structured output, and up to 3 attempts for any that are missing or invalid.
4. **Validate:** questions need exactly 4 distinct choices, a valid `correctChoice` and an explanation that starts with `Correct Answer: N`; flashcards need a front, a back, 1 to 5 tags and a difficulty from 1 to 3. Both have length limits, no ChatGPT citation artifacts and no duplicates of existing items: a question is checked against its chapter's questions, a flashcard's front against every chapter's cards.
5. **Queue:** valid items go to `questionsAiPending` or `flashcardsAiPending` in the `ai` database, and the run is recorded in `generationRuns`.
6. **Review and publish (app repo):** approving an item commits it to the private AI repo and imports it into `questionsAi` or `flashcardsAi`. Rejected items stay in the queue so they aren't generated again.

Both functions run as the `ai-gen` service account, which can write only the `ai` database and only read `(default)`.

## Project structure

```
src/
  index.js                 function exports: generateAiContent (weekly) and generateAiContentNow (callable)
  runGeneration.js         shared core: settings, lock, daily cap, context, writes, run record
  contentTypes.js          what differs between questions and flashcards, and the generation steps they share
  collectValidItems.js     the attempt loop: request, validate, retry for the missing items
  claudeBatchRequest.js    the Claude request and response handling both content types share
  generateQuestions.js     the question prompt
  generateFlashcards.js    the flashcard prompt
  questionValidation.js    question rules and the duplicate check
  flashcardValidation.js   flashcard rules and the duplicate check
  textChecks.js            citation artifacts and duplicate normalization
  chapterRotation.js       this week's chapter
  chapters.js              chapter names and course manual topics
  glossaryTerms.js         the course manual glossary's terms (no definitions), for flashcards
  aiSettings.js            metadata/aiContent defaults
  firestore.js             (default) for reads, ai for every write
scripts/
  generateLocally.js       local runner (npm run generate:local)
  previewGeneration.js     preview from local question and flashcard files, no Firebase (npm run preview:local)
  setup-ai-gen-access.sh   one-time database, service account and IAM setup
  check-ai-gen-access.sh   checks the access boundary
test/                      unit tests (npm test)
firebase.json              the ai-gen functions codebase and the ai database rules
firestore.ai.rules         deny-all rules for the ai database
```

## Commands

```bash
npm install
npm test                                        # unit tests, no credentials needed
npm run preview:local                           # preview questions from local files, only needs ANTHROPIC_API_KEY
CONTENT_TYPE=flashcards npm run preview:local   # the same for flashcards
npm run generate:local                          # one run from your machine, see dev.md
firebase deploy --only functions:ai-gen         # this repo's functions only
firebase deploy --only firestore                # the ai database's rules only
```
