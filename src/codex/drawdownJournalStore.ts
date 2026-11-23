/**
 * The Codex burn journal on disk, and the atomic episode claim that makes at most ONE automatic
 * investigation possible.
 *
 * ## The claim is a file create, not a journal read
 *
 * This is the one real mechanical difference from `src/claude/drawdownJournalStore.ts`, and it is the thing
 * the plan is most emphatic about. Suppression by "read the journal, look for an attempt row, append one"
 * is a read-then-append check: two foreground watches ticking in the same second both read a journal with no
 * attempt in it, both append one, and both spawn. Nothing in the sequence is wrong; the sequence is.
 *
 * So the claim is `open(path, "wx")` — create-if-absent, fail if present — which the operating system
 * settles for both processes with no cooperation between them. One gets the file, the other gets `EEXIST`.
 *
 * What that buys and what it does not, stated rather than assumed:
 *
 *  - it guarantees **at most one automatic ATTEMPT**, never exactly one successfully opened workspace. A
 *    process can take the claim and then die, or spawn and have the spawn fail. Both leave the claim taken,
 *    which is correct: a failed spawn is not a reason to try again automatically.
 *  - an **unreadable** claim is a FAILURE, never an absent one. A claim directory that cannot be read means
 *    the suppression state is unknown, and treating unknown as "nothing claimed" is how one anomaly opens a
 *    workspace on every tick.
 *  - the claim **survives a crash**, deliberately. Clearing a stale one is a human act, and no verb does it:
 *    find the file under `$SLOPWEAVER_HOME/codex-burn/claims/` whose contents carry that `episodeId` (the
 *    filename is a lossy encoding, see `claimFileName`) and delete that one file. A watch never expires its
 *    own suppression, because one that did would flood exactly when something is going badly wrong.
 *
 * ## The read STREAMS
 *
 * This journal grows by one line per window per new Codex event and is expected to hold a fortnight of them,
 * so its size is a property of how long the watch has run rather than of anything in the code — the class
 * `.claude/rules/typescript-patterns.md` keeps out of a single JS string. It goes through `readJsonlLines`
 * for that reason, not for speed.
 *
 * `home` is REQUIRED everywhere here, never defaulted: defaulting would let a test write into the operator's
 * real journal and skew the baseline the fleet is judged by.
 */

import { closeSync, mkdirSync, openSync, readdirSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

import { appendLines } from "#lib/appendSeparator.js";
import { err, ok, type Result } from "#lib/result.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";
import { type CodexDrawdownError, CodexDrawdownErrors } from "./drawdownErrors.js";
import {
  type CodexDrawdownJournalEvent,
  type CodexDrawdownJournalRead,
  parseCodexDrawdownLine,
} from "./drawdownJournal.js";

/** Owner-only permissions, matching the other journals under the state home. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The burn journal's absolute path.
 *
 * @param home the state home to resolve under
 * @returns the path to `codex-burn/drawdown.jsonl`
 */
export function codexDrawdownJournalPath({ home }: { home: string }): string {
  return stateHomePaths({ home }).codexBurnJsonl;
}

/**
 * The directory the episode claims live in.
 *
 * One file per claimed episode rather than one file listing them: the atomicity this depends on is
 * `O_CREAT | O_EXCL` on ONE path, and a shared file would need a lock around every append, which is the
 * read-then-append shape being avoided.
 *
 * @param home the state home to resolve under
 * @returns the path to `codex-burn/claims`
 */
function codexDrawdownClaimDir({ home }: { home: string }): string {
  return stateHomePaths({ home }).codexBurnClaims;
}

/**
 * Every event the journal holds.
 *
 * An ABSENT journal is an empty read rather than a failure — a watch that has never run has no history, and
 * that is the `warming` case the detector already reports honestly. A journal that EXISTS and cannot be
 * opened is a failure, because treating it as empty resets the baseline and makes the next real episode
 * invisible.
 *
 * @param home the state home to read under
 * @returns the events in file order, with the count of lines that could not be parsed
 */
export function readCodexDrawdownJournal({
  home,
}: {
  home: string;
}): Result<CodexDrawdownJournalRead, CodexDrawdownError> {
  const path = codexDrawdownJournalPath({ home });
  const events: CodexDrawdownJournalEvent[] = [];
  let unreadable = 0;
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        if (line.trim().length === 0) {
          return;
        }
        const parsed = parseCodexDrawdownLine({ line });
        if (parsed.isErr()) {
          unreadable += 1;
          return;
        }
        events.push(parsed.value);
      },
      path,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ok({ events: [], unreadable: 0 });
    }
    return err(
      CodexDrawdownErrors.storeFailed({
        cause: messageOf({ error }),
        operation: "the codex burn journal could not be read",
      }),
    );
  }
  return ok({ events, unreadable });
}

/**
 * Append events to the journal.
 *
 * @param home the state home to write under
 * @param events the events to append, in order
 * @returns nothing, or why the append failed — a reading nobody recorded is a hole in the baseline
 */
