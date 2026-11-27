/**
 * The chair hand-off's journal on disk: one append-only `$SLOPWEAVER_HOME/supervisor/hand-offs/<episode>.jsonl` per
 * outgoing chair, the effectful half of `./chairHandOff.ts`.
 *
 * **Strict on the way in.** Every line decodes as one event or the whole read fails, naming the line: the journal is
 * what stops a resumed run seating a second successor, so a line skipped could be exactly the `successor-opening`
 * that would have sent it to reconcile.
 *
 * **No address on the way out.** Every append passes its event through `episodeEventWithoutAddresses`, so a reason
 * the owner typed or a note the outgoing chair wrote reaches the journal — and the note request and successor doc
 * rendered from it — with each account address replaced.
 *
 * **A conditional append is check-and-append under one short lock**, so the note verb and the waiting run cannot
 * both settle the note: whichever takes the lock first decides, and the other reads that decision.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { appendLines } from "#lib/appendSeparator.js";
import { err, ok, type Result } from "#lib/result.js";

import { acquireOperationLock } from "../admit/operationLock.js";
import { stateHomePaths } from "../stateHome.js";
import { runtimeLockDir } from "../stateRuntime.js";
import { type ChairHandOffEvent, episodeEventWithoutAddresses, episodeIdOf, episodeIsOpen } from "./chairHandOff.js";
import { type ChairHandOffError, ChairHandOffErrors } from "./chairHandOffErrors.js";

/** Owner-only, matching the session ledger. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const basis = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("auto") }),
  z.strictObject({ kind: z.literal("now"), reason: z.string().min(1) }),
]);

const eventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    alias: z.string().min(1),
    atIso: z.string(),
    basis,
    episodeId: z.string().min(1),
    kind: z.literal("started"),
    noteWaitSeconds: z.number().int().nonnegative(),
    planOverride: z
      .strictObject({ alias: z.string().min(1), reason: z.string().min(1), watchAlias: z.string().optional() })
      .optional(),
    predecessor: z.string().min(1),
    predecessorSlug: z.string().min(1),
    reasons: z.array(z.string()),
    vendor: z.enum(["claude", "codex"]),
  }),
  z.strictObject({ atIso: z.string(), deadlineIso: z.string(), kind: z.literal("note-asked"), notePath: z.string() }),
  z.strictObject({ atIso: z.string(), kind: z.literal("note-arrived"), note: z.string() }),
  z.strictObject({ atIso: z.string(), kind: z.literal("note-missing"), why: z.string() }),
  z.strictObject({ atIso: z.string(), kind: z.literal("stopped"), why: z.string() }),
  z.strictObject({ alreadyClosed: z.boolean(), atIso: z.string(), kind: z.literal("row-closed"), slug: z.string() }),
  z.strictObject({ atIso: z.string(), kind: z.literal("slug-reserved"), slug: z.string().min(1) }),
  z.strictObject({ atIso: z.string(), kind: z.literal("doc-written"), path: z.string(), slug: z.string() }),
  z.strictObject({ atIso: z.string(), kind: z.literal("successor-opening"), slug: z.string() }),
  z.strictObject({ atIso: z.string(), kind: z.literal("successor-opened"), sessionId: z.string(), slug: z.string() }),
  z.strictObject({ atIso: z.string(), kind: z.literal("failed"), resumable: z.boolean(), why: z.string() }),
]);

/** The directory every episode's journal and note file live in: `<home>/supervisor/hand-offs`. */
function chairHandOffDir({ home }: { home: string }): string {
  return stateHomePaths({ home }).supervisorHandOffs;
}

/** An episode id as a file name: everything outside a safe set becomes `-`. */
function fileStem({ episodeId }: { episodeId: string }): string {
  return episodeId.replaceAll(/[^A-Za-z0-9._-]/gu, "-");
}

/**
 * An episode's journal path.
 *
 * @param home the state home
 * @returns the `.jsonl` path
 */
export function episodeJournalPath({ home, episodeId }: { home: string; episodeId: string }): string {
  return join(chairHandOffDir({ home }), `${fileStem({ episodeId })}.jsonl`);
}

/**
 * Where the outgoing chair is asked to write its note.
 *
 * @param home the state home
 * @returns the `.note.md` path beside the journal
 */
export function episodeNotePath({ home, episodeId }: { home: string; episodeId: string }): string {
  return join(chairHandOffDir({ home }), `${fileStem({ episodeId })}.note.md`);
}

/** Whether a thrown read failed only because the file is not there. */
function absent({ cause }: { cause: unknown }): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

/**
 * Decode a journal's text, strictly.
 *
 * @param text the journal's contents
 * @param path the journal's path, for the error
 * @returns every event in file order, or the first line that does not decode
 */
