/**
 * The help-truth tables' rows for `github`'s review verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { parseGithubCoderabbitYieldArgs } from "../../../../cli/commands/github/coderabbitYieldCore.js";
import { GITHUB_CODERABBIT_YIELD_FLAG_NAMES } from "../../../../cli/commands/github/coderabbitYieldUsage.js";
import { githubVerbErrorLines } from "../../../../cli/commands/github/errors.js";
import {
  GITHUB_REVIEW_DRAFT_FLAG_NAMES,
  parseReviewDraftArgs,
} from "../../../../cli/commands/github/reviewDraftCore.js";
import { GITHUB_REVIEWER_FLAG_NAMES, parseGithubReviewerArgs } from "../../../../cli/commands/github/reviewerArgs.js";
import { githubReviewerErrorLines } from "../../../../cli/commands/github/reviewerRun.js";
import {
  GITHUB_REVIEW_STATE_FLAG_NAMES,
  parseGithubReviewStateArgs,
} from "../../../../cli/commands/github/reviewStateCore.js";
import {
  GITHUB_SELF_REVIEW_RELEASE_FLAG_NAMES,
  parseGithubSelfReviewReleaseArgs,
} from "../../../../cli/commands/github/selfReviewReleaseCore.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/** A valid `github review-draft record`, so each of its flags' probes is the whole invocation. */
const GITHUB_REVIEW_DRAFT_RECORD_PROBE: readonly string[] = [
  "record",
  "--repo",
  "owner/name",
  "--number",
  "1",
  "--form",
  "-",
  "--why",
  "a colleague's pull request",
];

/** A valid `github reviewer pick`, so each of its flags' probes only needs to add itself. */
const GITHUB_REVIEWER_PICK_PROBE: readonly string[] = [
  "pick",
  "--repo",
  "acme-admin",
  "--number",
  "1",
  "--reviewer",
  "U0ABC123",
  "--verdict",
  "approve",
  "--by-session",
  "work-console",
];

