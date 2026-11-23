/**
 * A journal append judged against its row as the row stands AT the append, not as the verb first resolved it.
 *
 * `handover ask` refuses a settled ask row, and `handover settle` writes `settlement:` under the row's lock
 * (`./boardRowLock.ts`). A check made once, at the top of a verb, leaves the gap between that check and the append for a
 * settle to land in — the question is then journalled on a row every surface has stopped showing. So the row is re-read and judged just before the append, and when a locked writer could still change the
 * verdict, that re-read, the judgement and the append all run inside that one lock.
 *
 * The lock is taken only when the fresh row says a locked writer could matter (`lockWhen`): only an ask row can be
 * settled, and an ask on any other row would otherwise need a lock directory it may not be able to create.
 * The unlocked read is what a row edited by hand reaches, and that is the whole of the protection against
 * a writer that takes no lock — one could land after a locked read just as well.
 */

import { readFileSync } from "node:fs";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import type { RowEventWritten } from "../../../handover/rowEvent.js";
import type { RowWriteError } from "../../../handover/rowEventErrors.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { type BoardRowLockOptions, withBoardRowLock } from "./boardRowLock.js";

/** A verb's refusal over the row as it stands at the append, and when that judgement must hold the row's lock. */
export interface FreshCheck {
  /** The verb's own refusal over a row, `undefined` when the row admits the write. */
  readonly refusal: (args: { doc: HandoverDoc }) => readonly string[] | undefined;
  /** Whether a writer that takes the row's lock could change the refusal's verdict on this row. */
  readonly lockWhen: (args: { doc: HandoverDoc }) => boolean;
}

/** A refusal's lines. */
type Refused = { readonly kind: "refused"; readonly lines: readonly string[] };

/** What {@link appendUnlessRefused} did: the append's own result, or the lines that refused it. */
type Written<T> = Refused | { readonly kind: "appended"; readonly appended: T };

/** The row re-read from disk and judged, or the lines that refused it. */
function judgedRow({
  path,
  file,
  refusal,
}: {
  path: string;
  file: string;
  refusal: FreshCheck["refusal"];
}): Refused | { readonly kind: "admitted"; readonly doc: HandoverDoc } {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (cause: unknown) {
    return { kind: "refused", lines: [`cannot read ${path} to check it before the write: ${String(cause)}`] };
  }
  const doc = parseHandoverDoc({ path, text });
  const refused = refusal({ doc });
  if (refused !== undefined) {
    return { kind: "refused", lines: refused };
  }
  return { doc, kind: "admitted" };
}

/**
 * Append the event, or refuse it on the row as it stands at the append. With a `fresh` check, the row is re-read and
 * judged first; when its `lockWhen` says a locked writer could still change the verdict, the row is re-read, judged and
 * the event appended inside the row's one lock — the lock `handover settle` writes `settlement:` under — so a settle
 * cannot land between the judgement and the append. The lock waits on a row write, never on another journal append, so
 * `applyRowEvent` under it takes nothing it could wait on.
 *
 * @param append the journal write, run at most once
 * @param doc the row as the verb resolved it, whose path the lock and the re-read name
 * @param fresh the verb's check over the re-read row; without one the event is appended unread and unlocked
 * @param rowLock how the write waits on a held row lock — a test's seam to land a settle between two tries
 * @returns the append's own result, or the lines that refused it
 */
export function appendUnlessRefused<T>({
  append,
  doc,
  fresh,
  rowLock,
}: {
  append: () => T;
  doc: HandoverDoc;
  fresh: FreshCheck | undefined;
  rowLock?: BoardRowLockOptions;
}): Written<T> {
  if (fresh === undefined) {
    return { appended: append(), kind: "appended" };
  }
  const unlocked = judgedRow({ file: doc.path, path: doc.path, refusal: fresh.refusal });
  if (unlocked.kind === "refused") {
    return unlocked;
  }
  if (!fresh.lockWhen({ doc: unlocked.doc })) {
    return { appended: append(), kind: "appended" };
  }
  const locked = withBoardRowLock({
    ...rowLock,
    path: doc.path,
    // The row is only re-read here; the append goes to the journal, so a hard-linked row is no reason to refuse it.
    rewrites: false,
    write: ({ target }): Written<T> => {
      const judged = judgedRow({ file: target, path: doc.path, refusal: fresh.refusal });
      if (judged.kind === "refused") {
        return judged;
      }
      return { appended: append(), kind: "appended" };
    },
  });
  if (locked.isErr()) {
    return { kind: "refused", lines: [`${locked.error.message} — nothing was recorded`] };
  }
  return locked.value;
}

/**
 * Print a refusal's lines under the verb's own prefix, the first line carrying it.
 *
 * @param lines the refusal, first line first
 * @param verb the `handover` verb that refused
 * @returns `EXIT_ERROR`, for the verb to return
 */
export function printedRefusal({ lines, verb }: { lines: readonly string[]; verb: string }): number {
  lines.forEach((line, index) => {
    logger.error({ msg: index === 0 ? `handover ${verb}: ${line}` : line });
  });
  return EXIT_ERROR;
}

/**
 * {@link appendUnlessRefused} over a row-event append, printing a refusal or a failed write itself.
 *
 * @param append the `applyRowEvent` call, run at most once
 * @param doc the row as the verb resolved it
 * @param fresh the verb's check over the re-read row
 * @param verb the `handover` verb writing, for the printed prefix
 * @returns what was written, or the exit code of the refusal or failure printed instead
 */
export function journalUnlessRefused({
  append,
  doc,
  fresh,
  verb,
}: {
  append: () => Result<RowEventWritten, RowWriteError>;
  doc: HandoverDoc;
  fresh: FreshCheck | undefined;
  verb: string;
}): number | RowEventWritten {
  const written = appendUnlessRefused({ append, doc, fresh });
  if (written.kind === "refused") {
    return printedRefusal({ lines: written.lines, verb });
  }
  if (written.appended.isErr()) {
    return printedRefusal({ lines: [written.appended.error.message], verb });
  }
  return written.appended.value;
}
