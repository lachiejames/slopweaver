/**
 * `slopweaver github reviewer list|pick|read|backfill` — the effectful shell: the last landing reading, the
 * reviewer register, the owner's profile, the identity roster, the one Slack read `read` checks its quote
 * against, and the two output channels. Everything decided is in `./reviewerArgs.ts` and `./reviewerCore.ts`;
 * `backfill`'s own shell is `./reviewerBackfillRun.ts`.
 *
 * `list` is a local join with no GitHub or Slack call, so the pull-request page can poll it. A register that
 * cannot be read is `EXIT_ERROR`, never an empty history: "you have asked nobody before" over an unreadable
 * file is the confident-but-wrong answer. No landing reading at all is `EXIT_EXPECTED_EMPTY`, a fact the page
 * shows. `pick` and `read` each write one row and send nothing; an approving `pick` also parks the ask to the
 * person it picked on the owner's queue, through `slack draft record`'s own path (`./reviewerAsk.ts`).
 */
import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import type { ReadingsError } from "../../../readings/errors.js";
import { lastReading } from "../../../readings/store.js";
import type { Reading } from "../../../readings/types.js";
import { reviewErrorLines } from "../../../review/errors.js";
import { reviewerReadingOf } from "../../../review/reviewerReading.js";
import type { ReviewerRegisterError, ReviewerRow } from "../../../review/reviewerRegister.js";
import {
  appendReviewerRows,
  type ReviewerAppendReceipt,
  readReviewerRegister,
} from "../../../review/reviewerRegisterStore.js";
import { liveReviewRoster } from "../../../review/storeReviewRoster.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { LANDING_PRODUCER } from "../reading/core.js";

import type { GithubVerbResult } from "./errors.js";
import {
  type GithubReviewerListArgs,
  type GithubReviewerPickArgs,
  type GithubReviewerReadArgs,
  parseGithubReviewerArgs,
} from "./reviewerArgs.js";
import {
  approveReceiptOf,
  askFor,
  productionReviewerAskDeps,
  type ReviewerAskDeps,
  reviewerExcludedIds,
  reviewerHomeOf,
} from "./reviewerAsk.js";
import { productionBackfillDeps, type ReviewerBackfillDeps, runBackfill } from "./reviewerBackfillRun.js";
import {
  pickRowOf,
  pickTargetOf,
  type ReadMessage,
  readRowOf,
  renderReviewerList,
  reviewerListOf,
} from "./reviewerCore.js";
import type { GithubReviewerError } from "./reviewerErrors.js";
import { readReviewerMessage } from "./reviewerSlackRead.js";
import { githubReviewerUsage } from "./reviewerUsage.js";

/** argv positions before this verb's own arguments: `node`, `index.js`, `github`, `reviewer`. */
const VERB_ARG_OFFSET = 4;

/**
 * The lines a {@link GithubReviewerError} prints: a usage refusal gives each of its problems its own line, as
 * the list it replaced did; every other refusal is its one message.
 *
 * @returns one line per problem, in the order they were found
 */
export function githubReviewerErrorLines({ error }: { error: GithubReviewerError }): readonly string[] {
  if (error.code === "USAGE") {
    return error.reasons;
  }
  return [error.message];
}

