/**
 * THE OWNER'S LATER, REMEMBERED — one file per open step the owner pressed Later on, outliving the marker that carried it.
 *
 * A `later` marker is consumed by the first reconcile that reads it and writes no row (`./reconcile.ts`), which is
 * right for the register: Later says nothing about whether the step happened. But a monitor that raises a lost
 * notice's note again (`../monitor/noticeReraise.ts`) has to tell "it went down by itself" from "the owner put it down", and
 * by the time it runs, another reader has usually consumed the marker: the console's `hand list` poll, or an
 * earlier fired check in the same tick. So the reconcile writes the press here before it
 * removes the marker, and drops an entry once its step is no longer open. A raise that draws the step's note
 * forgets it (`./note/raise.ts`).
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";

import { type HandStepError, HandStepErrors } from "./errors.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Where the ledger lives: `$home/hand-steps/later`, one file per open step the owner pressed Later on.
 *
 * @param home the state home
 * @returns the ledger directory
 */
export function laterLedgerDir({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).handSteps, "later");
}

/**
 * Every open step the owner pressed Later on and has not had raised since. An absent directory is none.
 *
 * @param home the state home
 * @returns the step ids, or the failure to read the directory
 */
export function laterPressed({ home }: { home: string }): Result<ReadonlySet<string>, HandStepError> {
  const dir = laterLedgerDir({ home });
  try {
    return ok(new Set(readdirSync(dir)));
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok(new Set());
    }
    return err(HandStepErrors.laterLedger({ cause: errorMessage({ error }), path: dir }));
  }
}

/**
 * Whether the ledger holds the owner's Later on one step.
 *
 * @param home the state home
 * @param id the step's id
 * @returns true while the entry stands
 */
export function laterHeld({ home, id }: { home: string; id: string }): boolean {
  return existsSync(join(laterLedgerDir({ home }), id));
}

/**
 * Write each Later press on an OPEN step, and, when the register read whole, drop every entry whose step is no
 * longer open. A press on a step already settled is the close `hand done` or a retraction leaves, not the owner's.
 *
 * @param pressed the ids of the `later` markers this reconcile consumes
 * @param open every step id the register carries open
 * @param prune whether the register read with no skipped line, so an id missing from `open` is truly settled
 * @param nowIso the stamp written into each entry
 * @returns the presses that would not record, whose markers the caller keeps, and every failure met
 */
export function rememberLaterPresses({
  home,
  pressed,
  open,
  prune,
  nowIso,
}: {
  home: string;
  pressed: readonly string[];
  open: ReadonlySet<string>;
  prune: boolean;
  nowIso: string;
}): { unrecorded: ReadonlySet<string>; problems: readonly HandStepError[] } {
  const dir = laterLedgerDir({ home });
  const unrecorded = new Set<string>();
  const problems: HandStepError[] = [];
  for (const id of pressed.filter((pressedId) => open.has(pressedId))) {
    try {
      mkdirSync(dir, { mode: DIR_MODE, recursive: true });
      writeFileSync(join(dir, id), `${nowIso}\n`, { mode: FILE_MODE });
    } catch (error: unknown) {
      unrecorded.add(id);
      problems.push(HandStepErrors.laterLedger({ cause: errorMessage({ error }), path: join(dir, id) }));
    }
  }
  // A ledger that would not take a write is reported once, not again by a prune that would fail the same way.
  if (!prune || problems.length > 0) {
    return { problems, unrecorded };
  }
  const recorded = laterPressed({ home });
  if (recorded.isErr()) {
    return { problems: [recorded.error], unrecorded };
  }
  const forgotten = [...recorded.value]
    .filter((recordedId) => !open.has(recordedId))
    .flatMap((id) => forgetLaterPress({ home, id }));
  return { problems: forgotten, unrecorded };
}

/**
 * Drop one step's Later, because the step left the register.
 *
 * @param home the state home
 * @param id the step's id
 * @returns the failure to remove the entry, if one
 */
function forgetLaterPress({ home, id }: { home: string; id: string }): readonly HandStepError[] {
  const path = join(laterLedgerDir({ home }), id);
  try {
    rmSync(path, { force: true });
    return [];
  } catch (error: unknown) {
    return [HandStepErrors.laterLedger({ cause: errorMessage({ error }), path })];
  }
}
