import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

const OWNER = "alexmcdermid";
const REPO = "real-estate-quest-questions";

/**
 * Fetches all questions for a given chapter from the private questions repo.
 * Returns a parsed array of question objects.
 */
export async function fetchChapterQuestions(chapter) {
  const { data } = await octokit.repos.getContent({
    owner: OWNER,
    repo: REPO,
    path: `${chapter}.js`,
  });

  const raw = Buffer.from(data.content, "base64").toString("utf-8");

  // Files export a JSON array — strip the surrounding brackets to parse
  const json = raw.trim().replace(/^export default\s*/, "").replace(/;?\s*$/, "");
  return JSON.parse(json);
}

