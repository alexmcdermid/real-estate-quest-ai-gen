# Developer Guide

## What this does

A GitHub Actions workflow runs weekly, picks a chapter of BC real estate licensing exam questions from a private question bank, sends them as few-shot examples to Claude Opus, receives a new original question back, validates it, and writes it to a dedicated Firebase project (`real-estate-quest-ai`) for human review. A human then reviews and approves or rejects the question in the [real-estate-quest](https://github.com/alexmcdermid/real-estate-quest) admin console before it is ever served to students. This pipeline never touches the production database.

## Architecture

```
GitHub Actions (weekly cron or manual trigger)
  │
  ├── fetchQuestions.js
  │     └── reads {chapter}.js from private GitHub repo (real-estate-quest-questions)
  │         via Octokit + QUESTIONS_REPO_PAT (read-only)
  │
  ├── generateQuestion.js
  │     └── samples 10 random questions as few-shot context
  │         sends to Claude Opus via Anthropic SDK
  │         validates JSON schema and explanation format
  │
  └── writeToFirestore.js
        ├── queries questionsAiPending + questionsAiApproved to determine next questionNumber
        └── writes new question to questionsAiPending
            (real-estate-quest-ai project — separate from prod)
```

### Firebase projects

| Project | Purpose | Written by |
|---|---|---|
| `real-estate-quest` | Production — live site and user data | Never touched by this pipeline |
| `real-estate-quest-ai` | AI question staging area | This pipeline only |

### Firestore collections (real-estate-quest-ai project)

| Collection | Written by | Read by |
|---|---|---|
| `questionsAiPending` | this pipeline | real-estate-quest admin console (future) |
| `questionsAiApproved` | real-estate-quest admin (future) | real-estate-quest site (future) |

### Question schema

```json
{
  "chapter": 3,
  "questionNumber": 1,
  "question": "...",
  "choices": ["...", "...", "...", "..."],
  "correctChoice": 0,
  "premium": true,
  "explanation": "Correct Answer: 1\n\n...",
  "status": "pending",
  "generatedAt": "<Firestore server timestamp>"
}
```

- `correctChoice` — 0-based index into `choices`
- `explanation` — must start with `"Correct Answer: N"` where N is `correctChoice + 1` (1-based). The validator enforces this before writing.
- `status` and `generatedAt` — added by `writeToFirestore.js`, not part of the LLM output

### Chapter rotation

Without `CHAPTER_OVERRIDE`, the chapter is derived from the ISO week number of the year, cycling through 1–20 and repeating every 20 weeks. The dry-run and live workflows both accept a manual chapter override input.

---

## Local setup

### 1. Clone and install

```bash
git clone <this repo>
cd real-estate-quest-ai-gen
npm install
cp .env.example .env
```

### 2. Anthropic API key

- Go to [console.anthropic.com](https://console.anthropic.com/)
- Create an API key
- Add to `.env`: `ANTHROPIC_API_KEY=sk-ant-...`

### 3. GitHub PAT (read-only access to questions repo)

- Go to GitHub → Settings → Developer Settings → Fine-grained personal access tokens
- New token scoped to the `real-estate-quest-questions` repo only
- Permission needed: **Contents: Read**
- Add to `.env`: `QUESTIONS_REPO_PAT=github_pat_...`

### 4. Firebase service account (AI project only)

- Create a Firebase project named `real-estate-quest-ai` (keep this separate from the prod project)
- Enable Firestore in that project (Native mode)
- Go to Project Settings → Service Accounts → Generate new private key
- Download the JSON file — **do not commit it**
- Convert to a single line and add to `.env`:
  ```bash
  cat service-account.json | tr -d '\n'
  # paste the output as FIREBASE_SERVICE_ACCOUNT_JSON=...
  ```

### 5. Run locally

```bash
# Live run — generates a question and writes to Firestore
npm run dev

# Dry run — generates and logs the question, no Firestore write
DRY_RUN=true npm run dev

# Target a specific chapter
CHAPTER_OVERRIDE=5 npm run dev
```

---

## GitHub Actions secrets

Add these under **Settings → Secrets and variables → Actions** in this repo:

| Secret | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `QUESTIONS_REPO_PAT` | Fine-grained GitHub PAT, read-only on `real-estate-quest-questions` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full service account JSON (single line) for `real-estate-quest-ai` project |

## Workflows

| Workflow | Trigger | Effect |
|---|---|---|
| `generate-questions.yml` | Weekly (Mon 9am UTC) + manual | Generates and writes to Firestore |
| `dry-run.yml` | Manual only | Generates and logs to Actions output, no write |

Both accept an optional **Chapter** input when triggered manually.

---

## Integration with real-estate-quest (out of scope here)

The [real-estate-quest](https://github.com/alexmcdermid/real-estate-quest) project is the other half of this pipeline:

- **Admin console** reads `questionsAiPending` from the AI Firebase project using a read-only service account credential stored in Cloud Functions config. A human approves or rejects each question — approve moves it to `questionsAiApproved`, reject deletes it.
- **Scheduled import** — a Cloud Function in real-estate-quest polls `questionsAiApproved` on a regular cadence and writes approved questions into the production Firestore, where they are served to students on the live site.

Nothing in this repo ever writes to the production database.
