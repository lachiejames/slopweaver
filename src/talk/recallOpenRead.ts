/**
 * The disk half of `talk recall --open`: one record a search hit pointed at, read whole from the source the pointer
 * names — a call turn and the turns around it, a relayed steer, a journalled ruling, an archived ruling row. The
 * knowledge half is `./recallKnowledge.ts`; how an opened record is paged, and its context turns clipped or left out
 * to fit, is `./recallOpen.ts`.
 *
 * A pointer names a record by an id, a slug or an archive file's own name (`./recallPointer.ts`), so every path
 * below is built here, under the home, and every file is checked to be a regular one whose real path is inside the
 * home before it is read.
 */
import { lstatSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { archivedRulings, rulingArchiveDir } from "../handover/archivedRulings.js";
import type { RulingEvent } from "../handover/ledger.js";
import { decodeLedgerLine } from "../handover/ledgerLineDecode.js";
import { unsetFieldAsNull } from "../lib/absent.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import { callTouchedByTestInstance } from "./callOrigin.js";
import { type CallSegment, foldCall } from "./callRecord.js";
import { callsDir, readCallEntriesCounted } from "./callStore.js";
import { type RecallError, RecallErrors } from "./recallErrors.js";
import { RECALL_CONTEXT_TURNS, type RecallContextTurn, type RecallOpened } from "./recallOpen.js";
import { type RecallPointer } from "./recallPointer.js";
import { isMissingFile, JOURNAL_SUFFIX, steerIso, steerText } from "./recallRead.js";
import { rulingIso } from "./recallRulings.js";
import { readTurn } from "./relayStore.js";

/**
 * Why the file a pointer names may not be opened, or `undefined` when it is a regular file whose real path sits
 * inside the home's own. `lstat` refuses a file that is itself a link; it follows every
 * DIRECTORY above it, so a `talk/calls` linked out of the home would still be read through, and the real-path
 * comparison is what refuses that.
 *
 * The residue, stated: the check and the read resolve the path separately, so a process swapping a directory for a
 * link between the two could still steer the read. That process already runs as the owner with
 * write access to the owner's home, so it can read the target itself and gains nothing; closing it would mean reading every
 * source through a held descriptor, which no reader here does. What this guards is the pointer the voice passes,
 * and the voice can neither write a file nor race one.
 */
function outsideHome({
  home,
  path,
  text,
  what,
}: {
  home: string;
  path: string;
  text: string;
  what: string;
}): RecallError | undefined {
  try {
    if (!lstatSync(path).isFile()) {
      return RecallErrors.notFound({ pointer: text, what: `${what} as a regular file` });
    }
    const root = realpathSync(home);
    const real = realpathSync(path);
    if (real.startsWith(`${root}${sep}`)) {
      return undefined;
    }
    return RecallErrors.notFound({ pointer: text, what: `${what} inside the home` });
  } catch (cause) {
    if (isMissingFile({ cause })) {
      return RecallErrors.notFound({ pointer: text, what });
    }
    return RecallErrors.sourceUnreadable({ cause, path });
  }
}

/** A segment as context: who and what, never cut here (`./recallOpen.ts` clips context). */
function contextTurn({ segment }: { segment: CallSegment }): RecallContextTurn {
  return { atIso: segment.atIso, text: segment.text, who: segment.who };
}

/** Open one call turn with the turns around it. */
function openCall({
  home,
  pointer,
  text,
}: {
  home: string;
  pointer: Extract<RecallPointer, { kind: "call" }>;
  text: string;
}): Result<RecallOpened, RecallError> {
  const refused = outsideHome({
    home,
    path: join(callsDir({ home }), `${pointer.callId}${JOURNAL_SUFFIX}`),
    text,
    what: `call ${pointer.callId}`,
  });
  if (refused !== undefined) {
    return err(refused);
  }
  const read = readCallEntriesCounted({ callId: pointer.callId, home });
  if (read.isErr()) {
    return err(RecallErrors.sourceUnreadable({ cause: read.error.message, path: `call ${pointer.callId}` }));
  }
  // A call the desktop test instance opened holds none of the owner's words, so no pointer into it opens (`./callOrigin.ts`).
  if (callTouchedByTestInstance({ entries: read.value.entries })) {
    return err(RecallErrors.notFound({ pointer: text, what: `call ${pointer.callId}, which the desktop test placed` }));
  }
  const call = foldCall({ callId: pointer.callId, entries: read.value.entries, skipped: read.value.skipped });
  const segments = call === undefined ? [] : call.segments;
  const at = segments.findIndex((segment) => segment.id === pointer.segmentId);
  const target = segments[at];
  if (call === undefined || target === undefined) {
    return err(RecallErrors.notFound({ pointer: text, what: `turn ${pointer.segmentId} of call ${pointer.callId}` }));
  }
  return ok({
    about: unsetFieldAsNull({ key: "open", record: target }),
    after: segments.slice(at + 1, at + 1 + RECALL_CONTEXT_TURNS).map((segment) => contextTurn({ segment })),
    atIso: target.atIso,
    before: segments.slice(Math.max(0, at - RECALL_CONTEXT_TURNS), at).map((segment) => contextTurn({ segment })),
    detail: {
      callId: call.callId,
      callOpenedIso: call.openedIso,
      card: unsetFieldAsNull({ key: "open", record: target }),
      finished: target.final ? "yes" : "no — the call dropped while the owner was speaking",
      surface: call.surface,
    },
    pointer: text,
    source: "calls",
    text: target.text,
    who: target.who,
  });
}

/** Open one relayed steer from its turn file. */
function openSteer({
  home,
  pointer,
  text,
}: {
  home: string;
  pointer: Extract<RecallPointer, { kind: "steer" }>;
  text: string;
}): Result<RecallOpened, RecallError> {
  const refused = outsideHome({
    home,
    path: join(stateHomePaths({ home }).talkTurns, `${pointer.turnId}.json`),
    text,
    what: `relay turn ${pointer.turnId}`,
  });
  if (refused !== undefined) {
    return err(refused);
  }
  const read = readTurn({ home, turnId: pointer.turnId });
  if (read.isErr()) {
    return err(RecallErrors.notFound({ pointer: text, what: `relay turn ${pointer.turnId}` }));
  }
  const record = read.value;
  return ok({
    about: record.slug,
    after: [],
    atIso: steerIso({ record }),
    before: [],
    detail: {
      card: record.about === "" ? null : record.about,
      registeredAtIso: record.registeredAtIso,
      slug: record.slug,
      state: record.state,
      typed: record.typed ? "typed in the steer box" : "spoken on a call",
    },
    pointer: text,
    source: "steers",
    text: steerText({ record }),
    who: "owner",
  });
}

/** The ruling event on one line of a run's journal, or `undefined` when that line holds none. */
function rulingOnLine({ path, line }: { path: string; line: number }): RulingEvent | undefined {
  let event: RulingEvent | undefined;
  readJsonlLines({
    onChunk: () => event === undefined,
    onLine: ({ line: raw, index }) => {
      if (index + 1 !== line) {
        return;
      }
      const decoded = decodeLedgerLine({ line: raw });
      if (decoded?.kind === "ruling") {
        event = decoded;
      }
    },
    path,
  });
  return event;
}

/** Open one journalled ruling by its line. */
function openRunRuling({
  home,
  pointer,
  text,
}: {
  home: string;
  pointer: Extract<RecallPointer, { kind: "run-ruling" }>;
  text: string;
}): Result<RecallOpened, RecallError> {
  const path = join(stateHomePaths({ home }).runs, `${pointer.slug}${JOURNAL_SUFFIX}`);
  const refused = outsideHome({ home, path, text, what: `the journal of ${pointer.slug}` });
  if (refused !== undefined) {
    return err(refused);
  }
  let event: RulingEvent | undefined;
  try {
    event = rulingOnLine({ line: pointer.line, path });
  } catch (cause) {
    return err(RecallErrors.sourceUnreadable({ cause, path }));
  }
  if (event === undefined) {
    return err(
      RecallErrors.notFound({ pointer: text, what: `a ruling on line ${String(pointer.line)} of ${pointer.slug}` }),
    );
  }
  return ok({
    about: pointer.slug,
    after: [],
    atIso: rulingIso({ event }),
    before: [],
    detail: { anchor: event.anchor, journalledIso: event.atIso, run: pointer.slug },
    pointer: text,
    source: "rulings",
    text: event.ruling,
    who: "owner",
  });
}

/** Open one archived ruling row by its file and line. */
function openArchivedRuling({
  home,
  pointer,
  text,
}: {
  home: string;
  pointer: Extract<RecallPointer, { kind: "archived-ruling" }>;
  text: string;
}): Result<RecallOpened, RecallError> {
  const archiveDir = rulingArchiveDir({ home });
  const refused = outsideHome({ home, path: join(archiveDir, pointer.file), text, what: `archive ${pointer.file}` });
  if (refused !== undefined) {
    return err(refused);
  }
  const row = archivedRulings({ archiveDir, sinceMs: Number.NEGATIVE_INFINITY }).rows.find(
    (candidate) => candidate.file === pointer.file && candidate.line === pointer.line,
  );
  if (row === undefined) {
    return err(
      RecallErrors.notFound({ pointer: text, what: `a ruling row on line ${String(pointer.line)} of ${pointer.file}` }),
    );
  }
  return ok({
    about: row.file,
    after: [],
    atIso: row.instantIso,
    before: [],
    detail: { archive: row.file, dated: "by the archive file's last write; the archive keeps no date per row" },
    pointer: text,
    source: "rulings",
    text: row.text,
    who: "owner",
  });
}

/**
 * Open one disk record a search hit pointed at.
 *
 * @param pointer the parsed pointer; a knowledge pointer is `./recallKnowledge.ts`'s
 * @param text the pointer as given, echoed in the answer
 * @returns the record whole, or why it could not be opened
 */
export function openDiskRecall({
  home,
  pointer,
  text,
}: {
  home: string;
  pointer: Exclude<RecallPointer, { kind: "knowledge" }>;
  text: string;
}): Result<RecallOpened, RecallError> {
  switch (pointer.kind) {
    case "call":
      return openCall({ home, pointer, text });
    case "steer":
      return openSteer({ home, pointer, text });
    case "run-ruling":
      return openRunRuling({ home, pointer, text });
    case "archived-ruling":
      return openArchivedRuling({ home, pointer, text });
    default: {
      const unreachable: never = pointer;
      return unreachable;
    }
  }
}
