/**
 * A `talk:` anchor that holds a CALL id rather than a relay turn id — the one misreading a call can suffer here.
 *
 * Both are v4 UUIDs, so `parseRelayAnchor` takes `talk:<callId>` as readily as `talk:<turnId>`, and nothing at
 * `handover register` told them apart. A call's words have their own anchors (`talk-call:<callId>#<segmentId>` for a
 * stretch of the call file, `call:<callId>#<segment>` for a landed card — `../handover/hisWordsResolve.ts`), and a
 * relay turn's file is what `talk:` names. MEASURED: a board row carried
 * `talk:<callId>`, an id `talk/call-index.txt` lists and no `talk/turns/` file carries, so `handover settle` refused
 * it as an unreadable relay for good. Repro: `grep -n <callId> "$SLOPWEAVER_HOME/talk/call-index.txt"`.
 *
 * The id is a call only when BOTH hold: no turn file is there at all (an unreadable one is damage, never a call), and
 * the call store PROVES the id — listed in the call index, or, for a call that predates the index, a regular call
 * file under its name. Every doubt fails closed: an index that will not read — a dangling link at its path
 * included — is an error even when a call file happens to be there, and anything at the call file's path but a regular file is an error, never a call. Turn ids
 * and call ids are minted apart, so the two never coincide; were one ever both, the turn file wins.
 */
import { lstatSync, statSync } from "node:fs";
import { join } from "node:path";

import { isAbsentError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { callIndexPath, callsDir } from "./callStore.js";
import { parseRelayAnchor } from "./relayDraft.js";
import { readTurn } from "./relayStore.js";
import { type UnreadError, UnreadErrors } from "./unreadErrors.js";
import { indexedCalls } from "./unreadRead.js";

/**
 * The call id a `talk:` anchor holds in place of a relay turn id, or undefined when it holds none.
 *
 * @param anchor the anchor as a row or a flag carries it, in any spelling `parseRelayAnchor` normalises
 * @returns the call id when the anchor is `talk:` over an id with no turn file that the call store proves a call;
 *   undefined for any other anchor, a turn that exists or is merely unreadable, or an id no call carries; an error
 *   when the call index will not read or the call file's path holds something else, since then it cannot be proven
 */
export function callIdInRelayAnchor({
  home,
  anchor,
}: {
  home: string;
  anchor: string;
}): Result<string | undefined, UnreadError> {
  return relayAnchorTurnReading({ anchor, home }).map((reading) => (reading.kind === "call" ? reading.id : undefined));
}

/** What a `talk:` anchor's id comes to from ONE read of its turn file: a call, a turn never written, or neither. */
export type RelayAnchorTurnReading =
  /** No turn file, and the call store proves the id a call's. */
  | { readonly kind: "call"; readonly id: string }
  /** No turn file, and the call store proves the id no call's: a relay turn that was never written. */
  | { readonly kind: "absent" }
  /** Not a `talk:` anchor, or a turn file that reads or is merely unreadable — neither a call nor absent. */
  | { readonly kind: "neither" };

/**
 * {@link callIdInRelayAnchor}'s reading, keeping the absent turn apart from a turn that is there: a caller that must
 * act on absence takes it from this ONE read, never from an earlier read of its own the file may have outlived.
 *
 * @param anchor the anchor as a row or a flag carries it, in any spelling `parseRelayAnchor` normalises
 * @returns call, absent or neither; an error when the call store cannot prove which
 */
export function relayAnchorTurnReading({
  home,
  anchor,
}: {
  home: string;
  anchor: string;
}): Result<RelayAnchorTurnReading, UnreadError> {
  const parsed = parseRelayAnchor({ text: anchor });
  if (parsed === undefined) {
    return ok({ kind: "neither" });
  }
  const id = parsed.slice(parsed.indexOf(":") + 1);
  const turn = readTurn({ home, turnId: id });
  if (turn.isOk()) {
    return ok({ kind: "neither" });
  }
  const absent =
    turn.error.code === "PATH_UNREADABLE" && isAbsentError({ error: turn.error.cause, path: turn.error.path });
  if (!absent) {
    return ok({ kind: "neither" });
  }
  const indexed = indexedCalls({ home });
  if (indexed.isErr()) {
    return err(indexed.error);
  }
  if (indexed.value.includes(id)) {
    return ok({ id, kind: "call" });
  }
  const index = indexStands({ home });
  if (index.isErr()) {
    return err(index.error);
  }
  return callFileHolds({ home, id }).map((call): RelayAnchorTurnReading =>
    call === undefined ? { kind: "absent" } : { id: call, kind: "call" },
  );
}

/**
 * The index read, or is genuinely not there. `indexedCalls` answers an empty list for ANY ENOENT, a dangling link at
 * the index's path included, and an index that never read cannot vouch that the id is absent from it.
 */
function indexStands({ home }: { home: string }): Result<void, UnreadError> {
  const path = callIndexPath({ home });
  try {
    statSync(path);
    return ok(undefined);
  } catch (cause) {
    if (isAbsentError({ error: cause, path })) {
      return ok(undefined);
    }
    return err(UnreadErrors.pathFailed({ cause, path }));
  }
}

/** A call that predates the index: proven only by a REGULAR file under its name, refused on anything else there. */
function callFileHolds({ home, id }: { home: string; id: string }): Result<string | undefined, UnreadError> {
  const path = join(callsDir({ home }), `${id}.jsonl`);
  try {
    if (lstatSync(path).isFile()) {
      return ok(id);
    }
    return err(UnreadErrors.pathFailed({ cause: new Error("not a regular call file"), path }));
  } catch (cause) {
    if (isAbsentError({ error: cause, path })) {
      return ok(undefined);
    }
    return err(UnreadErrors.pathFailed({ cause, path }));
  }
}
