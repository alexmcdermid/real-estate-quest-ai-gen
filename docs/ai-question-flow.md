# AI question and flashcard flow

> **Status:** built on branch `feature/ai-question-flow`, not deployed yet. It replaces the GitHub Actions + separate `real-estate-quest-ai` Firebase project setup; [dev.md](../dev.md) has the new setup and deploy steps. AI flashcards go through the same flow as AI questions.
>
> The app-side half (review, import, serving) is in `real-estate-quest` → `docs/ai-question-flow.md`. The principles, where things live, overview and lifecycle sections are the same in both repos.

## Principles

- **Repos are the source of truth for anything students see.** Firestore is a copy that can be rebuilt from the repos at any time.
- **`questionsAiPending` and `flashcardsAiPending` are disposable review queues.** Losing them costs a regeneration, nothing more.
- **AI questions and flashcards never go into `questions` or `flashcards`.** The nightly human imports replace whole chapters of `questions` and all of `flashcards`, so anything else in those collections would be wiped.
- **The human questions repo stays read-only everywhere.** Only the new AI repo gets a write token.
- **The generator can only write to its own database.** It runs as its own service account, which can write the `ai` database and only read `(default)`. A bug in the generator can't change user data, subscriptions or live questions and flashcards.

## Where things live

There is **one Firebase project**, the existing `real-estate-quest`. There is no separate AI project; the generator, the app, and every collection below live in it. The project has two Firestore databases: `(default)`, which exists today, and a new `ai` one.

| | What | Notes |
|---|---|---|
| Firebase project | `real-estate-quest` | The only one. Runs the app, all functions, and both Firestore databases. |
| Functions | `default` codebase from the `real-estate-quest` repo<br>`ai-gen` codebase from the `real-estate-quest-ai-gen` repo | Two repos deploy into the same project. Deploying one never touches the other's functions. |
| Firestore `(default)` | Everything that exists today (`members`, `questions`, `flashcards`, `study_activity_logs`, ...), plus `questionsAi` and `flashcardsAi` (live AI content), `metadata/aiContent` (`generationEnabled`, `servingEnabled`, `questionsPerRun`, `flashcardsPerRun`), `metadata/content` (`contentVersion`), `metadata/questionsAi` and `metadata/flashcardsAi` (AI file hashes), `locks/*` (per-chapter locks) | User data lives here. Point-in-time recovery plus the existing weekly backups. |
| Firestore `ai` (new) | `questionsAiPending` and `flashcardsAiPending` (review queues), `generationRuns` (one doc per run, with its content type and any error), `locks/generation` | Everything the generator writes, and nothing else. Disposable, so no point-in-time recovery or backups. |
| Service accounts | `ai-gen` (new) runs the `ai-gen` functions<br>The app's functions keep the default one | See Access below. |
| GitHub | `real-estate-quest-questions` (existing, human)<br>`real-estate-quest-ai-questions` (new, AI) | Both private. The source of truth for anything students see. The AI repo holds `questions/<chapter>.json` and `flashcards/<chapter>.json`. Each entry has the human files' fields in the same order, then `aiGenerated: true` and its AI id. Questions: `chapter`, `questionNumber`, `question`, `choices`, `correctChoice`, `premium`, `explanation`, `aiGenerated`, `aiQuestionId`. Flashcards (the human ones are a single `flashcards.js`): `documentID`, `cardNumber`, `front`, `back`, `chapter`, `tags`, `premium`, `difficulty`, `aiGenerated`, `aiFlashcardId`. |
| External | Claude API | Called only by the generator. |

### Access

Firestore can't limit server code to certain collections. Security rules work per collection, but they only apply to web and mobile clients; the Admin SDK that Cloud Functions use skips them. IAM does apply to functions, but the smallest thing it can scope to is a whole database. So everything the generator writes goes in its own database, and IAM keeps it there.

