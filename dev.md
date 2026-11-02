# Developer guide

See [docs/ai-question-flow.md](docs/ai-question-flow.md) for the whole flow. The review, approval, import and serving half lives in the [real-estate-quest](https://github.com/alexmcdermid/real-estate-quest) repo.

## Architecture

There is one Firebase project, `real-estate-quest`. This repo deploys the `ai-gen` functions codebase into it, and the app repo deploys the `default` codebase. Deploying one never touches the other's functions.

| | |
|---|---|
| Functions | `generateAiContent`: scheduled, Mondays 9:00 America/Los_Angeles, no retries. A questions run, then a flashcards run.<br>`generateAiContentNow`: callable, App Check plus the `isAdmin` claim, one run of questions or flashcards<br>Both in `us-west1`, 1800 s timeout, 512 MiB |
| Runs as | `ai-gen@real-estate-quest.iam.gserviceaccount.com` |
| Secret | `ANTHROPIC_API_KEY` in Secret Manager |
| Reads | `(default)` database: `metadata/aiContent`, `questions`, `questionsAi`, `flashcards`, `flashcardsAi` |
| Writes | `ai` database: `questionsAiPending`, `flashcardsAiPending`, `generationRuns`, `locks/generation` |

### Access

The Admin SDK skips security rules, so IAM keeps the generator out of everything else. The smallest thing IAM can scope to is a database, which is why the generator writes to its own.

| Service account | `(default)` | `ai` |
|---|---|---|
| `ai-gen` | read only (`roles/datastore.viewer`) | read and write (`roles/datastore.user`) |

Each grant has an IAM condition naming its database (a grant without one covers every database in the project). `ai-gen` can also read the `ANTHROPIC_API_KEY` secret, and no other secret. `firestore.ai.rules` denies all browser access to the `ai` database.

### Settings

`metadata/aiContent` in `(default)`, edited on the admin page's AI Content tab. A missing document or field means the default.

| Field | Default | Effect |
|---|---|---|
| `generationEnabled` | `false` | The weekly runs do nothing while it's off. Generate now ignores it. |
| `questionsPerRun` | `1` | Questions per run, 1 to 10. Generate now can ask for a different count. |
| `flashcardsPerRun` | `1` | Flashcards per run, 1 to 10. Generate now can ask for a different count. |
| `servingEnabled` | `false` | Not used here. The app serves AI questions and flashcards only while it's on. |

### A run

Each run is for one content type, questions or flashcards.

1. Read the settings. A weekly run stops here while generation is off.
2. Take `locks/generation` (30 minute TTL, which outlives the function timeout). If another run holds it, the weekly run is skipped and Generate now returns `aborted`.
3. Generate now only: after 10 manual runs in 24 hours (questions and flashcards together, dry runs included), it returns `resource-exhausted`.
4. Pick the chapter (this week's from the rotation, unless one was given) and create the `generationRuns` document.
5. Read the context: the chapter's human items, its published AI items, and every item generated for it before (pending, approved or rejected). For flashcards, also the front of every card in every chapter (human, published AI and generated, whatever its status; only the `front` field is downloaded): a term gets one card in the whole course, so a new card's front is checked against every chapter, not only its own. The prompt lists only the chapter's cards. It also lists the chapter's topics: the section headings of the 2024 UBC licensing course manual chapters it covers (`src/chapters.js`; app chapters 9 and 10 have none yet), and each item must come from one of them. The flashcard prompt also lists the terms of the manual's glossary (`src/glossaryTerms.js`, terms only, never the manual's definitions) that no card in any chapter covers yet, and leaves the glossary out once every term has a card. Claude makes cards for the listed terms that belong to the chapter's topics, writing its own definitions.
6. Ask Claude for the missing items, up to 3 attempts, and validate each one.
7. In one batch, add the valid items to `questionsAiPending` or `flashcardsAiPending` (skipped on a dry run) and finish the run document.

A run ends `succeeded` (every requested item), `partial` (some) or `failed` (none, or an unexpected error), with up to 20 errors. The admin page lists recent runs. The weekly function's two runs are independent: a failed questions run doesn't stop the flashcards run.

### Documents in the `ai` database

```
questionsAiPending/{autoId}         the id becomes the question's aiQuestionId on approval
  chapter, question, choices (4), correctChoice (0-based), explanation ("Correct Answer: N\n\n...")
  status: "pending" (the app sets "approved" or "rejected"), aiGenerated: true, generatedAt
  generationRunId, trigger ("scheduled" | "manual" | "local"), requestedBy (uid or null), model

flashcardsAiPending/{autoId}        the id becomes the flashcard's aiFlashcardId on approval
  chapter, front, back, tags (1-5, lowercase), difficulty (1-3)
  status, aiGenerated: true, generatedAt, generationRunId, trigger, requestedBy, model (as above)

generationRuns/{autoId}
  trigger, contentType ("questions" | "flashcards"), chapter, requestedItemCount, generatedItemCount, status, errors
  dryRun, requestedBy, startedAt, finishedAt, model, inputTokens, outputTokens

locks/generation
  lockToken, owner, acquiredAt, expiresAt
```

The generator doesn't set numbers, `premium` or ids. The reviewer picks free or premium, and approval numbers the question or flashcard from its AI repo file (and gives a flashcard its `documentID`).

### The Claude request

Questions and flashcards send the same request; only the schema, the system prompt and the two texts differ. `claude-opus-5-5`, streamed, `max_tokens` 64000, effort `high`, JSON schema structured output, and the server-side fallback (`fallbacks: "default"`), so a declined request is retried on the model Anthropic recommends. The chapter context is a cached content block, so retries within a run read it from the prompt cache. ChatGPT citation artifacts left in some human questions (`&#8203;:contentReference[oaicite:N]{index=N}`) are stripped from it, and a generated question or flashcard that contains one is rejected. The response is used only after checking `stop_reason` (`refusal`, `max_tokens`), and is read from its text blocks, never from `content[0]` (the response starts with thinking blocks). After a mid-response decline, the JSON is either the text after the last `fallback` block (the fallback model started over) or, as on a stream, every text block joined in order (the fallback model continued the declined model's partial output). The text after the block is tried first.

## Setup (once)

You need Node 22, the Firebase CLI (`firebase login`) and the gcloud CLI (`gcloud auth login`), as a project owner.

1. Store the Anthropic API key: `firebase functions:secrets:set ANTHROPIC_API_KEY`
2. Run `scripts/setup-ai-gen-access.sh`. It creates the `ai` database in the same location as `(default)`, creates the `ai-gen` service account and grants its roles, and is safe to re-run. Set `DEPLOYER_MEMBER=user:you@example.com` to let someone who isn't a project owner deploy functions that run as `ai-gen`.
3. Deploy the `ai` database's rules: `firebase deploy --only firestore`
4. Deploy the functions: `firebase deploy --only functions:ai-gen`. The predeploy step runs the tests and refuses to deploy while a `.env` file exists.
5. Check the boundary: give yourself `roles/iam.serviceAccountTokenCreator` on `ai-gen` (the command is in the script's header), then run `scripts/check-ai-gen-access.sh`. A write to `(default)` must fail with 403.
6. Try a dry run of each content type with Generate now on the admin page, then turn on weekly generation there. To test the schedule itself, force a run of the `generateAiContent` job in Cloud Scheduler and check that two `generationRuns` documents appear, one per content type.

## Local runs

To see what the generator writes without any Firebase setup, preview from a local checkout of `real-estate-quest-questions` (a sibling folder by default). It only needs `ANTHROPIC_API_KEY`, in `local-generation.env` or exported, and writes nothing to Firestore or GitHub:

```bash
CHAPTER_OVERRIDE=3 ITEM_COUNT=2 npm run preview:local
CONTENT_TYPE=flashcards CHAPTER_OVERRIDE=3 ITEM_COUNT=2 npm run preview:local
```

It prints the items as the AI repo stores them: questions as in `questions/<chapter>.json` (the human question files' fields in the same order, plus `aiGenerated: true` and `aiQuestionId`), flashcards as in `flashcards/<chapter>.json` (the human `flashcards.js` fields in the same order, plus `aiGenerated: true` and `aiFlashcardId`). Numbers, `premium`, the ids and a flashcard's `documentID` are set at approval, so the preview shows the values a first approval would give. Flashcard previews read `flashcards.js`, one file for every chapter: the chapter's cards are the style reference, and every chapter's cards are what a new front is checked against and what the glossary list leaves out. `QUESTIONS_REPO_PATH` points at another checkout and `PREVIEW_OUTPUT_FILE` also writes the JSON to a file.

A full run reads the context from Firestore and writes to the review queue:

```bash
npm install
cp local-generation.env.example local-generation.env   # add ANTHROPIC_API_KEY
gcloud auth application-default login
npm run generate:local
```

`local-generation.env` also takes `CONTENT_TYPE` (`questions`, the default, or `flashcards`), `CHAPTER_OVERRIDE` (1-20), `ITEM_COUNT` (1-10) and `DRY_RUN=true`, which prints the items without adding them to the review queue. A local run uses your own credentials, not `ai-gen`'s, and is recorded in `generationRuns` with trigger `local`. Never name the file `.env`: the Firebase CLI deploys a `.env` file in the functions folder as plain environment variables.

## Tests

```bash
npm test
```

`node:test` unit tests for question and flashcard validation, the chapter rotation and course manual data, the Claude request and response handling for both content types (with a fake client), and the attempt loop. They need no network or credentials. Shared test helpers live in `test/support/`; the test script only runs `test/*.test.js`.
