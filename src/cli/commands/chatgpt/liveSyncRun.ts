/**
 * `slopweaver chatgpt live-sync` — every conversation on the owner's ChatGPT account held whole on this machine, then
 * refreshed into the corpus and the store. The first run is the full-history backfill and every later run is
 * incremental, and they are the SAME run: list the account, read whole each chat the live copy does not hold at its
 * listed update (`liveSyncPlan.ts`), newest first, and hold each one the moment it is read
 * (`corpus/chatgpt/liveSnapshotStore.ts`). Those two legs are `liveSyncFetch.ts`; what the run prints is
 * `liveSyncReport.ts`.
 *
 * **Gentle on the account, by construction.** One pacer (`pacer.ts`) spaces every request of the run, the listing's
 * and each chat's alike, at least three seconds apart and one at a time. The first refusal of any kind, a `429`, an
 * expired session, a Cloudflare challenge or a change of shape, stops every further request: nothing probes a limit.
 * The one retry is a LISTING page answered with a 5xx, three times after a growing wait (`liveSyncFetch.ts`), because
 * a gateway timeout there cost a whole listing's requests to repeat. A backfill of a couple of thousand chats is
 * therefore hours, not minutes, and that is the price chosen rather than a defect.
 *
 * **The listing is carried** (`liveSyncCarry.ts`): a completed walk's chats are held beside the snapshots, so the next
 * run lists only what moved since and a stopped backfill no longer pays the whole listing again to resume.
 *
 * **A stopped run loses nothing.** Each snapshot is written as its chat is read, so the next run's plan is exactly what
 * this one did not reach. The refresh leg runs whenever the live copy holds anything, after a stop too, so a run that
 * died before its refresh is caught up by the next one. That leg is `refresh --source chatgpt --store` through the
 * CLI's own router, in process, as `chatgpt sync` runs it (`exportRun.ts`).
 *
 * **One run at a time.** Two runs would read the same chats twice from the one account. The run holds an operation
 * lock (`admit/operationLock.ts`) for its whole length, and a second run meeting a live holder answers exit 4, not yet.
 *
 * **What it prints is counts and instants.** A chat's title is the owner's own words, and a terminal is somewhere
 * they paste from, so no title is printed and there is no `--json`: the refresh leg prints its own summary to stdout,
 * so the run has no single document to promise.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import { acquireOperationLockDetailed } from "../../../admit/operationLock.js";
import { writeLiveAsOf } from "../../../corpus/chatgpt/liveAsOf.js";
import { heldLiveManifests } from "../../../corpus/chatgpt/liveSnapshotStore.js";
import { slopweaverHome } from "../../../homeDir.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { main } from "../../main.js";
import { parseFlags } from "../../parseFlags.js";
import type { ChatgptError } from "./errors.js";
import { listChatgptInventory } from "./listing.js";
import { type FetchLegOutcome, fetchLeg, type LiveSyncFetchDeps, type LiveSyncFetchOptions } from "./liveSyncFetch.js";
import { reportFetchLeg } from "./liveSyncReport.js";
import { productionChatgptPacer } from "./pacer.js";
import type { ChatgptSessionHeaders } from "./paste.js";
import { readStoredSession } from "./session.js";
import { CHATGPT_LIVE_SYNC_USAGE } from "./usage.js";
import { type ChatgptWebDeps, productionChatgptWebDeps } from "./web.js";

/** Where a `chatgpt` verb's own arguments start: past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The per-lane listing bound when `--max-pages` is not passed: 14,000 chats in one lane. */
const DEFAULT_MAX_PAGES = 500;

/** The lock every run holds, one per home. */
const LIVE_SYNC_LOCK_KEY = "chatgpt-live-sync";

/**
 * A LIVE holder is never taken over, however long its run: a takeover is unfenced, so it would put two runs on the
 * one account at once. A dead holder's lock is taken over at any age (`admit/operationLockHeld.ts`'s `heldReason`).
 */
const LIVE_SYNC_LOCK_STALE_MS = Number.POSITIVE_INFINITY;

/** The options `chatgpt live-sync` takes. */
interface LiveSyncOptions extends LiveSyncFetchOptions {
  readonly home: string;
}

/**
 * A whole number of at least 1 from a flag's value. Pure.
 *
 * @param flag the flag's name, quoted in the refusal
 * @param raw the value as typed
 * @returns the number, or the refusal
 */
function positiveWhole({ flag, raw }: { flag: string; raw: string }): Result<number> {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    return err([`${flag} must be a whole number of at least 1, got ${raw}`]);
  }
  return ok(value);
}

/**
 * Parse `chatgpt live-sync`'s argv tail. Pure.
 *
 * @param rest the argv after the verb
 * @returns the options, or one sentence per refusal
 *
 * @internal
 */
