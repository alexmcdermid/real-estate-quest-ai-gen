# AI question flow (proposed)

> **Status:** draft design, not built. Once built, this replaces the GitHub Actions + separate `real-estate-quest-ai` Firebase project setup described in [README.md](../README.md) and [dev.md](../dev.md).
>
> The app-side half (review, import, serving) is in `real-estate-quest` → `docs/ai-question-flow.md` on the `docs/ai-question-flow` branch. The overview and lifecycle diagrams are the same in both repos.

## Principles

- **Repos are the source of truth for anything students see.** Firestore is a copy that can be rebuilt from the repos at any time.
- **`questionsAiPending` is a disposable review queue.** Losing it costs a regeneration, nothing more.
- **AI questions never go into `questions`.** The nightly human import deletes and reimports whole chapters, so anything else in that collection would be wiped.
- **The human questions repo stays read-only everywhere.** Only the new AI repo gets a write token.

## Where things live

There is **one Firebase project**, the existing `real-estate-quest`. There is no separate AI project; the generator, the app, and every collection below live in it.

| | What | Notes |
|---|---|---|
| Firebase project | `real-estate-quest` | The only one. Runs the app, all functions, and Firestore. |
| Functions | `default` codebase from the `real-estate-quest` repo<br>`ai-gen` codebase from the `real-estate-quest-ai-gen` repo | Two repos deploy into the same project. Deploying one never touches the other's functions. |
| Firestore | `questions` (existing), `questionsAi`, `questionsAiPending`, `metadata/aiQuestions` | All in the same database, so no credentials are needed between pieces. |
| GitHub | `real-estate-quest-questions` (existing, human)<br>`real-estate-quest-ai-questions` (new, AI) | Both private. The source of truth for anything students see. |
| External | Claude API | Called only by the generator. |

## Overview

```mermaid
flowchart LR
  subgraph GEN["Step 1: Generate (weekly)"]
    G["generateAiQuestion<br/>(ai-gen codebase)"] <--> CL["Claude API"]
  end

  subgraph REV["Step 2: Review"]
    QP[("questionsAiPending<br/>review queue")] --> ADM["Admin AI tab<br/>approve or reject"]
  end

  subgraph SOT["Step 3: GitHub"]
    HR[("human questions repo")]
    AR[("AI questions repo<br/>(new)")]
  end

  subgraph IMP["Step 4: Import (nightly, and on approve)"]
    I["importChapterFromRepo"]
  end

  subgraph SRV["Step 5: Serve"]
    Q[("questions")]
    QA[("questionsAi")]
    API["getQuestionsByChapter<br/>preloadContent"]
    STU["Student app"]
    Q --> API
    QA -- "user toggle on" --> API
    API --> STU
  end

  G --> QP
  ADM -- "approve = commit" --> AR
  HR --> I
  AR --> I
  I --> Q
  I --> QA
```

The generator also reads `questions` (few-shot examples) and `questionsAi` (to avoid duplicates); see the generation diagram.

## Question lifecycle

```mermaid
stateDiagram-v2
  direction LR
  state "Pending review" as Pending
  state "In AI repo" as InRepo
  state "Live in questionsAi" as Live

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
  end note
```

## Weekly generation (this repo)

```mermaid
sequenceDiagram
  autonumber
  participant S as Cloud Scheduler<br/>(Mon 9am)
  participant G as generateAiQuestion
  participant F as Firestore
  participant C as Claude API

  S->>G: trigger (or Generate now button in admin)
  G->>F: read metadata/aiQuestions
  alt generate flag off
    G-->>S: exit
  end
  G->>G: pick chapter (week rotation or override)
  G->>F: read questions for chapter N (few-shot examples)
  G->>F: read questionsAi + questionsAiPending for chapter N (avoid duplicates)
  loop up to 3 attempts
    G->>C: messages.create with a JSON schema output format
    C-->>G: question JSON
    G->>G: validate (4 choices, Correct Answer prefix, stop_reason)
  end
  alt valid
    G->>F: add to questionsAiPending (status pending, aiGenerated true)
  else still invalid
    G->>F: log to function_error_logs
  end
```

The generator no longer assigns `questionNumber`. Approval assigns it from the AI repo file, so rejected questions don't leave gaps.

## Where the generator runs: Cloud Function

Both options are close to free. The Claude call is the real cost, and it's the same either way.

| | Cloud Function (chosen) | GitHub Actions (current code) |
|---|---|---|
| Infra cost | Free tier covers it. Cloud Scheduler gives 3 free jobs per billing account and the project already has 3, so this one is about $0.10/month | Free on a public repo; a private repo uses about 1 of 2,000 free minutes a month |
| Claude cost | Roughly 10–20 cents per question on Opus 5.5 (up to ~25k input tokens for an 80-question chapter) | Same |
| Credentials | None leave Google. Reads Firestore directly, so no GitHub token either | Needs a Firebase service account key stored in GitHub, which is why a separate staging project was needed |
| Manual run | "Generate now" button on the admin page, or force-run the Scheduler job | Run workflow button in GitHub |

The code stays in this repo and deploys to the `real-estate-quest` project as its own functions codebase (`ai-gen`), so deploys here never touch the app's functions and vice versa.

**Why the same Firebase project, not a separate one:** the generator reads `questions` and `questionsAi` and writes `questionsAiPending`, and the app's admin functions read that same queue. In one project all of that is plain Firestore access with no credentials to manage. In a separate project, one side would need access across projects: either the generator writing into the live project, or the admin functions reading the other project. That adds IAM setup and buys no real isolation, since the generator still needs the live question data. The separate project only made sense when the generator ran in GitHub Actions with a key stored there.

## Changes in this repo

- [ ] Turn `src/index.js` into a `generateAiQuestion` scheduled function. Add `firebase.json` with codebase `ai-gen`, targeting the `real-estate-quest` project.
- [ ] Read few-shot examples from the Firestore `questions` collection instead of GitHub. That drops Octokit and the `GITHUB_PAT` / `QUESTIONS_REPO_PAT` mismatch.
- [ ] Read duplicate-avoidance context from `questionsAi` plus every `questionsAiPending` doc for the chapter, including rejected ones.
- [ ] Remove `questionNumber` assignment and the composite-index query that came with it.
- [ ] Use structured outputs (`output_config.format`), raise `max_tokens`, check `stop_reason`, and retry up to 3 times.
- [ ] Bump `@anthropic-ai/sdk` from 0.39.0 and move to `claude-opus-5-5`.
- [ ] Check the `generate` flag in `metadata/aiQuestions` before running.
- [ ] Keep a local dry-run script (`DRY_RUN=true`).
- [ ] Delete the two GitHub workflows and the staging-project setup; rewrite README.md and dev.md.

## Open questions

- One question per run, or a few (e.g. one per chapter in the week's rotation)?
- Notify admins when something lands in the queue, or just show a count on the admin page?
