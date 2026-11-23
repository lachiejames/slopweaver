/**
 * Reading and writing one target's resync outcome — the effectful shell around `./outcome.ts`.
 *
 * One FILE per target rather than one map, for the same reason `corpus/watermark.ts` split its cursors:
 * two targets finishing at the same moment write different files, so neither can clobber the other's
 * record. A shared map's read-modify-write would lose one of them, and losing the record of which resync
 * worked is the exact thing this store exists to stop.
 *
 * A missing file is a target never attempted. A file that is there but unreadable, not JSON or not a resync
 * record is a typed {@link ResyncStateCorruptError}, never a missing one: read as absent, it made a target
 * that had been working for months read as never having succeeded, and the next write erased the last
 * success it held.
 */
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { isGenuinelyAbsent } from "#lib/presentFile.js";
import { readFileIfPresent } from "../../atlas/atlasFile.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { ResyncErrors, type ResyncState, type ResyncStateCorruptError, type ResyncStateReadError } from "./outcome.js";
import { parseResyncState } from "./outcomeParse.js";

/** Where one target's record lives. */
function statePath({ stateDir, recipeId }: { readonly stateDir: string; readonly recipeId: string }): string {
  return join(stateDir, `${recipeId}.json`);
}

/**
 * What is remembered about one target.
 *
 * @param stateDir the resync state directory, from `stateHome.ts`'s `live.recipe.resyncStateDir`
 * @param recipeId the target's row
 * @returns its state, `null` when no record exists, or why the one that does cannot be trusted
 */
export function readResyncState({
  stateDir,
  recipeId,
}: {
  readonly stateDir: string;
  readonly recipeId: string;
}): Result<ResyncState | null, ResyncStateCorruptError> {
  const path = statePath({ recipeId, stateDir });
  const corrupt = ({ detail }: { readonly detail: string }): Result<never, ResyncStateCorruptError> =>
    err(ResyncErrors.stateCorrupt({ detail, path, recipeId }));
  const text = readFileIfPresent({ path });
  if (text.isErr()) {
    return corrupt({ detail: text.error.join("; ") });
  }
  if (text.value === null) {
    return ok(null);
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: `resync state ${recipeId}`, text: text.value });
  } catch (cause) {
    return corrupt({ detail: `not JSON: ${errorMessage({ error: cause })}` });
  }
  const parsed = parseResyncState({ value: decoded });
  if (parsed.isErr()) {
    return corrupt({ detail: parsed.error.join("; ") });
  }
  // A well-formed record for ANOTHER target — copied or renamed into this one's file — would carry that
  // target's last success and blocker onto this row, so it is as untrustworthy as one that is not JSON.
  const { lastAttempt } = parsed.value;
  const heldKeys = [parsed.value.recipeId, ...(lastAttempt === null ? [] : [lastAttempt.recipeId])];
  const foreign = heldKeys.find((key) => key !== recipeId);
  if (foreign !== undefined) {
    return corrupt({ detail: `it records ${foreign}, not this target` });
  }
  return ok(parsed.value);
}

/** Whether a directory read failed only because the directory is not there yet — never a dangling link to one. */
function isNotFound({ cause, stateDir }: { readonly cause: unknown; readonly stateDir: string }): boolean {
  const notFound = typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
  return notFound && isGenuinelyAbsent({ path: stateDir });
}

/**
 * Everything remembered about every target, keyed by recipe id.
 *
 * @param stateDir the resync state directory
 * @returns one entry per trustworthy record, and every record (or a directory) that is there but cannot be
 *   read; an absent directory is neither, not a failure
 */
export function readAllResyncState({ stateDir }: { readonly stateDir: string }): {
  readonly states: ReadonlyMap<string, ResyncState>;
  readonly corrupt: readonly ResyncStateReadError[];
} {
  const states = new Map<string, ResyncState>();
  const corrupt: ResyncStateReadError[] = [];
  let names: readonly string[];
  try {
    names = readdirSync(stateDir).filter((name) => name.endsWith(".json"));
  } catch (cause) {
    if (!isNotFound({ cause, stateDir })) {
      corrupt.push(ResyncErrors.stateDirUnreadable({ detail: errorMessage({ error: cause }), stateDir }));
    }
    return { corrupt, states };
  }
  for (const name of names) {
    const recipeId = name.slice(0, -".json".length);
    const state = readResyncState({ recipeId, stateDir });
    if (state.isErr()) {
      corrupt.push(state.error);
    } else if (state.value !== null) {
      states.set(recipeId, state.value);
    }
  }
  return { corrupt, states };
}

/**
 * Persist one target's record.
 *
 * @param stateDir the resync state directory
 * @param state what to remember
 * @returns nothing on success, or the one reason the record could not be written
 */
export function writeResyncState({
  stateDir,
  state,
}: {
  readonly stateDir: string;
  readonly state: ResyncState;
}): Result<null> {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: `resync state ${state.recipeId}`, value: state })}\n`,
      path: statePath({ recipeId: state.recipeId, stateDir }),
    });
  } catch (cause) {
    return err([`could not record the resync outcome for ${state.recipeId}: ${errorMessage({ error: cause })}`]);
  }
  return ok(null);
}