export function parseLiveSyncArgs({ rest }: { rest: readonly string[] }): Result<LiveSyncOptions> {
  const parsed = parseFlags({
    args: rest,
    spec: { boolean: ["relist"], string: ["home", "max-conversations", "max-pages"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  let maxPages = DEFAULT_MAX_PAGES;
  const rawPages = values["max-pages"];
  if (typeof rawPages === "string") {
    const pages = positiveWhole({ flag: "--max-pages", raw: rawPages });
    if (pages.isErr()) {
      return err(pages.error);
    }
    maxPages = pages.value;
  }
  let maxConversations: number | undefined;
  const rawConversations = values["max-conversations"];
  if (typeof rawConversations === "string") {
    const conversations = positiveWhole({ flag: "--max-conversations", raw: rawConversations });
    if (conversations.isErr()) {
      return err(conversations.error);
    }
    maxConversations = conversations.value;
  }
  const home = values["home"];
  return ok({
    home: typeof home === "string" ? home : slopweaverHome(),
    maxConversations,
    maxPages,
    relist: values["relist"] === true,
  });
}

/** The edges `chatgpt live-sync` reads through: the listing and reading legs' own, plus the GET and the router. */
export interface ChatgptLiveSyncDeps extends LiveSyncFetchDeps {
  readonly web: ChatgptWebDeps;
  /** One CLI invocation through the router, in process — the refresh leg. */
  readonly runVerb: (argv: readonly string[]) => Promise<number>;
}

/**
 * The refresh leg: the live copy and every held export into the corpus and the store, through the router.
 *
 * @returns the exit code refresh answered
 */
async function refreshLeg({ deps, home }: { deps: ChatgptLiveSyncDeps; home: string }): Promise<number> {
  return deps.runVerb(["node", "slopweaver", "refresh", "--source", "chatgpt", "--store", "--home", home]);
}

/**
 * Run `chatgpt live-sync` against injected edges.
 *
 * @param rest the argv after the verb
 * @param deps the GET edge, the pacer, the clock, the listing walk and the in-process router
 * @returns 0 when every listed chat is held and refreshed; 3 when nothing was new and nothing is held; 4 while another
 *   run holds the lock; 1 when a request, a snapshot or the refresh failed
 */
export async function runChatgptLiveSync({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: ChatgptLiveSyncDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CHATGPT_LIVE_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseLiveSyncArgs({ rest });
  if (options.isErr()) {
    for (const line of [...options.error, CHATGPT_LIVE_SYNC_USAGE]) {
      logger.error({ msg: line });
    }
    return EXIT_USAGE;
  }
  const { home } = options.value;
  const session = readStoredSession({ home });
  if (session.isErr()) {
    logger.error({ msg: session.error.message });
    return EXIT_ERROR;
  }
  const lock = acquireOperationLockDetailed({
    home,
    key: LIVE_SYNC_LOCK_KEY,
    nowIso: deps.nowIso(),
    staleAfterMs: LIVE_SYNC_LOCK_STALE_MS,
  });
  if (lock.isErr()) {
    logger.error({ msg: `chatgpt live-sync: ${lock.error.message}` });
    return lock.error.code === "LOCK_CONTENDED" ? EXIT_DEFERRED : EXIT_ERROR;
  }
  try {
    return await lockedRun({ deps, home, options: options.value, session: session.value });
  } finally {
    lock.value.release();
  }
}

/**
 * Every chat the listing named is now held at its listed update and refreshed: certify the listing's start. A run cut
 * short by its bound, or one ChatGPT answered with a chat older than it listed, certifies nothing, so the previous
 * record stands and the freshness page ages.
 *
 * @returns false only when the certificate was due and could not be written, which it has logged
 */
function certifyWholeRun({
  outcome,
  listStartedIso,
  root,
}: {
  outcome: FetchLegOutcome;
  listStartedIso: string;
  root: string;
}): boolean {
  if (outcome.read + outcome.gone !== outcome.planned || outcome.behind !== 0) {
    return true;
  }
  const certified = writeLiveAsOf({ asOfIso: listStartedIso, root });
  if (certified.isErr()) {
    logger.error({ msg: certified.error.message });
    return false;
  }
  return true;
}

/** Everything after the lock is held: the listing and reading legs, the summary, then the refresh leg. */
async function lockedRun({
  deps,
  home,
  options,
  session,
}: {
  deps: ChatgptLiveSyncDeps;
  home: string;
  options: LiveSyncOptions;
  session: { readonly bearerExpiresIso: string | null; readonly headers: ChatgptSessionHeaders };
}): Promise<number> {
  const root = stateHomePaths({ home }).corpus.chatgptLive;
  const held = heldLiveManifests({ root });
  if (held.isErr()) {
    logger.error({ msg: held.error.message });
    return EXIT_ERROR;
  }
  const fetchText = ({ path }: { path: string }): Promise<Result<string, ChatgptError>> =>
    deps.web.fetchText({ headers: session.headers, path });
  // The only instant this run can certify: every chat the listing names existed by then (`corpus/chatgpt/liveAsOf.ts`).
  const listStartedIso = deps.nowIso();
  const outcome = await fetchLeg({ deps, fetchText, held: held.value, home, listStartedIso, options, root });
  reportFetchLeg({ bearerExpiresIso: session.bearerExpiresIso, outcome });
  if (held.value.size + outcome.read === 0) {
    return outcome.stoppedBy === undefined ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
  }
  const refreshed = await refreshLeg({ deps, home });
  if (refreshed !== EXIT_OK && refreshed !== EXIT_EXPECTED_EMPTY) {
    logger.error({ msg: `chatgpt live-sync: the refresh exited ${String(refreshed)}; the next run refreshes again` });
    return EXIT_ERROR;
  }
  if (outcome.stoppedBy !== undefined) {
    return EXIT_ERROR;
  }
  if (!certifyWholeRun({ listStartedIso, outcome, root })) {
    return EXIT_ERROR;
  }
  return outcome.read === 0 && refreshed === EXIT_EXPECTED_EMPTY ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** The production edges. */
function productionDeps(): ChatgptLiveSyncDeps {
  return {
    backoff: ({ ms }) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    listInventory: listChatgptInventory,
    nowIso: () => new Date().toISOString(),
    pacer: productionChatgptPacer(),
    runVerb: (argv) => main(argv),
    web: productionChatgptWebDeps(),
  };
}

/** `slopweaver chatgpt live-sync` — every chat on the account held whole, newest first, then refreshed. */
export const chatgptLiveSyncCommand = defineCommand({
  run: (argv) => runChatgptLiveSync({ deps: productionDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
