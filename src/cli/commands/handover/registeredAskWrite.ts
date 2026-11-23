/**
 * The effectful edge of `../../../handover/registeredAskChange.ts`: re-read a registered ask's file and journal,
 * re-judge it as it reads NOW, write the change atomically, and mirror the document — the `handover recheck`
 * pattern, plus the journal read this needs because "never started" is a journal fact a run could change between
 * the verb resolving the row and the write.
 *
 * `handover reconfirm`, `handover correct` and `handover withdraw` each branch here when the row they resolved is
 * a registered ask the Queue draws, and otherwise keep their run-journal path unchanged.
 */

import { readFileSync } from "node:fs";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import type { RegisteredAsk } from "../../../handover/registeredAsk.js";
import {
  changeRewritesStillReal,
  type RegisteredAskChange,
  registeredAskChangeText,
  registeredAskForChange,
} from "../../../handover/registeredAskChange.js";
import {
  type RegisteredAskChangeError,
  RegisteredAskChangeErrors,
} from "../../../handover/registeredAskChangeErrors.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { type BoardRowLockOptions, withBoardRowLock } from "./boardRowLock.js";
import type { Resolved } from "./lifecycleRunCore.js";
import { shapeFrom } from "./listJsonAsk.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";
import { shapeTexts } from "./namedDraftAdmission.js";

/**
 * The registered ask a resolved row is, when the verb should edit its file rather than journal a run event.
 *
 * @param resolved the verb's resolved context, its doc and journal as read at resolution
 * @param rewritesStillReal the verb replaces the still-real line, so a row malformed only by that line is still one
 * @returns the ask, or `undefined` when the verb's run path applies
 */
export function registeredAskOfResolved({
  resolved,
  rewritesStillReal,
}: {
  resolved: Resolved;
  rewritesStillReal: boolean;
}): RegisteredAsk | undefined {
  return registeredAskForChange({
    doc: resolved.context.doc,
    events: resolved.context.events,
    rewritesStillReal,
    unreadableLines: resolved.context.unreadable,
  });
}

/**
 * The shape texts a registered ask's card goes on drawing beside a new still-real line: every field but that
 * line, which the edit replaces — checking the line being retired would refuse the very edit retiring it.
 *
 * @param resolved the verb's resolved context, whose doc carries the registered shape
 * @returns the problem, options, lean, risk and blast radius, in the order the card draws them
 */
export function registeredKeptShape({ resolved }: { resolved: Resolved }): readonly string[] {
  const shape = shapeFrom({ doc: resolved.context.doc, run: { kind: "never-started" } })?.shape;
  if (shape?.stakes === undefined) {
    return shapeTexts({ shape });
  }
  const { risk, blastRadius } = shape.stakes;
  return [...shapeTexts({ shape: { ...shape, stakes: undefined } }), risk, blastRadius];
}

/**
 * Write one change to a registered ask, re-judged against the file and journal as they read now.
 *
 * @param change the edit and everything it writes
 * @param path the row's file as the board scan found it
 * @param slug the row the verb resolved, which the file must still hold
 * @param runsDir where the row's journal would be, re-read so a run opened since resolution refuses the write
 * @param rowLock how the write waits on the row's lock when another writer holds it
 * @returns the path written, or why nothing was
 */
export function writeRegisteredAskChange({
  change,
  path,
  slug,
  runsDir,
  rowLock,
}: {
  change: RegisteredAskChange;
  path: string;
  slug: string;
  runsDir: string;
  rowLock?: BoardRowLockOptions;
}): Result<string, RegisteredAskChangeError> {
  // The row is read, judged and replaced inside its one lock (`./boardRowLock.ts`), so no other row writer lands
  // between this read and the rename; the lock hands over the real file, so a symlinked row's target is replaced.
  const locked = withBoardRowLock({
    ...rowLock,
    path,
    write: ({ target }) => writeChangeAt({ change, path, runsDir, slug, target }),
  });
  if (locked.isErr()) {
    return err(RegisteredAskChangeErrors.file({ detail: locked.error.message, path }));
  }
  return locked.value;
}