| Service account | `(default)` | `ai` |
|---|---|---|
| `ai-gen` (the generator) | read only (`roles/datastore.viewer`) | read and write (`roles/datastore.user`) |
| Default (the app's functions) | read and write | read and write |

- **Each `ai-gen` grant has an IAM condition naming its database,** such as `resource.name == "projects/real-estate-quest/databases/ai"`. A grant without a condition covers every database in the project, which is why the app's functions can already reach both.
- **`ai-gen` also gets the Anthropic key secret, and nothing else.** No GitHub tokens, no Stripe keys.
- **The generator can still read user data in `(default)`.** It can't change or delete it.
- **No keys are involved.** Both databases are in one project, so access is plain IAM.

## Overview

```mermaid
flowchart LR
  subgraph GEN["Step 1: Generate (weekly)"]
    G["generateAiContent<br/>(ai-gen codebase)"] <--> CL["Claude API"]
  end

  subgraph REV["Step 2: Review"]
    QP[("questionsAiPending<br/>flashcardsAiPending<br/>(ai database)")] --> ADM["Admin AI Content tab<br/>approve or reject"]
  end

  subgraph SOT["Step 3: GitHub"]
    HR[("human questions repo")]
    AR[("AI questions repo<br/>(new)")]
  end

  subgraph IMP["Step 4: Import (nightly, and on approve)"]
    I["importQuestionsFromRepo<br/>importFlashCardsFromRepo"]
  end

  subgraph SRV["Step 5: Serve"]
    Q[("questions<br/>flashcards")]
    QA[("questionsAi<br/>flashcardsAi")]
    API["getQuestionsByChapter<br/>getFlashCardsByChapter<br/>preloadContent"]
    STU["Student app"]
    Q --> API
    QA -- "if servingEnabled" --> API
    API --> STU
  end

  G --> QP
  ADM -- "approve = commit" --> AR
  HR --> I
  AR --> I
  I --> Q
  I --> QA
```

Every collection in the diagram is in `(default)` except the two review queues. The generator also reads the human and live AI questions and flashcards from `(default)`, read only, as context and to avoid duplicates; see the generation diagram.

## Question and flashcard lifecycle

```mermaid
stateDiagram-v2
  direction LR
  state "Pending review" as Pending
  state "In AI repo" as InRepo
  state "Live in questionsAi or flashcardsAi" as Live

  [*] --> Pending: generated and validated
  Pending --> Pending: admin edits
  Pending --> Rejected: admin rejects
  Pending --> InRepo: admin approves (commit)
  InRepo --> Live: imported
  Live --> InRepo: edited or deleted on GitHub
  Rejected --> [*]

  note right of Rejected
    Kept in the queue so the
    generator avoids the topic
    or term
  end note
```

## Weekly generation (this repo)

```mermaid
sequenceDiagram
  autonumber
  participant S as Cloud Scheduler<br/>(Mon 9am)
  participant G as generateAiContent<br/>(runs as ai-gen)
  participant D as Firestore (default)<br/>read only
  participant A as Firestore (ai)
  participant C as Claude API

  S->>G: weekly trigger
  loop questions, then flashcards
    G->>D: read metadata/aiContent (generationEnabled, questionsPerRun or flashcardsPerRun)
    alt generationEnabled off
      G->>G: skip this run
    end
    G->>A: take the generation lock (skip the run if one is already going)
    G->>G: pick this week's chapter (the same for both runs)
    G->>A: create the generationRuns doc (contentType, status running)
    G->>D: read every question or flashcard in chapter N, human and live AI (context, avoid duplicates)
    G->>A: read questionsAiPending or flashcardsAiPending for chapter N, rejected included
    opt flashcards
      G->>D: read the fronts of every chapter's flashcards and flashcardsAi
      G->>A: read the fronts of every chapter's flashcardsAiPending
    end
    loop up to 3 attempts, until all requested items are valid
      G->>C: one request for the remaining count, JSON schema output
      C-->>G: thinking block(s), then a text block with the JSON
      G->>G: check stop_reason, parse the JSON from the text blocks (never content[0]), validate each item
    end
    G->>A: one batch: add valid ones to questionsAiPending or flashcardsAiPending (status pending, aiGenerated true),<br/>finish the run doc (status, counts, any errors)
    G->>A: release the generation lock
  end
```

- **One chapter per week, two runs.** A questions run, then a flashcards run, both for this week's chapter, each with its own lock, `generationRuns` doc and outcome, so a failed questions run doesn't stop the flashcards run. Every question or flashcard in that chapter is sent as context. The chapter rotation repeats every 20 weeks.
- **`questionsPerRun` questions and `flashcardsPerRun` flashcards a week**, from `metadata/aiContent`, so they can change without a deploy. Start at 1–2 and scale to 5–10. Each run's items are generated in one request so they don't repeat each other, and the chapter context is only paid for once.
- **The prompts follow the course manual.** Each lists the chapter's topics, the section headings of the 2024 UBC licensing course manual chapters it covers ([src/chapters.js](../src/chapters.js); app chapters 9 and 10 have none yet), and every item must come from one of them.
- **Flashcards are for the course glossary's terms.** The flashcard prompt also offers the terms of the manual's glossary ([src/glossaryTerms.js](../src/glossaryTerms.js), still missing some): terms only, never the manual's definitions, since Claude writes its own. The glossary covers the whole course, so only terms that no card in any chapter covers yet are offered, and a new card's front must not repeat the front of any chapter's card (human, live AI or generated before). Questions are only checked against their own chapter.
- **The generator doesn't assign numbers, `premium` or ids.** The reviewer decides free or premium at approval, and approval assigns the `questionNumber` or `cardNumber` from the AI repo file (and a flashcard's `documentID`), so rejected items don't leave gaps.
- **Every run leaves a `generationRuns` doc** with its `contentType`, including runs that produced fewer items than requested or failed. The generator can't write `function_error_logs` in `(default)`, so this is where its errors go; the admin AI Content tab shows the recent runs. An error before the run doc exists fails the weekly function instead, so Cloud Scheduler shows it.
- **Up to 30 minutes.** Both functions time out after 1800 s, the most a scheduled function can have, and the weekly function's two runs share that. The generation lock lasts 30 minutes, so it outlives any function run.

