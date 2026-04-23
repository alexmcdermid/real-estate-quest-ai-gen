# real-estate-quest-ai-gen

A weekly GitHub Actions workflow that uses the [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-js) and Claude Opus to generate new BC real estate licensing exam practice questions, demonstrating how to integrate an LLM into an automated content pipeline.

Generated questions are written to a dedicated Firebase project, reviewed by a human in the [real-estate-quest](https://github.com/alexmcdermid/real-estate-quest) admin console, and only then made available to students on the live site.

## How it works

1. **Schedule** — A GitHub Actions cron job runs every Monday at 9am UTC
2. **Fetch** — Reads a chapter's worth of questions from a private question bank via the GitHub API
3. **Generate** — Sends all questions from that chapter as few-shot examples to Claude Opus, which generates one new original question in the same format and style
4. **Validate** — Checks the response matches the required JSON schema and explanation format before accepting it
5. **Write** — Saves the question to `questionsAiPending` in a separate Firebase project, where it waits for human review
6. **Review** — A human reviews the pending question in the [real-estate-quest](https://github.com/alexmcdermid/real-estate-quest) admin console and approves or rejects it
7. **Publish** — Approved questions are pulled into the production database and served to students on the live site

Questions are never written directly to the production database.

## Project structure

```
src/
  index.js              # entry point — picks chapter, orchestrates the pipeline
  fetchQuestions.js     # reads chapter questions from private GitHub repo via Octokit
  generateQuestion.js   # Anthropic SDK call with few-shot prompting + output validation
  writeToFirestore.js   # writes pending question to Firebase (AI project, not prod)
.github/workflows/
  generate-questions.yml  # weekly cron + manual trigger
  dry-run.yml             # manual trigger only — logs output, no Firestore write
```

## Running locally

```bash
cp .env.example .env
# fill in all three credentials (see .env.example for instructions)
npm install
npm run dev
```

Use `DRY_RUN=true` in `.env` to generate and log a question without writing to Firestore.
See [dev.md](dev.md) for full setup instructions including Firebase and GitHub PAT configuration.

## GitHub Actions secrets

| Secret | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `QUESTIONS_REPO_PAT` | Fine-grained GitHub PAT, read-only on the private questions repo |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service account key for the `real-estate-quest-ai` Firebase project |

Add these under **Settings → Secrets and variables → Actions** in this repo.

## Workflows

| Workflow | Trigger | Effect |
|---|---|---|
| Generate AI Question | Weekly (Mon 9am UTC) + manual | Generates and writes to Firestore |
| Dry Run | Manual only | Generates and logs to Actions output, no write |

Both support an optional chapter number input when triggered manually.
