# real-estate-quest-ai-gen

A weekly GitHub Actions workflow that uses the [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-python) to generate new real estate exam practice questions, demonstrating how to integrate an LLM into an automated content pipeline.

## How it works

1. **Schedule** — A GitHub Actions cron job runs every Monday at 9am UTC
2. **Fetch** — Reads a chapter's worth of questions from a private question bank via the GitHub API
3. **Generate** — Sends those questions as few-shot examples to Claude (Sonnet), which generates one new question in the same format
4. **Commit** — Writes the validated question back to the private repo under `ai-gen/{chapter}.js`

The questions eventually get picked up by a separate daily import job and loaded into the live site's Firestore database.

## Project structure

```
src/
  index.js             # entry point — picks chapter, orchestrates the pipeline
  fetchQuestions.js    # reads from private GitHub repo via Octokit
  generateQuestion.js  # Anthropic SDK call + output validation
  commitQuestion.js    # writes result back to private repo
.github/workflows/
  generate-questions.yml  # cron schedule + manual trigger
```

## Running locally

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY and QUESTIONS_REPO_PAT
npm install
npm run dev
```

Set `CHAPTER_OVERRIDE=5` in `.env` to target a specific chapter instead of the weekly rotation.

## Secrets (GitHub Actions)

| Secret | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `QUESTIONS_REPO_PAT` | GitHub PAT with `repo` access to the private questions repo |

Add these under **Settings → Secrets and variables → Actions** in this repo.

## Manual trigger

The workflow also supports manual runs via **Actions → Generate AI Question → Run workflow**, with an optional chapter override input.