/** Everything `github reviewer` touches outside itself, injected so a test drives the whole verb. */
export interface GithubReviewerDeps extends ReviewerAskDeps {
  readonly lastLanding: (args: { home: string | undefined }) => Result<Reading, ReadingsError>;
  readonly readRegister: (args: { home: string | undefined }) => Result<readonly ReviewerRow[], ReviewerRegisterError>;
  readonly appendRows: (args: {
    home: string | undefined;
    rows: readonly ReviewerRow[];
    nowIso: string;
  }) => Result<ReviewerAppendReceipt, ReviewerRegisterError>;
  /**
   * Slack id → every id of the same person, from the roster — read when the list is made, because the people
   * a suggestion must leave out are mostly people the reading never joined (a reviewer is rarely an author).
   */
  readonly samePerson: (args: {
    home: string | undefined;
  }) => Promise<Result<ReadonlyMap<string, readonly string[]>, IdentityRosterError>>;
  /** The Slack ids never suggested or picked: the owner and the owner's bot, from the profile. */
  readonly excludedIds: (args: { home: string | undefined }) => ReadonlySet<string>;
  /** `read`'s one Slack read: the message a permalink names and the rest of its thread, through the door. */
  readonly readMessage: (args: {
    home: string | undefined;
    permalink: string;
  }) => Promise<GithubVerbResult<ReadMessage>>;
  /** The corpus, roster and GitHub seams only `backfill` reaches. */
  readonly backfill: ReviewerBackfillDeps;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The last landing reading, parsed — or the exit code that says why there is none.
 *
 * @returns the reading and its ledger row, or the exit code already reported
 */
function readingOrExit({
  deps,
  home,
}: {
  deps: GithubReviewerDeps;
  home: string | undefined;
}):
  | { readonly kind: "read"; readonly reading: ReturnType<typeof reviewerReadingOf>; readonly raw: Reading }
  | { readonly kind: "exit"; readonly code: number } {
  const last = deps.lastLanding({ home });
  if (last.isErr()) {
    deps.writeDiagnostic(`github reviewer: ${last.error.message}`);
    if (last.error.code === "NO_READING") {
      return { code: EXIT_EXPECTED_EMPTY, kind: "exit" };
    }
    return { code: EXIT_ERROR, kind: "exit" };
  }
  return { kind: "read", raw: last.value, reading: reviewerReadingOf({ document: last.value.document }) };
}

/**
 * `list`: join the last reading with the register.
 *
 * @returns the exit code
 */
async function runList({ args, deps }: { args: GithubReviewerListArgs; deps: GithubReviewerDeps }): Promise<number> {
  const read = readingOrExit({ deps, home: args.home });
  if (read.kind === "exit") {
    return read.code;
  }
  if (read.reading.isErr()) {
    deps.writeDiagnostic(`github reviewer: ${reviewErrorLines({ error: read.reading.error }).join("; ")}`);
    return EXIT_ERROR;
  }
  const register = deps.readRegister({ home: args.home });
  if (register.isErr()) {
    deps.writeDiagnostic(`github reviewer: ${register.error.message}`);
    return EXIT_ERROR;
  }
  const samePerson = await deps.samePerson({ home: args.home });
  if (samePerson.isErr()) {
    deps.writeDiagnostic(`github reviewer: ${samePerson.error.message}`);
    return EXIT_ERROR;
  }
  const document = reviewerListOf({
    excluded: deps.excludedIds({ home: args.home }),
    nowIso: deps.now(),
    reading: read.reading.value,
    readingId: read.raw.record.readingId,
    readingObservedAtIso: read.raw.record.observedAtIso,
    register: register.value,
    samePerson: samePerson.value,
  });
  if (args.json) {
    deps.writeOut(safeJsonStringify({ label: "the reviewer list", value: document }));
    return EXIT_OK;
  }
  for (const line of renderReviewerList({ document })) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/**
 * `pick`: record one verdict on one suggested reviewer. An approve then parks the ask to that person on the owner's
 * queue — or finds the one already there — and sends nothing.
 *
 * @returns the exit code
 */
async function runPick({ args, deps }: { args: GithubReviewerPickArgs; deps: GithubReviewerDeps }): Promise<number> {
  if (deps.excludedIds({ home: args.home }).has(args.reviewer)) {
    deps.writeDiagnostic(`github reviewer: ${args.reviewer} is you or your bot — never a reviewer`);
    return EXIT_USAGE;
  }
  const read = readingOrExit({ deps, home: args.home });
  if (read.kind === "exit") {
    return read.code;
  }
  if (read.reading.isErr()) {
    deps.writeDiagnostic(`github reviewer: ${reviewErrorLines({ error: read.reading.error }).join("; ")}`);
    return EXIT_ERROR;
  }
  const target = pickTargetOf({ number: args.number, reading: read.reading.value, repo: args.repo });
  if (target.isErr()) {
    deps.writeDiagnostic(`github reviewer: ${target.error.message}`);
    return EXIT_USAGE;
  }
  const nowIso = deps.now();
  const row = pickRowOf({ args, nowIso, row: target.value });
  const written = deps.appendRows({ home: args.home, nowIso, rows: [row] });
  if (written.isErr()) {
    deps.writeDiagnostic(`github reviewer: ${written.error.message}`);
    return EXIT_ERROR;
  }
  if (row.verdict === "decline") {
    if (args.json) {
      deps.writeOut(
        safeJsonStringify({
          label: "a reviewer pick receipt",
          value: { path: written.value.path, recorded: true, row, sent: false },
        }),
      );
      return EXIT_OK;
    }
    deps.writeOut(
      `github reviewer: recorded decline of ${row.reviewer} for ${row.prKey}. Nothing was sent, and they are not ` +
        "suggested on it again.",
    );
    return EXIT_OK;
  }
  const asked = await askFor({
    deps,
    home: args.home,
    people: read.reading.value.people,
    reviewer: args.reviewer,
    row: target.value,
  });
  const receipt = approveReceiptOf({ asked, json: args.json, path: written.value.path, row });
  for (const line of receipt.diagnostics) {
    deps.writeDiagnostic(line);
  }
  for (const line of receipt.out) {
    deps.writeOut(line);
  }
  return receipt.code;
}

/**
 * `read`: record one visible session's reading of one message on one pull request. Sends nothing.
 *
 * @returns the exit code
 */
async function runRead({ args, deps }: { args: GithubReviewerReadArgs; deps: GithubReviewerDeps }): Promise<number> {
  const excluded = deps.excludedIds({ home: args.home });
  const self = args.recipients.find((id) => excluded.has(id));
  if (self !== undefined) {
    deps.writeDiagnostic(`github reviewer: ${self} is you or your bot — never who you asked`);
    return EXIT_USAGE;
  }
  const read = readingOrExit({ deps, home: args.home });
  if (read.kind === "exit") {
    return read.code;
  }
  if (read.reading.isErr()) {
    deps.writeDiagnostic(`github reviewer: ${reviewErrorLines({ error: read.reading.error }).join("; ")}`);
    return EXIT_ERROR;
  }
  const target = pickTargetOf({ number: args.number, reading: read.reading.value, repo: args.repo });
  if (target.isErr()) {
    deps.writeDiagnostic(`github reviewer: ${target.error.message}`);
    return EXIT_USAGE;
  }
  const message = await deps.readMessage({ home: args.home, permalink: args.permalink });
  if (message.isErr()) {
    deps.writeDiagnostic(`github reviewer: ${message.error.message}`);
    return EXIT_ERROR;
  }
  const nowIso = deps.now();
  const row = readRowOf({ args, message: message.value, nowIso, row: target.value });
  if (row.isErr()) {
    deps.writeDiagnostic(`github reviewer: ${row.error.message}`);
    return EXIT_USAGE;
  }
  const written = deps.appendRows({ home: args.home, nowIso, rows: [row.value] });
  if (written.isErr()) {
    deps.writeDiagnostic(`github reviewer: ${written.error.message}`);
    return EXIT_ERROR;
  }
  if (args.json) {
    deps.writeOut(
      safeJsonStringify({
        label: "a reviewer read receipt",
        value: { path: written.value.path, recorded: true, row: row.value, sent: false },
      }),
    );
    return EXIT_OK;
  }
  let said = "not an ask";
  if (row.value.verdict === "ask") {
    said = `an ask of ${row.value.recipients.join(", ")}`;
  }
  deps.writeOut(
    `github reviewer: recorded ${row.value.messageKey} as ${said} on ${row.value.prKey}. Nothing was sent — the ` +
      "next github landing reading carries it.",
  );
  return EXIT_OK;
}

/**
 * Run `github reviewer` against injected seams.
 *
 * @param rest the argv tail after `github reviewer`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runGithubReviewer({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubReviewerDeps;
}): number | Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(githubReviewerUsage());
    return EXIT_OK;
  }
  const parsed = parseGithubReviewerArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of githubReviewerErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(githubReviewerUsage());
    return EXIT_USAGE;
  }
  if (parsed.value.verb === "list") {
    return runList({ args: parsed.value, deps });
  }
  if (parsed.value.verb === "pick") {
    return runPick({ args: parsed.value, deps });
  }
  if (parsed.value.verb === "backfill") {
    return runBackfill({ args: parsed.value, deps });
  }
  return runRead({ args: parsed.value, deps });
}

/**
 * The real seams.
 *
 * @returns the production dependencies for {@link runGithubReviewer}
 */
export function productionGithubReviewerDeps(): GithubReviewerDeps {
  return {
    ...productionReviewerAskDeps(),
    appendRows: ({ home, rows, nowIso }) =>
      appendReviewerRows({ nowIso, rows, ...(home === undefined ? {} : { home }) }),
    backfill: productionBackfillDeps(),
    excludedIds: reviewerExcludedIds,
    lastLanding: ({ home }) => lastReading({ producer: LANDING_PRODUCER, ...(home === undefined ? {} : { home }) }),
    now: () => new Date().toISOString(),
    readMessage: readReviewerMessage,
    readRegister: ({ home }) => readReviewerRegister(home === undefined ? {} : { home }),
    rosterNames: async ({ home }) =>
      (await liveReviewRoster({ home: reviewerHomeOf({ home }) })).map((roster) => roster.nameForSlackId),
    samePerson: async ({ home }) =>
      (await liveReviewRoster({ home: reviewerHomeOf({ home }) })).map((roster) => roster.samePersonForSlackId),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver github reviewer`. */
export const githubReviewerCommand = defineCommand({
  run: (argv) => runGithubReviewer({ deps: productionGithubReviewerDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
