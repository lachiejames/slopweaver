/**
 * The edges `github review-draft` touches, and the reads every sub-command shares: the register, the token, and
 * the pull request as GitHub holds it now. `./reviewDraftRun.ts` builds the production set; a test passes fakes.
 */
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { acquireOperationLock } from "../../../admit/operationLock.js";
import type { PrRef, PullRequestDiffFile } from "../../../corpus/github/write.js";
import type { ReviewTarget } from "../../../corpus/github/writeReviewDraft.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  foldReviewDrafts,
  parseReviewDraftLog,
  type ReviewDraftEvent,
  type ReviewDraftItem,
  reviewDraftById,
  skippedReviewDraftNote,
} from "../../../outbound/github/reviewDraft.js";
import type { GithubReviewDraftApi } from "../../../outbound/github/reviewDraftApi.js";
import type { ReviewDraftError } from "../../../outbound/github/reviewDraftErrors.js";
import type { readExactVoiceRules } from "../../../profileStore.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../exitCodes.js";

/** The console page a parked review's card is drawn on. */
const CONSOLE_QUEUE_PATH = "/queue";

/** The one lock every write to the review-draft register holds. */
export const REVIEW_DRAFT_LOCK_KEY = "github-review-drafts";

/** Every edge the verb touches, injectable so a test drives the whole verb with plain fakes. */
export interface GithubReviewDraftDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubReviewDraftApi;
  readonly readStdin: () => Promise<string>;
  readonly exactVoiceRules: (args: { home: string }) => ReturnType<typeof readExactVoiceRules>;
  readonly nowIso: () => string;
  readonly mintId: () => string;
  readonly appendEvent: (args: { event: ReviewDraftEvent; home: string }) => Result<true, ReviewDraftError>;
  readonly readLog: (args: { home: string }) => Result<readonly string[], ReviewDraftError>;
  readonly doorEnv: () => Readonly<Record<string, string | undefined>>;
  readonly consoleBase: () => string;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Print every line as a diagnostic.
 *
 * @param deps the injected world
 * @param lines the lines to print
 */
export function diagnose({ deps, lines }: { deps: GithubReviewDraftDeps; lines: readonly string[] }): void {
  for (const line of lines) {
    deps.writeDiagnostic(line);
  }
}

/**
 * The console link that opens one draft's card.
 *
 * @param deps the injected world
 * @param id the draft
 * @returns the URL
 */
export function reviewDraftConsoleUrl({ deps, id }: { deps: GithubReviewDraftDeps; id: string }): string {
  return `${deps.consoleBase()}${CONSOLE_QUEUE_PATH}?open=review%3A${encodeURIComponent(id)}`;
}

/** The register folded, and how many of its lines did not read. */
interface FoldedRegister {
  readonly items: readonly ReviewDraftItem[];
  readonly skipped: number;
}

/** Read and fold the register, saying aloud any line it passed over. */
function foldedRegister({ deps, home }: { deps: GithubReviewDraftDeps; home: string }): Result<FoldedRegister> {
  const lines = deps.readLog({ home });
  if (lines.isErr()) {
    return err([lines.error.message]);
  }
  const log = parseReviewDraftLog({ lines: lines.value });
  const note = skippedReviewDraftNote({ skipped: log.skipped });
  if (note !== undefined) {
    deps.writeDiagnostic(note);
  }
  return ok({ items: foldReviewDrafts({ events: log.events }), skipped: log.skipped });
}

/**
 * The register's rows, saying aloud any line it passed over.
 *
 * @param deps the injected world
 * @param home the state home
 * @returns the folded rows, or why the register could not be read
 */
export function loadReviewDrafts({
  deps,
  home,
}: {
  deps: GithubReviewDraftDeps;
  home: string;
}): Result<readonly ReviewDraftItem[]> {
  return foldedRegister({ deps, home }).map((register) => register.items);
}

/**
 * The one row an id names. A post or drop refuses a register with an unreadable line, since that line could be the
 * `posted` that already spent this row.
 *
 * @param deps the injected world
 * @param home the state home
 * @param id the draft
 * @param mustBeHeld whether a posted or dropped row is refused
 * @returns the row, or the exit code once its refusal is printed
 */
export function reviewDraftFor({
  deps,
  home,
  id,
  mustBeHeld,
}: {
  deps: GithubReviewDraftDeps;
  home: string;
  id: string;
  mustBeHeld: boolean;
}): Result<ReviewDraftItem, number> {
  const register = foldedRegister({ deps, home });
  if (register.isErr()) {
    diagnose({ deps, lines: register.error });
    return err(EXIT_ERROR);
  }
  if (mustBeHeld && register.value.skipped > 0) {
    deps.writeDiagnostic(
      `refused: a register line did not read, and it may record ${id} as already posted or dropped. Nothing was changed.`,
    );
    return err(EXIT_ERROR);
  }
  const found = reviewDraftById({ id, items: register.value.items, mustBeHeld });
  if (found.isErr()) {
    deps.writeDiagnostic(found.error.message);
    return err(EXIT_EXPECTED_EMPTY);
  }
  return ok(found.value);
}

/**
 * The GitHub surface, or the exit code once a missing token is said.
 *
 * @param deps the injected world
 * @param home the state home
 * @returns the API, or the exit code
 */
export function reviewDraftApiFor({
  deps,
  home,
}: {
  deps: GithubReviewDraftDeps;
  home: string;
}): Result<GithubReviewDraftApi, number> {
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
    return err(EXIT_ERROR);
  }
  return ok(deps.makeApi({ home, token }));
}

/**
 * Run `body` holding the register's lock. A `post`, `drop` or `record` then checks the register and appends to it
 * in one step: two overlapping posts of one row would otherwise both read it held, and both send.
 *
 * The lock is never taken over by age, only from a holder that has died. A post stalled on a slow GitHub answer
 * is still mid-send, and a second post that took its lock would send again.
 *
 * @param deps the injected world
 * @param home the state home the lock lives under
 * @param body the check and the write it guards
 * @returns what `body` returned, or the exit code once a held lock is said
 */
export async function withReviewDraftLock({
  deps,
  home,
  body,
}: {
  deps: GithubReviewDraftDeps;
  home: string;
  body: () => Promise<number>;
}): Promise<number> {
  const lock = acquireOperationLock({
    home,
    key: REVIEW_DRAFT_LOCK_KEY,
    nowIso: deps.nowIso(),
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
  if (lock.isErr()) {
    deps.writeDiagnostic(`${lock.error}. Another review-draft write is running; nothing was changed.`);
    return EXIT_ERROR;
  }
  try {
    return await body();
  } finally {
    lock.value.release();
  }
}

/** The pull request as GitHub holds it now: itself, the token's own account, and its patches. */
export interface PullRequestNow {
  readonly target: ReviewTarget;
  readonly viewerId: number;
  readonly files: readonly PullRequestDiffFile[];
}

/**
 * Read the pull request, the viewer and the diff — what both `record` and `post` judge a review against.
 *
 * @param api the GitHub surface
 * @param ref the pull request
 * @returns the reading, or GitHub's failure in words
 */
export async function readPullRequestNow({
  api,
  ref,
}: {
  api: GithubReviewDraftApi;
  ref: PrRef;
}): Promise<Result<PullRequestNow, string>> {
  const read = await api
    .target(ref)
    .andThen((target) =>
      api.viewerId().andThen((viewerId) => api.diffFiles(ref).map((files) => ({ files, target, viewerId }))),
    );
  return read.isErr() ? err(read.error.message) : ok(read.value);
}