export function appendCodexDrawdownJournal({
  home,
  events,
}: {
  home: string;
  events: readonly CodexDrawdownJournalEvent[];
}): Result<undefined, CodexDrawdownError> {
  if (events.length === 0) {
    return ok(undefined);
  }
  const path = codexDrawdownJournalPath({ home });
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    appendLines({ mode: FILE_MODE, path, text: `${events.map((event) => JSON.stringify(event)).join("\n")}\n` });
  } catch (error) {
    return err(
      CodexDrawdownErrors.storeFailed({
        cause: messageOf({ error }),
        operation: "the codex burn journal could not be appended to",
      }),
    );
  }
  return ok(undefined);
}

/** What an attempt to claim an episode resolved to. */
export type CodexEpisodeClaim =
  /** This process holds the claim and is the one that may investigate. */
  | { readonly kind: "taken"; readonly path: string }
  /** Somebody already holds it — the ordinary suppression path, and not an error. */
  | { readonly kind: "held"; readonly reason: string };

/**
 * Take an exclusive claim on one episode, or report that somebody already holds it.
 *
 * `"wx"` is the whole mechanism: the kernel settles the race between two processes that both decide to
 * investigate in the same instant, with no cooperation between them and no window between the check and the
 * write. `EEXIST` is the ONE errno that means "held"; every other failure is a failure, because a claim
 * directory that cannot be written leaves the suppression state unknown and unknown must never read as free.
 *
 * @param home the state home the claims live under
 * @param episodeId the episode being claimed
 * @param nowIso the instant written into the claim, so a human reading the directory can date it
 * @returns whether this process took it, or the reason it did not — and a hard failure when neither is true
 */
export function claimCodexDrawdownEpisode({
  home,
  episodeId,
  nowIso,
}: {
  home: string;
  episodeId: string;
  nowIso: string;
}): Result<CodexEpisodeClaim, CodexDrawdownError> {
  const dir = codexDrawdownClaimDir({ home });
  const path = join(dir, `${claimFileName({ episodeId })}.json`);
  try {
    mkdirSync(dir, { mode: DIR_MODE, recursive: true });
  } catch (error) {
    return err(
      CodexDrawdownErrors.storeFailed({
        cause: messageOf({ error }),
        operation: "the codex burn claim directory could not be created",
      }),
    );
  }
  let handle: number;
  try {
    handle = openSync(path, "wx", FILE_MODE);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return ok({
        kind: "held",
        reason: `another watch already claimed this episode (${path}) — at most one automatic attempt is made`,
      });
    }
    return err(
      CodexDrawdownErrors.storeFailed({
        cause: messageOf({ error }),
        operation: "the codex burn episode claim could not be taken",
      }),
    );
  }
  try {
    writeSync(handle, JSON.stringify({ claimedAtIso: nowIso, episodeId, pid: process.pid }));
  } catch (error) {
    // The claim file EXISTS at this point, so the episode is claimed whether or not its contents landed.
    // Reporting a failure here rather than "taken" is deliberate: a caller that went on to spawn would be
    // spawning against a claim it cannot prove it wrote.
    return err(
      CodexDrawdownErrors.storeFailed({
        cause: messageOf({ error }),
        operation: "the codex burn episode claim was created but not written",
      }),
    );
  } finally {
    closeSync(handle);
  }
  return ok({ kind: "taken", path });
}

/**
 * Every episode id currently claimed.
 *
 * An absent directory is an empty list — nothing has ever been claimed. A directory that exists and cannot
 * be read is a FAILURE: the suppression state is unknown, and a caller must not treat that as free.
 *
 * @param home the state home the claims live under
 * @returns the claimed episode ids, or why they could not be read
 */
export function readCodexDrawdownClaims({ home }: { home: string }): Result<readonly string[], CodexDrawdownError> {
  const dir = codexDrawdownClaimDir({ home });
  try {
    return ok(
      readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name.slice(0, -".json".length)),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ok([]);
    }
    return err(
      CodexDrawdownErrors.storeFailed({
        cause: messageOf({ error }),
        operation: "the codex burn episode claims could not be read",
      }),
    );
  }
}

/**
 * An episode id as a filename.
 *
 * An episode id is built from series identities, which carry ISO instants with colons in them — legal on
 * this filesystem but not on every one, and `:` in a path is the kind of thing that works until somebody
 * mounts a share. Every character outside a conservative set becomes `_`, and the mapping is not reversible
 * by design: the claim file's own CONTENTS carry the real id.
 *
 * @param episodeId the id to encode
 * @returns a filename-safe form
 */
function claimFileName({ episodeId }: { episodeId: string }): string {
  return episodeId.replaceAll(/[^A-Za-z0-9._|-]/gu, "_");
}

/** An error's message, or a stated absence. */
function messageOf({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : "unknown";
}