/** A valid `github reviewer read` of one message, so each read flag's probe only needs to add or swap itself. */
const GITHUB_REVIEWER_READ_BASE: readonly string[] = [
  "read",
  "--repo",
  "acme-admin",
  "--number",
  "1",
  "--message",
  "https://acme.slack.com/archives/C0AV/p1790152101764139",
  "--quote",
  "got another batch of these",
  "--by-session",
  "work-console",
];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "github coderabbit-yield": GITHUB_CODERABBIT_YIELD_FLAG_NAMES,
  "github review-draft": GITHUB_REVIEW_DRAFT_FLAG_NAMES,
  "github review-state": GITHUB_REVIEW_STATE_FLAG_NAMES,
  "github reviewer": GITHUB_REVIEWER_FLAG_NAMES,
  "github self-review": GITHUB_SELF_REVIEW_RELEASE_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  // --repo is required, so every other probe carries it.
  "github coderabbit-yield": {
    "--author": ["--repo", "owner/name", "--author", "someone"],
    "--days": ["--repo", "owner/name", "--days", "30"],
    "--home": ["--repo", "owner/name", "--home", "/tmp"],
    "--json": ["--repo", "owner/name", "--json"],
    "--repo": ["--repo", "owner/name"],
  },
  "github review-draft": {
    "--all": ["list", "--all"],
    "--approve": ["post", "rd-00000001", "--approve", "0123456789abcdef0123456789abcdef"],
    "--dry-run": ["post", "rd-00000001", "--dry-run"],
    "--form": [...GITHUB_REVIEW_DRAFT_RECORD_PROBE],
    "--home": ["list", "--home", "/tmp"],
    "--id": ["show", "--id", "rd-00000001"],
    "--json": ["list", "--json"],
    "--note": ["drop", "rd-00000001", "--note", "they said no"],
    "--number": [...GITHUB_REVIEW_DRAFT_RECORD_PROBE],
    "--repo": [...GITHUB_REVIEW_DRAFT_RECORD_PROBE],
    "--why": [...GITHUB_REVIEW_DRAFT_RECORD_PROBE],
  },
  "github review-state": {
    "--author": ["--author", "someone"],
    "--check-limit": ["--check-limit", "10"],
    "--detail": ["--detail"],
    "--file-limit": ["--file-limit", "10"],
    "--home": ["--home", "/tmp"],
    "--include-drafts": ["--include-drafts"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--no-slack-live": ["--no-slack-live"],
    // --number addresses ONE pull request through repository.pullRequest, so the parser refuses it without
    // exactly one --repo to resolve owner and name from.
    "--number": ["--repo", "owner/name", "--number", "16415"],
    "--repo": ["--repo", "owner/name"],
  },
  "github reviewer": {
    "--by-session": [...GITHUB_REVIEWER_PICK_PROBE],
    "--feedback": [...GITHUB_REVIEWER_PICK_PROBE, "--feedback", "on leave"],
    "--home": ["list", "--home", "/tmp"],
    "--json": ["list", "--json"],
    "--number": [...GITHUB_REVIEWER_PICK_PROBE],
    "--repo": [...GITHUB_REVIEWER_PICK_PROBE],
    "--reviewer": [...GITHUB_REVIEWER_PICK_PROBE],
    "--verdict": [...GITHUB_REVIEWER_PICK_PROBE],
    "--ask": [...GITHUB_REVIEWER_READ_BASE, "--ask", "--to", "U0ABC123"],
    "--message": [...GITHUB_REVIEWER_READ_BASE, "--ask", "--to", "U0ABC123"],
    "--non-ask": [...GITHUB_REVIEWER_READ_BASE, "--non-ask", "--why", "a status line"],
    "--quote": [...GITHUB_REVIEWER_READ_BASE, "--ask", "--to", "U0ABC123"],
    "--to": [...GITHUB_REVIEWER_READ_BASE, "--ask", "--to", "U0ABC123"],
    "--why": [...GITHUB_REVIEWER_READ_BASE, "--non-ask", "--why", "a status line"],
    "--apply": ["backfill", "--repo", "owner/name", "--author", "someone", "--apply"],
    "--author": ["backfill", "--repo", "owner/name", "--author", "someone"],
  },
  "github self-review": {
    "--head": ["--repo", "owner/name", "--pr", "1", "--head", "abc123"],
    "--home": ["--repo", "owner/name", "--pr", "1", "--home", "/tmp"],
    "--pr": ["--repo", "owner/name", "--pr", "1"],
    "--repo": ["--repo", "owner/name", "--pr", "1"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "github coderabbit-yield": ({ fragment }) => parseGithubCoderabbitYieldArgs({ rest: [...fragment] }),
  // A fragment naming its own sub-command passes through unchanged; anything else gets `list`, which is what the
  // generic unknown-flag strictness probe needs.
  "github review-draft": ({ fragment }) => {
    const named = ["record", "list", "show", "drop", "post"].includes(String(fragment[0]));
    return parseReviewDraftArgs({ defaultHome: "/tmp", rest: named ? [...fragment] : ["list", ...fragment] }).mapErr(
      (error) => githubVerbErrorLines({ error }),
    );
  },
  "github review-state": ({ fragment }) => parseGithubReviewStateArgs({ rest: [...fragment] }),
  // A fragment naming its own sub-verb passes through unchanged; anything else gets `list`, which is what the
  // generic unknown-flag strictness probe needs. The verb refuses through a typed union, read by its lines.
  "github reviewer": ({ fragment }) => {
    const named = ["list", "pick", "read", "backfill"].includes(String(fragment[0]));
    return parseGithubReviewerArgs({ rest: named ? [...fragment] : ["list", ...fragment] }).mapErr((error) =>
      githubReviewerErrorLines({ error }),
    );
  },
  "github self-review": ({ fragment }) => parseGithubSelfReviewReleaseArgs({ rest: [...fragment] }),
};

/** The rows for `github`'s review verbs. */
export const githubReviewsSlice: HelpTruthSlice = { guarded, probes, parsers };