### Generate now (manual runs)

The browser can't call a scheduled function, so manual runs get their own endpoint. `generateAiContentNow` is an `onCall` function in this codebase that shares the generator's core code (`runGeneration`) with the schedule. The admin page's Generate now button calls it and waits up to 30 minutes for the result.

- **Admin only.** It requires App Check and the `isAdmin` claim, like the app's other admin callables. Signed-out callers get `unauthenticated`, and anyone else without the claim gets `permission-denied`.
- **Inputs:** a required `contentType` (`questions` or `flashcards`), an optional `chapter` (1–20, defaults to this week's), `itemCount` (1–10, defaults to `questionsPerRun` or `flashcardsPerRun`), and `dryRun`, which returns the items without adding them to the review queue (the run is still recorded). Other values get `invalid-argument`.
- **One run per call.** It returns the run's outcome (`runId`, `contentType`, `chapter`, `requestedItemCount`, `generatedItemCount`, `status`, `errors`) and its `items`, the questions or flashcards, each with its `pendingDocumentId` (null on a dry run).
- **It ignores `generationEnabled`,** so you can test before turning the weekly schedule on.
- **No double runs.** It takes the same generation lock as the schedule, so a double-click or a clash with the Monday runs returns "already running" (`aborted`) instead of paying for two runs.
- **Bounded cost.** A cap of 10 manual runs in the last 24 hours, questions and flashcards together (dry runs count), counted from `generationRuns`, stops a stuck button or a loop from running up the Claude bill. Past it, the call returns `resource-exhausted`.
- **It records who asked:** the run record and pending docs from a manual run get `requestedBy`.

## Where the generator runs: Cloud Function

Both options are close to free. The Claude call is the real cost, and it's the same either way.

| | Cloud Function (chosen) | GitHub Actions (old code) |
|---|---|---|
| Infra cost | Free tier covers it. Cloud Scheduler gives 3 free jobs per billing account and the project already has 3, so this one is about $0.10/month | Free on a public repo; a private repo uses about 1 of 2,000 free minutes a month |
| Claude cost | On Opus 5.5, about 10 cents per questions run for the chapter context (up to ~25k input tokens for an 80-question chapter), plus a few cents per question. A flashcards run's context is smaller: the chapter's cards and the glossary terms. At 5–10 of each a week, a few dollars a month | Same |
| Credentials | None leave Google. Runs as its own `ai-gen` service account and reads Firestore directly, so no GitHub token either | Needs a Firebase service account key stored in GitHub, which is why a separate staging project was needed |
| Manual run | The admin page's Generate now button, which calls the admin-only `generateAiContentNow` callable, or force-run the Scheduler job | Run workflow button in GitHub |

The code stays in this repo and deploys to the `real-estate-quest` project as its own functions codebase (`ai-gen`), so deploys here never touch the app's functions and vice versa.

**Why the same Firebase project, not a separate one:** the generator reads the live questions and flashcards and writes the review queues, and the app's admin functions read those same queues. In one project all of that is plain Firestore access with no credentials to manage. In a separate project, one side would need access across projects: either the generator writing into the live project, or the admin functions reading the other project. The isolation a second project would give comes from the second database instead: the generator can write only to `ai` (see Access above). The separate project only made sense when the generator ran in GitHub Actions with a key stored there.

## Changes in this repo

**Access setup (before the first deploy)**

- [ ] Create the `ai` Firestore database, in the same location as `(default)`; `scripts/setup-ai-gen-access.sh` does it. Its deny-all security rules (`firestore.ai.rules`) are listed under `firestore` in this repo's `firebase.json`, so deploys from here only touch the `ai` database's rules.
- [ ] Create the `ai-gen` service account. Grant it `roles/datastore.user` on `ai` and `roles/datastore.viewer` on `(default)`, each with an IAM condition naming the database, plus `roles/secretmanager.secretAccessor` on the Anthropic key secret only. Let whoever deploys act as it (`roles/iam.serviceAccountUser`). Running `scripts/setup-ai-gen-access.sh` does all of this and is safe to repeat; set the `ANTHROPIC_API_KEY` secret first, and `DEPLOYER_MEMBER` for the deployer grant.
- [ ] Once deployed, check the boundary with `scripts/check-ai-gen-access.sh` (it needs `roles/iam.serviceAccountTokenCreator` on `ai-gen`): a test write to `(default)` as `ai-gen` should fail with `PERMISSION_DENIED`. Then force a run of the `generateAiContent` job in Cloud Scheduler to check it can still invoke the function.

**Code**

- [x] Turn `src/index.js` into a `generateAiContent` scheduled function that runs questions, then flashcards. Add `firebase.json` with codebase `ai-gen`, targeting the `real-estate-quest` project (`.firebaserc`). Its predeploy runs `npm test` and refuses to deploy while a `.env` file exists.
- [x] Set `serviceAccount` to `ai-gen` on both functions. Without it they run as the default account, which can write everywhere.
- [x] Use two Firestore clients ([src/firestore.js](../src/firestore.js)): `defaultDb` for reads, `aiDb` (`getFirestore(app, "ai")`) for every write.
- [x] Record each run, with its `contentType`, in `generationRuns` instead of writing `function_error_logs`.
- [x] Add `generateAiContentNow`, an admin-only callable (App Check + `isAdmin`) that shares the generator's core ([src/runGeneration.js](../src/runGeneration.js)). It takes `contentType`, `chapter`, `itemCount` and `dryRun`, and uses the shared generation lock and a daily cap.
- [x] Generate flashcards the way questions are generated. [src/contentTypes.js](../src/contentTypes.js) holds what differs per content type (per-run setting, collections, prompt, validation, duplicate check), and both share the attempt loop ([src/collectValidItems.js](../src/collectValidItems.js)) and the Claude request ([src/claudeBatchRequest.js](../src/claudeBatchRequest.js)). The flashcard prompt is in [src/generateFlashcards.js](../src/generateFlashcards.js) and its rules, the same ones the app applies at approval, in [src/flashcardValidation.js](../src/flashcardValidation.js).
- [x] Read few-shot examples from the Firestore `questions` and `flashcards` collections instead of GitHub. That drops Octokit and the `GITHUB_PAT` / `QUESTIONS_REPO_PAT` mismatch.
- [x] Read duplicate-avoidance context from `questionsAi` or `flashcardsAi` plus every pending doc for the chapter, including rejected ones. Flashcard fronts are also checked against every chapter.
- [x] Remove `questionNumber` assignment and the composite-index query that came with it. Stop forcing `premium: true`; the reviewer sets it.
- [x] Generate `questionsPerRun` questions or `flashcardsPerRun` flashcards in one request: the schema returns a `questions` or `flashcards` array, and each item is validated on its own.
- [x] Give the prompts each chapter's course manual topics ([src/chapters.js](../src/chapters.js)), and the flashcard prompt the course glossary's terms that no card covers yet ([src/glossaryTerms.js](../src/glossaryTerms.js)).
- [x] Bump `@anthropic-ai/sdk` from 0.39.0 to ^1.3.0 and move to `claude-opus-5-5`. Opus 5.5 always thinks, so the response starts with thinking blocks, and the old `message.content[0].text` would throw. Parse the JSON from the `text` blocks instead, which also works when a `fallback` block sits between them.
- [x] Use structured outputs (`output_config.format`).
  - **Check `stop_reason` before parsing.** The server-side fallback is on (`fallbacks: "default"`), and a `refusal` or `max_tokens` that still comes back counts the attempt as failed.
  - **`max_tokens` is 64000,** for thinking plus up to 10 items, so the request is always streamed.
  - **`output_config.effort` is set to `high`.** Opus 5.5 defaults to `medium`.
  - **Up to 3 attempts** for any missing items.
- [x] Read `generationEnabled` and `questionsPerRun` or `flashcardsPerRun` from `metadata/aiContent` before running.
- [x] Keep a local runner alongside the callable's `dryRun` option: `npm run generate:local` reads `local-generation.env` (never `.env`, which the Firebase CLI would deploy) and takes `CONTENT_TYPE`, `CHAPTER_OVERRIDE`, `ITEM_COUNT` and `DRY_RUN=true`. `npm run preview:local` ([scripts/previewGeneration.js](../scripts/previewGeneration.js)) previews from a local checkout of the human questions repo without Firebase, printing the items as the AI repo stores them.
- [x] Delete the two GitHub workflows and the staging-project setup; rewrite README.md and dev.md.

## Decisions

- **Volume:** one chapter per week with all of its questions or flashcards as context. 1–2 questions and 1–2 flashcards per run to start, likely 5–10 of each later.
- **Free vs premium:** the reviewer decides at approval, premium by default, the same kind of split as the human content.
- **Rejected items:** kept, so the generator keeps avoiding those topics and terms.
- **Notifications:** none. New questions and flashcards just appear in the review queue on the admin page.
- **Who sees AI content** (app side): everyone, always labeled as AI. Pro users choose Mixed (default), Human only, or AI only, for questions and flashcards together; free users get them mixed in.
- **Course manual:** the prompts use its section headings and glossary terms only, never its text or definitions.
- **Generator access:** its own `ai` database and service account inside this project, not a separate project. It can write only to `ai` and only read `(default)`.
- **Backups:** point-in-time recovery on `(default)` alongside the weekly backups. The `ai` database needs neither.

## Deviations from the plan

- **Names:** `generate`, `serve`, `perRun` and `count` are `generationEnabled`, `servingEnabled`, `questionsPerRun` / `flashcardsPerRun` and `itemCount`. Since flashcards share the flow, the plan's `generateAiQuestions`, `generateAiQuestionsNow` and `metadata/aiQuestions` are `generateAiContent`, `generateAiContentNow` and `metadata/aiContent`.
- **The manual cap is 10 runs per 24 hours,** questions and flashcards together, instead of about 5.
- **Glossary terms instead of key terms:** the flashcard plan had a `keyTerms` list per manual chapter for both prompts. Instead, only the flashcard prompt gets terms: the manual glossary's terms that no card covers yet. The glossary covers every chapter, so flashcard fronts are checked against every chapter.
- **The local runner reads `local-generation.env`, not `.env`,** because the Firebase CLI deploys a `.env` in the functions folder as plain environment variables.
- **Dry runs are recorded:** they add nothing to the review queue, but they leave a `generationRuns` doc and count toward the daily cap.
