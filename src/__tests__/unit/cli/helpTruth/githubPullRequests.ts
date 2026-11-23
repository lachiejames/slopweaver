/**
 * The help-truth tables' rows for `github`'s pull-request verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { GITHUB_ATTACH_FLAG_NAMES, parseGithubAttachArgs } from "../../../../cli/commands/github/attachCore.js";
import { GITHUB_CLOSE_FLAG_NAMES, parseGithubCloseArgs } from "../../../../cli/commands/github/closeCore.js";
import { GITHUB_COMMENT_FLAG_NAMES, parseGithubCommentArgs } from "../../../../cli/commands/github/commentCore.js";
import { GITHUB_PR_FLAG_NAMES, parseGithubPrArgs } from "../../../../cli/commands/github/core.js";
import { githubVerbErrorLines } from "../../../../cli/commands/github/errors.js";
import { GITHUB_LABEL_FLAG_NAMES, parseGithubLabelArgs } from "../../../../cli/commands/github/labelCore.js";
import { GITHUB_LAP_FLAG_NAMES, parseGithubLapArgs } from "../../../../cli/commands/github/lapCore.js";
import { GITHUB_LAP_SEAT_FLAG_NAMES, parseGithubLapSeatArgs } from "../../../../cli/commands/github/lapSeatRun.js";
import {
  GITHUB_PR_REVIEW_PREPARE_FLAG_NAMES,
  GITHUB_PR_REVIEW_RECORD_FLAG_NAMES,
  parseGithubPrReviewPrepareArgs,
  parseGithubPrReviewRecordArgs,
} from "../../../../cli/commands/github/prDescriptionReviewCore.js";
import {
  GITHUB_PR_REVIEWERS_FLAG_NAMES,
  parseGithubPrReviewersArgs,
} from "../../../../cli/commands/github/prReviewersCore.js";
import {
  GITHUB_PR_STANDING_FLAG_NAMES,
  parseGithubPrStandingArgs,
} from "../../../../cli/commands/github/prStandingCore.js";
import {
  GITHUB_PR_SUMMARY_FLAG_NAMES,
  parseGithubPrSummaryArgs,
} from "../../../../cli/commands/github/prSummaryCore.js";
import { GITHUB_READY_FLAG_NAMES, parseGithubReadyArgs } from "../../../../cli/commands/github/readyCore.js";
import {
  GITHUB_PR_RELEASE_RESERVATION_FLAG_NAMES,
  parseGithubPrReleaseReservationArgs,
} from "../../../../cli/commands/github/releaseReservationCore.js";
import {
  GITHUB_PR_REQUEST_REVIEW_FLAG_NAMES,
  parseGithubPrRequestReviewArgs,
} from "../../../../cli/commands/github/requestReviewCore.js";
import {
  GITHUB_PR_RETARGET_FLAG_NAMES,
  parseGithubPrRetargetArgs,
} from "../../../../cli/commands/github/retargetCore.js";
import { GITHUB_SEARCH_FLAG_NAMES, parseGithubSearchArgs } from "../../../../cli/commands/github/searchCore.js";
import { GITHUB_THREAD_FLAG_NAMES, parseGithubThreadArgs } from "../../../../cli/commands/github/threadCore.js";
import { PROVIDER_READ_FLAG_NAMES, parseProviderReadArgs } from "../../../../cli/commands/providerRead/core.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/**
 * A valid `github attach upload` invocation, so each upload flag's probe only needs to add itself.
 *
 * `upload` requires four flags at once, so a single-flag probe of `--alt` alone would fail on `--file`
 * being absent rather than on `--alt` — the same false negative `GITHUB_MERGE_BASE_PROBE` exists to remove.
 */
const GITHUB_ATTACH_UPLOAD_PROBE: readonly string[] = [
  "upload",
  "--file",
  "/tmp/shot.png",
  "--repo",
  "owner/name",
  "--number",
  "1",
  "--proves",
  "the unit suite passes",
];

/** A valid `github pr review-prepare` invocation, so each optional flag's probe only needs to add itself. */
const REVIEW_PREPARE_PROBE: readonly string[] = [
  "review-prepare",
  "--repo",
  "owner/name",
  "--base",
  "main",
  "--title",
  "fix(outlook): keep the session after consent",
  "--body-file",
  "/tmp/body.md",
  "--comments",
  "/tmp/comments.json",
  "--new",
];

/** A valid `github thread` ADDRESS, so each answer flag's probe only needs to add itself. */
const THREAD_BASE_PROBE = ["--repo", "owner/name", "--number", "1", "--thread", "PRRT_1"] as const;

/** A valid `github comment create` invocation, so each flag's probe only needs to add itself. */
const GITHUB_COMMENT_CREATE_PROBE = ["--repo", "owner/name", "--number", "1", "--form", "-"] as const;

