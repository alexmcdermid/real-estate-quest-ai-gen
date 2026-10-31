# Developer guide

See [docs/ai-question-flow.md](docs/ai-question-flow.md) for the whole flow. The review, approval, import and serving half lives in the [real-estate-quest](https://github.com/alexmcdermid/real-estate-quest) repo.

## Architecture

There is one Firebase project, `real-estate-quest`. This repo deploys the `ai-gen` functions codebase into it, and the app repo deploys the `default` codebase. Deploying one never touches the other's functions.

| | |
|---|---|
| Functions | `generateAiQuestions`: scheduled, Mondays 9:00 America/Los_Angeles, no retries<br>`generateAiQuestionsNow`: callable, App Check plus the `isAdmin` claim<br>Both in `us-west1`, 1800 s timeout, 512 MiB |
| Runs as | `ai-gen@real-estate-quest.iam.gserviceaccount.com` |
| Secret | `ANTHROPIC_API_KEY` in Secret Manager |
| Reads | `(default)` database: `metadata/aiQuestions`, `questions`, `questionsAi` |
| Writes | `ai` database: `questionsAiPending`, `generationRuns`, `locks/generation` |

### Access

The Admin SDK skips security rules, so IAM keeps the generator out of everything else. The smallest thing IAM can scope to is a database, which is why the generator writes to its own.

| Service account | `(default)` | `ai` |
|---|---|---|
| `ai-gen` | read only (`roles/datastore.viewer`) | read and write (`roles/datastore.user`) |

Each grant has an IAM condition naming its database (a grant without one covers every database in the project). `ai-gen` can also read the `ANTHROPIC_API_KEY` secret, and no other secret. `firestore.ai.rules` denies all browser access to the `ai` database.

### Settings

`metadata/aiQuestions` in `(default)`, edited on the admin page's AI Questions tab. A missing document or field means the default.

| Field | Default | Effect |
|---|---|---|
| `generationEnabled` | `false` | The weekly run does nothing while it's off. Generate now ignores it. |
| `questionsPerRun` | `1` | Questions per run, 1 to 10. Generate now can ask for a different count. |
| `servingEnabled` | `false` | Not used here. The app serves AI questions only while it's on. |

### A run

1. Read the settings. A weekly run stops here while generation is off.
2. Take `locks/generation` (30 minute TTL, which outlives the function timeout). If another run holds it, the weekly run is skipped and Generate now returns `aborted`.
3. Generate now only: after 5 manual runs in 24 hours (dry runs included), it returns `resource-exhausted`.
4. Pick the chapter (this week's from the rotation, unless one was given) and create the `generationRuns` document.
5. Read the context: the chapter's human questions, its published AI questions, and every question generated for it before (pending, approved or rejected).
6. Ask Claude for the missing questions, up to 3 attempts, and validate each one.
7. In one batch, add the valid questions to `questionsAiPending` (skipped on a dry run) and finish the run document.

A run ends `succeeded` (every requested question), `partial` (some) or `failed` (none, or an unexpected error), with up to 20 errors. The admin page lists recent runs.

### Documents in the `ai` database

```
questionsAiPending/{autoId}         the id becomes the question's aiQuestionId on approval
  chapter, question, choices (4), correctChoice (0-based), explanation ("Correct Answer: N\n\n...")
  status: "pending" (the app sets "approved" or "rejected"), aiGenerated: true, generatedAt
  generationRunId, trigger ("scheduled" | "manual" | "local"), requestedBy (uid or null), model

generationRuns/{autoId}
  trigger, chapter, requestedQuestionCount, generatedQuestionCount, status, errors, dryRun, requestedBy
  startedAt, finishedAt, model, inputTokens, outputTokens

locks/generation
  lockToken, owner, acquiredAt, expiresAt
```

The generator doesn't set `questionNumber` or `premium`. The reviewer picks free or premium, and approval numbers the question from the AI repo file.

### The Claude request

`claude-opus-5-5`, streamed, `max_tokens` 64000, effort `high`, JSON schema structured output, and the server-side fallback (`fallbacks: "default"`), so a declined request is retried on the model Anthropic recommends. The chapter context is a cached content block, so retries within a run read it from the prompt cache. ChatGPT citation artifacts left in some human questions (`&#8203;:contentReference[oaicite:N]{index=N}`) are stripped from it, and a generated question that contains one is rejected. The response is used only after checking `stop_reason` (`refusal`, `max_tokens`), and is read from its text blocks, never from `content[0]` (the response starts with thinking blocks). After a mid-response decline, the JSON is either the text after the last `fallback` block (the fallback model started over) or, as on a stream, every text block joined in order (the fallback model continued the declined model's partial output). The text after the block is tried first.

## Setup (once)

You need Node 22, the Firebase CLI (`firebase login`) and the gcloud CLI (`gcloud auth login`), as a project owner.

1. Store the Anthropic API key: `firebase functions:secrets:set ANTHROPIC_API_KEY`
2. Run `scripts/setup-ai-gen-access.sh`. It creates the `ai` database in the same location as `(default)`, creates the `ai-gen` service account and grants its roles, and is safe to re-run. Set `DEPLOYER_MEMBER=user:you@example.com` to let someone who isn't a project owner deploy functions that run as `ai-gen`.
3. Deploy the `ai` database's rules: `firebase deploy --only firestore`
4. Deploy the functions: `firebase deploy --only functions:ai-gen`. The predeploy step runs the tests and refuses to deploy while a `.env` file exists.
5. Check the boundary: give yourself `roles/iam.serviceAccountTokenCreator` on `ai-gen` (the command is in the script's header), then run `scripts/check-ai-gen-access.sh`. A write to `(default)` must fail with 403.
6. Try a dry run with Generate now on the admin page, then turn on weekly generation there. To test the schedule itself, force a run of the `generateAiQuestions` job in Cloud Scheduler and check that a `generationRuns` document appears.

## Local runs

```bash
npm install
cp local-generation.env.example local-generation.env   # add ANTHROPIC_API_KEY
gcloud auth application-default login
npm run generate:local
```

`local-generation.env` also takes `CHAPTER_OVERRIDE` (1-20), `QUESTION_COUNT` (1-10) and `DRY_RUN=true`, which prints the questions without adding them to the review queue. A local run uses your own credentials, not `ai-gen`'s, and is recorded in `generationRuns` with trigger `local`. Never name the file `.env`: the Firebase CLI deploys a `.env` file in the functions folder as plain environment variables.

## Tests

```bash
npm test
```

`node:test` unit tests for validation, the chapter rotation, the Claude request and response handling (with a fake client), and the attempt loop. They need no network or credentials.