export function decodeEpisodeJournal({
  text,
  path,
}: {
  text: string;
  path: string;
}): Result<readonly ChairHandOffEvent[], ChairHandOffError> {
  const events: ChairHandOffEvent[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (cause: unknown) {
      return err(ChairHandOffErrors.malformed({ line: index + 1, path, why: `not JSON: ${String(cause)}` }));
    }
    const decoded = eventSchema.safeParse(value);
    if (!decoded.success) {
      return err(ChairHandOffErrors.malformed({ line: index + 1, path, why: decoded.error.message }));
    }
    const event: ChairHandOffEvent = decoded.data;
    events.push(event);
  }
  return ok(events);
}

/**
 * An episode's journal, read strictly.
 *
 * @param home the state home
 * @returns its events, empty when it has none, or why it would not read
 */
export function readEpisode({
  home,
  episodeId,
}: {
  home: string;
  episodeId: string;
}): Result<readonly ChairHandOffEvent[], ChairHandOffError> {
  const path = episodeJournalPath({ episodeId, home });
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause: unknown) {
    if (absent({ cause })) {
      return ok([]);
    }
    return err(ChairHandOffErrors.io({ cause, path }));
  }
  return decodeEpisodeJournal({ path, text });
}

/**
 * Append one event to an episode's journal, creating its directory owner-only on the first.
 *
 * @param home the state home
 * @param event what is appended, as one JSON line
 * @returns nothing, or why it was not written
 */
export function appendEpisodeEvent({
  home,
  episodeId,
  event,
}: {
  home: string;
  episodeId: string;
  event: ChairHandOffEvent;
}): Result<void, ChairHandOffError> {
  const path = episodeJournalPath({ episodeId, home });
  try {
    mkdirSync(chairHandOffDir({ home }), { mode: DIR_MODE, recursive: true });
    const line = JSON.stringify(episodeEventWithoutAddresses({ event }));
    // Never through a link at the journal's own name, as the hold journal beside it refuses one too.
    appendLines({ mode: FILE_MODE, noFollow: true, path, text: `${line}\n` });
  } catch (cause: unknown) {
    return err(ChairHandOffErrors.io({ cause, path }));
  }
  return ok(undefined);
}

/**
 * Append one event only when the journal, read under the journal's own lock, does not refuse it.
 *
 * @param home the state home
 * @param event what is appended when the journal does not refuse it
 * @param refusal why the journal as it stands must not take the event, or undefined when it may
 * @param nowIso the instant of the attempt, for the lock
 * @returns the journal after the append, the refusal, or why it could not be read, locked or written
 */
export function appendEpisodeEventIf({
  home,
  episodeId,
  event,
  refusal,
  nowIso,
}: {
  home: string;
  episodeId: string;
  event: ChairHandOffEvent;
  refusal: (input: { events: readonly ChairHandOffEvent[] }) => string | undefined;
  nowIso: string;
}): Result<readonly ChairHandOffEvent[], ChairHandOffError> {
  const directory = runtimeLockDir({ home });
  if (directory.isErr()) {
    return err(ChairHandOffErrors.lockHeld({ detail: directory.error.message }));
  }
  const lock = acquireOperationLock({
    directory: directory.value,
    home,
    key: `chair-hand-off-journal:${episodeId}`,
    nowIso,
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
  if (lock.isErr()) {
    return err(ChairHandOffErrors.lockHeld({ detail: lock.error }));
  }
  try {
    const before = readEpisode({ episodeId, home });
    if (before.isErr()) {
      return err(before.error);
    }
    const why = refusal({ events: before.value });
    if (why !== undefined) {
      return err(ChairHandOffErrors.noteRefused({ why }));
    }
    const appended = appendEpisodeEvent({ episodeId, event, home });
    if (appended.isErr()) {
      return err(appended.error);
    }
    return ok([...before.value, episodeEventWithoutAddresses({ event })]);
  } finally {
    lock.value.release();
  }
}

/**
 * The open episode for one outgoing chair, when one is journalled: begun and neither seated nor abandoned.
 *
 * @param home the state home
 * @param predecessor the outgoing chair's app session id
 * @returns the episode and its events, undefined when none is open, or why the journal would not read
 */
export function findOpenEpisode({
  home,
  predecessor,
}: {
  home: string;
  predecessor: string;
}): Result<
  { readonly episodeId: string; readonly events: readonly ChairHandOffEvent[] } | undefined,
  ChairHandOffError
> {
  const episodeId = episodeIdOf({ appSessionId: predecessor });
  return readEpisode({ episodeId, home }).map((events) =>
    episodeIsOpen({ events }) ? { episodeId, events } : undefined,
  );
}