/** {@link writeRegisteredAskChange}'s read, judgement and write, run under the row's lock on the real file `target`. */
function writeChangeAt({
  change,
  path,
  slug,
  runsDir,
  target,
}: {
  change: RegisteredAskChange;
  path: string;
  slug: string;
  runsDir: string;
  target: string;
}): Result<string, RegisteredAskChangeError> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(target);
  } catch (cause: unknown) {
    return err(RegisteredAskChangeErrors.file({ detail: `cannot read it: ${String(cause)}`, path }));
  }
  const text = bytes.toString("utf8");
  // Decoding replaces an invalid sequence, so writing the edit back would rewrite bytes it never named.
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    return err(RegisteredAskChangeErrors.file({ detail: "is not valid UTF-8, so an edit would rewrite it", path }));
  }
  const doc = parseHandoverDoc({ path, text });
  if (doc.slug !== slug) {
    return err(RegisteredAskChangeErrors.file({ detail: `now holds the row "${doc.slug}", not "${slug}"`, path }));
  }
  const rewritesStillReal = changeRewritesStillReal({ change });
  const ask = askNow({ doc, path, rewritesStillReal, runsDir, slug });
  if (ask.isErr()) {
    return err(ask.error);
  }
  const edited = registeredAskChangeText({ change, path, previousQuestion: ask.value.question, text });
  if (edited.isErr()) {
    return err(edited.error);
  }
  // A last read of the journal, so a run opened while this edit was computed is refused rather than written over.
  const stillAsk = askNow({ doc, path, rewritesStillReal, runsDir, slug });
  if (stillAsk.isErr()) {
    return err(stillAsk.error);
  }
  try {
    // A last read of the row: every row writer here waits on the lock this holds, so a change seen now is a hand edit
    // or a build that predates the lock, refused rather than overwritten. The journal is not under this lock, which
    // is why it is read a second time above.
    if (!readFileSync(target).equals(bytes)) {
      return err(RegisteredAskChangeErrors.file({ detail: "changed while this edit was computed — re-run it", path }));
    }
    writeFileAtomic({ contents: edited.value, path: target });
  } catch (cause: unknown) {
    return err(RegisteredAskChangeErrors.file({ detail: `could not write it: ${String(cause)}`, path }));
  }
  return ok(target);
}

/** The registered ask the row is against its journal as it reads at this instant, or why it no longer is one. */
function askNow({
  doc,
  path,
  rewritesStillReal,
  runsDir,
  slug,
}: {
  doc: HandoverDoc;
  path: string;
  rewritesStillReal: boolean;
  runsDir: string;
  slug: string;
}): Result<RegisteredAsk, RegisteredAskChangeError> {
  const journal = readRunJournal({ runsDir, slug });
  if (journal.isErr()) {
    return err(RegisteredAskChangeErrors.file({ detail: journal.error.message, path }));
  }
  const ask = registeredAskForChange({
    doc,
    events: journal.value.events,
    rewritesStillReal,
    unreadableLines: journal.value.unreadable,
  });
  if (ask === undefined) {
    return err(RegisteredAskChangeErrors.notEligible({ slug }));
  }
  return ok(ask);
}

/**
 * Write the change, print what happened under the verb's name, and mirror the document.
 *
 * @param verb the verb writing, named in every line it prints
 * @param change the edit and everything it writes
 * @param resolved the verb's resolved context
 * @param said what to print on success, after the verb and slug
 * @returns the process exit code
 */
export async function applyRegisteredAskChange({
  verb,
  change,
  resolved,
  said,
}: {
  verb: string;
  change: RegisteredAskChange;
  resolved: Resolved;
  said: string;
}): Promise<number> {
  const slug = resolved.context.doc.slug;
  const written = writeRegisteredAskChange({
    change,
    path: resolved.context.doc.path,
    runsDir: resolved.runsDir,
    slug,
  });
  if (written.isErr()) {
    written.error.reasons.forEach((reason) => {
      logger.error({ msg: `handover ${verb}: ${reason}` });
    });
    return EXIT_ERROR;
  }
  logger.out({ line: `handover ${verb}: ${slug} ${said}` });
  logger.out({ line: `  row: ${written.value} (a registered ask with no run — its front matter, no journal)` });
  const mirrorFailed = await mirrorAfterWrite({ home: resolved.home, path: resolved.context.doc.path, verb });
  return mirrorFailed ? EXIT_ERROR : EXIT_OK;
}
