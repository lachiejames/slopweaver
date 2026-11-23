/**
 * The four things `briefing render` reads off disk or out of the store, and the one rule they share.
 *
 * Split out of `./renderRun.ts` because that file had grown past the length at which a reader holds it in
 * their head (the `file-size-ratchet` gate's own reasoning), and this is a real seam rather than an arbitrary
 * cut: everything here is an EDGE — a descriptor, a path, a stream — while what stays is the verb's shell and
 * its pure projections. `./renderRun.ts` wires each of these into `BriefingRenderDeps`
 * (`./briefingRenderTypes.ts`), so a test still
 * drives the whole verb without touching a filesystem.
 *
 * **The shared rule is that an absent file is never an empty one.** Every reader here reports what went
 * wrong and names the path, rather than answering with nothing — a page rendered from a missing register
 * would state that the fleet did nothing, which is the confident wrong answer these sections exist to avoid.
 */
import { readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";

import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import { foldAutonomy } from "../../../autonomy/query.js";
import type { AutonomyAction } from "../../../autonomy/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { supervisorCoreErrorLines } from "../../../supervisor/errors.js";
import {
  readSupervisorTickWindow,
  readSupervisorTickWindowFromLines,
  type SupervisorTickWindow,
} from "../../../supervisor/tickStore.js";
import type { DatedDocument } from "./briefingRenderTypes.js";
import { type BriefingCommandError, BriefingCommandErrors } from "./errors.js";

/**
 * Read the store's autonomy ledger and fold it, mapping its typed error into the verb's own refusal.
 *
 * A store that cannot be opened, one that has not imported a register still in the home, and one holding a
 * row it cannot read all REFUSE: a page drawn from any of them would state that the fleet did nothing, the
 * confident wrong answer this section exists to prevent.
 *
 * @param autonomy the autonomy ledger
 * @param home the state home the ledger answers for
 * @returns every act, newest first with the owner's latest word folded on, or the refusal naming what went wrong
 */
export async function readFoldedAutonomy({
  autonomy,
  home,
}: {
  autonomy: AutonomyLedgerPort;
  home: string;
}): Promise<Result<readonly AutonomyAction[], BriefingCommandError>> {
  const read = await autonomy.readRecords({ home });
  if (read.isErr()) {
    return err(BriefingCommandErrors.autonomyUnreadable({ cause: read.error.message, stage: "read" }));
  }
  const folded = foldAutonomy({ records: read.value });
  if (folded.isErr()) {
    return err(BriefingCommandErrors.autonomyUnreadable({ cause: folded.error.message, stage: "fold" }));
  }
  return ok(folded.value);
}

/**
 * Read the sweep's open-artifact document off disk, or off stdin for `-`, WITH the instant it was written.
 *
 * ## Why the filesystem is the clock here, and why that is a compromise rather than a design
 *
 * The your-list document says when it was taken — `../../../briefing/yourList.ts`'s `projectYourList` reads
 * the run's own `nowIso` — so its age is a fact inside it and stdin is as datable as a path. This document
 * is a bare JSON array (`../../../briefing/openArtifacts.ts`) and carries no instant at all, so the only
 * datable thing about it is when somebody last wrote the file. That is a weaker claim, and it is stated
 * here rather than discovered: it says when the set was last RE-CONFIRMED, not when it was last correct,
 * and a stable set of open pages legitimately leaves it untouched. It is still worth checking, because the
 * page asserts this is every page open on the owner and nobody is confirming that — which is the same class of
 * failure as the list that froze. `touch`ing the file each pass is what satisfies it.
 *
 * On stdin there is no file and no instant, so the age check has nothing to judge and does not run —
 * `../../../briefing/snapshotAge.ts` answers "not stale" for an absent instant by construction.
 *
 * @param source the `--open-artifacts` value: `-` for stdin, otherwise a path
 * @returns the document's text and when it was last written, or a refusal naming the path
 */
export function readOpenArtifactsDocument({ source }: { source: string }): Result<DatedDocument, BriefingCommandError> {
  if (source === "-") {
    return ok({ text: readFileSync(0, "utf8"), writtenIso: undefined });
  }
  try {
    const text = readFileSync(source, "utf8");
    return ok({ text, writtenIso: statSync(source).mtime.toISOString() });
  } catch (error: unknown) {
    return err(BriefingCommandErrors.fileUnreadable({ cause: error, path: source, what: "open-artifact document" }));
  }
}

/**
 * Read the `session-start --json` document off disk, or off stdin for `-`.
 *
 * A PATH rather than the JSON itself, unlike `--form`: a real run of that verb measured 126 KiB
 * (`slopweaver session-start --json --no-record | wc -c`), which is not something to put on a command line.
 *
 * @param source the `--your-list` value: `-` for stdin, otherwise a path
 * @returns the document's text, or a refusal naming the path and what went wrong
 */
export function readYourListDocument({ source }: { source: string }): Result<string, BriefingCommandError> {
  if (source === "-") {
    return ok(readFileSync(0, "utf8"));
  }
  try {
    return ok(readFileSync(source, "utf8"));
  } catch (error: unknown) {
    return err(BriefingCommandErrors.fileUnreadable({ cause: error, path: source, what: "session-start document" }));
  }
}

/**
 * Read the tick ledger's window off disk, or off stdin for `-`.
 *
 * Neither route ever holds the file: a path is streamed by `readSupervisorTickWindow` and stdin is streamed
 * through `node:readline`. The ledger is the fleet's whole history and grows for as long as the installation
 * runs, which is the shape `.claude/rules/typescript-patterns.md`'s `whole-file-json` gate refuses.
 *
 * @param source the `--ticks` value: `-` for stdin, otherwise a path
 * @param priorDays how far back to keep rows, absent for the reader's own ceiling
 * @returns the bounded window, or one line per reason the ledger could not be read
 */
export async function readTickWindow({
  source,
  priorDays,
}: {
  source: string;
  priorDays: number | undefined;
}): Promise<Result<SupervisorTickWindow>> {
  const bound = priorDays === undefined ? {} : { priorDays };
  if (source !== "-") {
    return readSupervisorTickWindow({ path: source, ...bound }).mapErr((error) => supervisorCoreErrorLines({ error }));
  }
  const read = await readSupervisorTickWindowFromLines({
    label: "the tick ledger on stdin",
    lines: createInterface({ crlfDelay: Infinity, input: process.stdin }),
    ...bound,
  });
  return read.mapErr((error) => supervisorCoreErrorLines({ error }));
}
