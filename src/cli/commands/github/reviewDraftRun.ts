/**
 * `slopweaver github review-draft` — the effectful shell over `./reviewDraftCore.ts` and `./reviewDraftReport.ts`.
 *
 * `record` (`./reviewDraftRecord.ts`), `list`, `show` and `drop` send nothing. `post` (`./reviewDraftPost.ts`) sends
 * one review through the door, and only with the owner's approval digest.
 */

import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { appendReviewDraftEvent, mintReviewDraftId, readReviewDraftLines } from "../../../admit/reviewDraftStore.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { CONSOLE_URL_ENV, consoleBaseFrom } from "../../../hand/consoleLink.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import { makeGithubReviewDraftApi } from "../../../outbound/github/reviewDraftApi.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { readExactVoiceRules } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { githubVerbErrorLines } from "./errors.js";
import {
  parseReviewDraftArgs,
  type ReviewDraftDropOptions,
  type ReviewDraftListOptions,
  type ReviewDraftShowOptions,
} from "./reviewDraftCore.js";
import {
  diagnose,
  type GithubReviewDraftDeps,
  loadReviewDrafts,
  reviewDraftConsoleUrl,
  reviewDraftFor,
  withReviewDraftLock,
} from "./reviewDraftDeps.js";
import { runReviewDraftPost } from "./reviewDraftPost.js";
import { runReviewDraftRecord } from "./reviewDraftRecord.js";
import { reviewDraftListDocument, reviewDraftListLines, reviewDraftShowLines } from "./reviewDraftReport.js";
import { githubReviewDraftUsage } from "./reviewDraftUsage.js";

/** Where the verb's own arguments start: `[node, script, github, review-draft, …]`. */
const VERB_ARG_OFFSET = 4;

/** `list` — the register, no GitHub call. */
function runList({ deps, options }: { deps: GithubReviewDraftDeps; options: ReviewDraftListOptions }): number {
  const items = loadReviewDrafts({ deps, home: options.home });
  if (items.isErr()) {
    diagnose({ deps, lines: items.error });
    return EXIT_ERROR;
  }
  if (options.json) {
    deps.out(JSON.stringify(reviewDraftListDocument({ items: items.value }), null, 2));
    return EXIT_OK;
  }
  for (const line of reviewDraftListLines({ items: items.value, showResolved: options.all })) {
    deps.out(line);
  }
  return EXIT_OK;
}

/** `show` — one review, whole. */
function runShow({ deps, options }: { deps: GithubReviewDraftDeps; options: ReviewDraftShowOptions }): number {
  const found = reviewDraftFor({ deps, home: options.home, id: options.id, mustBeHeld: false });
  if (found.isErr()) {
    return found.error;
  }
  if (options.json) {
    const [entry] = reviewDraftListDocument({ items: [found.value] }).items;
    deps.out(JSON.stringify({ consoleUrl: reviewDraftConsoleUrl({ deps, id: options.id }), ...entry }, null, 2));
    return EXIT_OK;
  }
  for (const line of reviewDraftShowLines({ item: found.value })) {
    deps.out(line);
  }
  return EXIT_OK;
}

/** `drop` — resolve a review without posting it, under the register's lock so it cannot cross a `post`. */
async function runDrop({
  deps,
  options,
}: {
  deps: GithubReviewDraftDeps;
  options: ReviewDraftDropOptions;
}): Promise<number> {
  return withReviewDraftLock({
    body: () => Promise.resolve(dropHeld({ deps, options })),
    deps,
    home: options.home,
  });
}

/** Check the row is still held and append its `dropped`. */
function dropHeld({ deps, options }: { deps: GithubReviewDraftDeps; options: ReviewDraftDropOptions }): number {
  const found = reviewDraftFor({ deps, home: options.home, id: options.id, mustBeHeld: true });
  if (found.isErr()) {
    return found.error;
  }
  const appended = deps.appendEvent({
    event: { id: options.id, kind: "dropped", note: options.note, tsIso: deps.nowIso() },
    home: options.home,
  });
  if (appended.isErr()) {
    deps.writeDiagnostic(`${appended.error.message} — the review draft is still HELD.`);
    return EXIT_ERROR;
  }
  deps.out(`dropped ${options.id}: ${options.note}`);
  return EXIT_OK;
}

/**
 * Run `github review-draft` against SUPPLIED dependencies.
 *
 * @param argv the full process argv
 * @param deps the injected world
 * @param defaultHome the home to use when `--home` is absent
 * @returns the process exit code
 */
export async function runGithubReviewDraft({
  argv,
  deps,
  defaultHome,
}: {
  argv: readonly string[];
  deps: GithubReviewDraftDeps;
  defaultHome: string;
}): Promise<number> {
  const parsed = parseReviewDraftArgs({ defaultHome, rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    diagnose({ deps, lines: [...githubVerbErrorLines({ error: parsed.error }), githubReviewDraftUsage()] });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  if (options.mode === "record") {
    return runReviewDraftRecord({ deps, options });
  }
  if (options.mode === "post") {
    return runReviewDraftPost({ deps, options });
  }
  if (options.mode === "show") {
    return runShow({ deps, options });
  }
  if (options.mode === "drop") {
    return runDrop({ deps, options });
  }
  return runList({ deps, options });
}

/**
 * Production seams.
 *
 * @returns the live token, write client, register, clock and output edges
 */
export function productionGithubReviewDraftDeps(): GithubReviewDraftDeps {
  return {
    appendEvent: ({ event, home }) => appendReviewDraftEvent({ event, home }),
    consoleBase: () => consoleBaseFrom({ configured: process.env[CONSOLE_URL_ENV] }),
    doorEnv: () => process.env,
    doorLedger: doorLedgerPort(),
    exactVoiceRules: ({ home }) => readExactVoiceRules({ home }),
    makeApi: ({ home, token }) => makeGithubReviewDraftApi({ privacy: githubWritePrivacy({ home }), token }),
    mintId: mintReviewDraftId,
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    readLog: ({ home }) => readReviewDraftLines({ home }),
    readStdin,
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github review-draft`. */
export const githubReviewDraftCommand = defineCommand({
  run: (argv) => runGithubReviewDraft({ argv, defaultHome: slopweaverHome(), deps: productionGithubReviewDraftDeps() }),
});