/** A valid `github comment edit` invocation, for the one flag `create` cannot probe. */
const GITHUB_COMMENT_EDIT_PROBE = ["--repo", "owner/name", "--comment-id", "1", "--form", "-"] as const;

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "github attach": GITHUB_ATTACH_FLAG_NAMES,
  "github close": GITHUB_CLOSE_FLAG_NAMES,
  "github comment": GITHUB_COMMENT_FLAG_NAMES,
  "github pr": [
    ...new Set([
      ...GITHUB_PR_FLAG_NAMES,
      ...GITHUB_PR_REQUEST_REVIEW_FLAG_NAMES,
      ...GITHUB_PR_RETARGET_FLAG_NAMES,
      ...GITHUB_PR_RELEASE_RESERVATION_FLAG_NAMES,
      ...GITHUB_PR_SUMMARY_FLAG_NAMES,
      ...GITHUB_PR_STANDING_FLAG_NAMES,
      ...GITHUB_PR_REVIEWERS_FLAG_NAMES,
      ...GITHUB_PR_REVIEW_PREPARE_FLAG_NAMES,
      ...GITHUB_PR_REVIEW_RECORD_FLAG_NAMES,
    ]),
  ],
  "github label": GITHUB_LABEL_FLAG_NAMES,
  "github lap": GITHUB_LAP_FLAG_NAMES,
  "github lap-seat": GITHUB_LAP_SEAT_FLAG_NAMES,
  "github read": PROVIDER_READ_FLAG_NAMES["github"],
  "github ready": GITHUB_READY_FLAG_NAMES,
  "github search": GITHUB_SEARCH_FLAG_NAMES,
  "github thread": GITHUB_THREAD_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "github attach": {
    // Four words, because a shorter reason is refused at parse time — the hatch waives nothing without one.
    "--acknowledge": [...GITHUB_ATTACH_UPLOAD_PROBE, "--acknowledge", "vanta has no doorless surface"],
    "--alt": [...GITHUB_ATTACH_UPLOAD_PROBE, "--alt", "before and after"],
    "--dry-run": [...GITHUB_ATTACH_UPLOAD_PROBE, "--dry-run"],
    "--file": GITHUB_ATTACH_UPLOAD_PROBE,
    "--home": ["status", "--home", "/tmp"],
    "--json": ["status", "--json"],
    "--number": GITHUB_ATTACH_UPLOAD_PROBE,
    // `status`, not `upload`: the org an upload authorises comes from `--repo`, so `--org` is refused there
    // by name rather than silently ignored.
    "--org": ["status", "--org", "acme"],
    "--proves": GITHUB_ATTACH_UPLOAD_PROBE,
    "--repo": GITHUB_ATTACH_UPLOAD_PROBE,
  },
  "github pr": {
    "--adopt": ["retarget", "--repo", "owner/name", "--number", "1", "--base", "lower", "--adopt"],
    "--apply": ["reviewers", "https://github.com/owner/name/pull/1", "--apply"],
    "--base-ref": [...REVIEW_PREPARE_PROBE, "--base-ref", "upstream/main"],
    "--body-file": REVIEW_PREPARE_PROBE,
    "--branch": [...REVIEW_PREPARE_PROBE, "--branch", "a-branch"],
    "--comments": REVIEW_PREPARE_PROBE,
    "--new": REVIEW_PREPARE_PROBE,
    "--cwd": [...REVIEW_PREPARE_PROBE, "--cwd", "/tmp"],
    "--evidence": [...REVIEW_PREPARE_PROBE, "--evidence", "/tmp/a.md,/tmp/b.md"],
    "--images": [...REVIEW_PREPARE_PROBE, "--images", "/tmp/images.json"],
    "--review": ["review-record", "--review", "pass-1"],
    "--title": REVIEW_PREPARE_PROBE,
    "--base": ["update", "--edit", "{}", "--repo", "owner/name", "--base", "main", "--head", "a-branch"],
    "--convert-c3": ["update", "--pull", "--convert-c3", "--repo", "owner/name", "--number", "1"],
    "--dry-run": ["update", "--edit", "{}", "--repo", "owner/name", "--number", "1", "--dry-run"],
    "--edit": ["update", "--edit", "{}", "--repo", "owner/name", "--number", "1"],
    "--expect-head": [
      "update",
      "--edit",
      "{}",
      "--repo",
      "owner/name",
      "--number",
      "1",
      "--expect-head",
      "a".repeat(40),
    ],
    "--file": ["update", "--file", "/tmp/pr.md", "--repo", "owner/name", "--number", "1"],
    "--form": ["update", "--form", "-", "--repo", "owner/name", "--number", "1"],
    "--head": ["update", "--edit", "{}", "--repo", "owner/name", "--base", "main", "--head", "a-branch"],
    "--home": ["update", "--edit", "{}", "--repo", "owner/name", "--number", "1", "--home", "/tmp"],
    "--json": ["update", "--edit", "{}", "--repo", "owner/name", "--number", "1", "--json"],
    "--number": ["update", "--edit", "{}", "--repo", "owner/name", "--number", "1"],
    "--out": ["update", "--pull", "--out", "/tmp/pulled.md", "--repo", "owner/name", "--number", "1"],
    "--pick": ["reviewers", "https://github.com/owner/name/pull/1", "--pick", "@org/team=@colleague"],
    "--pull": ["update", "--pull", "--repo", "owner/name", "--number", "1"],
    "--repo": ["update", "--edit", "{}", "--repo", "owner/name", "--number", "1"],
    "--reviewer": ["request-review", "--repo", "owner/name", "--number", "1", "--reviewer", "colleague"],
    "--self-review": ["update", "--self-review", "-", "--repo", "owner/name", "--number", "1"],
    "--team": ["request-review", "--repo", "owner/name", "--number", "1", "--team", "reviewers-team"],
  },
  "github read": {
    "--files": ["--files"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--media-out": ["--media-out", "/tmp"],
  },
  "github close": {
    "--dry-run": ["--repo", "owner/name", "--number", "1", "--dry-run"],
    "--expect-head": [
      "--repo",
      "owner/name",
      "--number",
      "1",
      "--expect-head",
      "0123456789abcdef0123456789abcdef01234567",
    ],
    "--home": ["--repo", "owner/name", "--number", "1", "--home", "/tmp"],
    "--json": ["--repo", "owner/name", "--number", "1", "--json"],
    "--number": ["--repo", "owner/name", "--number", "1"],
    "--repo": ["--repo", "owner/name", "--number", "1"],
    "--why": ["--repo", "owner/name", "--number", "1", "--why", "superseded"],
  },
  "github comment": {
    "--comment-id": ["edit", ...GITHUB_COMMENT_EDIT_PROBE],
    "--dry-run": ["create", ...GITHUB_COMMENT_CREATE_PROBE, "--dry-run"],
    "--form": ["create", ...GITHUB_COMMENT_CREATE_PROBE],
    "--home": ["create", ...GITHUB_COMMENT_CREATE_PROBE, "--home", "/tmp"],
    "--json": ["create", ...GITHUB_COMMENT_CREATE_PROBE, "--json"],
    "--number": ["create", ...GITHUB_COMMENT_CREATE_PROBE],
    "--repo": ["create", ...GITHUB_COMMENT_CREATE_PROBE],
  },
  "github label": {
    "--add": ["--repo", "owner/name", "--number", "1", "--add", "a-label"],
    "--dry-run": ["--repo", "owner/name", "--number", "1", "--add", "a-label", "--dry-run"],
    "--home": ["--repo", "owner/name", "--number", "1", "--add", "a-label", "--home", "/tmp"],
    "--json": ["--repo", "owner/name", "--number", "1", "--add", "a-label", "--json"],
    "--number": ["--repo", "owner/name", "--number", "1", "--add", "a-label"],
    "--repo": ["--repo", "owner/name", "--number", "1", "--add", "a-label"],
  },
  "github lap": {
    "--acknowledge": ["--repo", "owner/name", "--number", "1", "--land", "--acknowledge", "a", "--reason", "b"],
    "--codex-loop-incomplete": ["--repo", "owner/name", "--number", "1,2", "--land", "--codex-loop-incomplete", "2=b"],
    "--dry-run": ["--repo", "owner/name", "--number", "1", "--dry-run"],
    "--home": ["--repo", "owner/name", "--number", "1", "--home", "/tmp"],
    "--land": ["--repo", "owner/name", "--number", "1", "--land"],
    "--land-only": ["--repo", "owner/name", "--number", "1", "--land-only"],
    "--number": ["--repo", "owner/name", "--number", "1"],
    "--reason": ["--repo", "owner/name", "--number", "1", "--land", "--acknowledge", "a", "--reason", "b"],
    "--repo": ["--repo", "owner/name", "--number", "1"],
  },
  "github lap-seat": {
    "--home": ["show", "--home", "/tmp"],
  },
  "github ready": {
    "--dry-run": ["--repo", "owner/name", "--number", "1", "--dry-run"],
    "--home": ["--repo", "owner/name", "--number", "1", "--home", "/tmp"],
    "--json": ["--repo", "owner/name", "--number", "1", "--json"],
    "--number": ["--repo", "owner/name", "--number", "1"],
    "--repo": ["--repo", "owner/name", "--number", "1"],
    "--undo": ["--repo", "owner/name", "--number", "1", "--undo"],
  },
  "github search": {
    "--complete": ["--complete"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--repo": ["--repo", "owner/name"],
  },
  "github thread": {
    "--body": ["reply", ...THREAD_BASE_PROBE, "--body", "text"],
    "--dry-run": ["list", "--repo", "owner/name", "--number", "1", "--dry-run"],
    "--full": ["list", "--repo", "owner/name", "--number", "1", "--full"],
    "--home": ["list", "--repo", "owner/name", "--number", "1", "--home", "/tmp"],
    "--json": ["list", "--repo", "owner/name", "--number", "1", "--json"],
    "--number": ["list", "--repo", "owner/name", "--number", "1"],
    "--open": ["list", "--repo", "owner/name", "--number", "1", "--open"],
    "--repo": ["list", "--repo", "owner/name", "--number", "1"],
    "--resolve": ["reply", ...THREAD_BASE_PROBE, "--body", "text", "--resolve"],
    "--thread": ["resolve", ...THREAD_BASE_PROBE],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  // A fragment naming its own sub-verb passes through unchanged; anything else gets the upload baseline,
  // which is what the generic unknown-flag strictness probe needs.
  "github attach": ({ fragment }) => {
    const named = ["upload", "login", "import", "status"].includes(String(fragment[0]));
    const rest = named ? [...fragment] : [...GITHUB_ATTACH_UPLOAD_PROBE, ...fragment];
    return parseGithubAttachArgs({ rest }).mapErr((error) => githubVerbErrorLines({ error }));
  },
  "github close": ({ fragment }) => parseGithubCloseArgs({ rest: [...fragment] }),
  "github comment": ({ fragment }) =>
    parseGithubCommentArgs({ argv: [...fragment] }).mapErr((error) => githubVerbErrorLines({ error })),
  "github pr": ({ fragment }) => {
    if (fragment[0] === "request-review") {
      return parseGithubPrRequestReviewArgs({ rest: fragment.slice(1) });
    }
    if (fragment[0] === "retarget") {
      return parseGithubPrRetargetArgs({ rest: fragment.slice(1) });
    }
    if (fragment[0] === "release-reservation") {
      return parseGithubPrReleaseReservationArgs({ rest: fragment.slice(1) });
    }
    if (fragment[0] === "summary") {
      return parseGithubPrSummaryArgs({ rest: fragment.slice(1) });
    }
    if (fragment[0] === "standing") {
      return parseGithubPrStandingArgs({ rest: fragment.slice(1) });
    }
    if (fragment[0] === "reviewers") {
      return parseGithubPrReviewersArgs({ rest: fragment.slice(1) });
    }
    if (fragment[0] === "review-prepare") {
      return parseGithubPrReviewPrepareArgs({ rest: fragment.slice(1) }).mapErr((error) => [error.message]);
    }
    if (fragment[0] === "review-record") {
      return parseGithubPrReviewRecordArgs({ rest: fragment.slice(1) }).mapErr((error) => [error.message]);
    }
    // `create` is gone from this parser entirely — `github stack push` opens pull requests now — so every
    // probe fragment here names `update`, and an unnamed fragment gets a minimal valid update prefix.
    const named = fragment[0] === "update";
    return parseGithubPrArgs({
      argv: named ? [...fragment] : ["update", "--edit", "{}", "--repo", "owner/name", "--number", "1", ...fragment],
    }).mapErr((error) => githubVerbErrorLines({ error }));
  },
  "github read": ({ fragment }) =>
    // A pull request, so `--files` — which refuses an issue — is probed on the one kind it reads.
    parseProviderReadArgs({ provider: "github", rest: ["https://github.com/owner/repo/pull/1", ...fragment] }).mapErr(
      (error) => [error.message],
    ),
  "github label": ({ fragment }) => parseGithubLabelArgs({ rest: [...fragment] }),
  "github lap": ({ fragment }) => parseGithubLapArgs({ rest: [...fragment] }),
  "github lap-seat": ({ fragment }) =>
    parseGithubLapSeatArgs({ rest: [...fragment] }).mapErr((error) => [...error.lines]),
  "github ready": ({ fragment }) => parseGithubReadyArgs({ rest: [...fragment] }),
  "github search": ({ fragment }) =>
    parseGithubSearchArgs({ rest: ["a-term", ...fragment] }).mapErr((error) => githubVerbErrorLines({ error })),
  "github thread": ({ fragment }) =>
    parseGithubThreadArgs({ argv: [...fragment] }).mapErr((error) => githubVerbErrorLines({ error })),
};

/** The rows for `github`'s pull-request verbs. */
export const githubPullRequestsSlice: HelpTruthSlice = { guarded, probes, parsers };
