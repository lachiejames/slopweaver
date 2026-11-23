/**
 * What `supervisor tick close` reads before it decides anything: the seat, the tick it closes, the chair's
 * tick file validated, what an earlier run of the same close recorded, and what `tick open` captured. Every
 * refusal names the file and the field.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { DRAFTED_SOURCE_KINDS } from "../../../supervisor/tickDraftShapes.js";
import { parseTickInput, type TickInput } from "../../../supervisor/tickInput.js";
import {
  type CloseStage,
  type CloseState,
  nextTickNumber,
  parseCloseState,
  sha256Hex,
  stagesOwed,
  tickIdOf,
} from "../../../supervisor/tickPlan.js";
import type { TickSeat } from "../../../supervisor/tickSeat.js";
import { type TickWorkflowError, TickWorkflowErrors } from "../../../supervisor/tickWorkflowErrors.js";
import type { TickCloseArgs } from "./tickCore.js";
import type { SupervisorTickDeps } from "./tickDeps.js";
import { directoryIdentity, parseJsonText, readJson, readSeat, readStrictText, TICK_INPUT_FILE } from "./tickFiles.js";

/** The part of `capture.json` a close reads. */
const captureSchema = z.object({
  capturedIso: z.string(),
  readings: z.array(
    z.object({
      bytes: z.number(),
      completed: z.boolean(),
      draftSource: z.enum(DRAFTED_SOURCE_KINDS).optional(),
      file: z.string(),
      name: z.string(),
    }),
  ),
  startedIso: z.string(),
});

/** Everything a close read and validated, before it proposes anything. */
export interface CloseRead {
  readonly dir: string;
  readonly seat: TickSeat;
  readonly tickDir: string;
  /** The tick directory's device and inode when the close read it — see `tickDirIntact`. */
  readonly tickDirIdentity: string;
  readonly tickId: string;
  readonly nowIso: string;
  readonly inputPath: string;
  readonly input: TickInput;
  readonly inputSha256: string;
  /** The tick file's device and inode when it was validated — the commit compares it with the hash. */
  readonly inputIdentity: string;
  readonly state: CloseState | undefined;
  readonly owed: readonly CloseStage[];
  readonly capture: z.output<typeof captureSchema>;
  readonly reconcile: unknown;
  readonly reconcilePath: string;
}

/**
 * The tick a close acts on: the one named, or the highest in the seat's directory.
 *
 * @returns the tick number, or why there is none
 */
function closingTick({ args, dir }: { args: TickCloseArgs; dir: string }): Result<number, TickWorkflowError> {
  if (args.tick !== undefined) {
    return ok(args.tick);
  }
  const next = nextTickNumber({ names: readdirSync(dir) });
  if (next === 1) {
    return err(TickWorkflowErrors.captureInvalid({ path: dir, reason: "holds no tick-<n> — run `tick open` first" }));
  }
  return ok(next - 1);
}

/**
 * The chair's tick file: its bytes' digest, and the document validated.
 *
 * @returns the validated input, or every malformed field named
 */
function readTickFile({
  tickDir,
  nowIso,
}: {
  tickDir: string;
  nowIso: string;
}): Result<{ input: TickInput; inputIdentity: string; inputPath: string; inputSha256: string }, TickWorkflowError> {
  const inputPath = join(tickDir, TICK_INPUT_FILE);
  const text = readStrictText({ path: inputPath });
  if (text.isErr()) {
    return err(TickWorkflowErrors.captureInvalid({ path: inputPath, reason: text.error }));
  }
  // ONE read: the bytes hashed are the bytes validated, so no edit between two reads can pair them apart.
  const { identity: inputIdentity, text: validated } = text.value;
  return parseJsonText({ path: inputPath, text: validated })
    .mapErr((issue) => TickWorkflowErrors.inputInvalid({ issues: [issue] }))
    .andThen((value) => parseTickInput({ recordedIso: nowIso, value }))
    .map((input) => ({ input, inputIdentity, inputPath, inputSha256: sha256Hex({ text: validated }) }));
}

/**
 * What an earlier run of this close recorded, and so which stages this run still owes.
 *
 * @returns the state and the stages left, or a conflict with a different input
 */
function readCloseState({
  tickDir,
  inputSha256,
  tickId,
}: {
  tickDir: string;
  inputSha256: string;
  tickId: string;
}): Result<{ state: CloseState | undefined; owed: readonly CloseStage[] }, TickWorkflowError> {
  const path = join(tickDir, "close-state.json");
  if (!existsSync(path)) {
    return stagesOwed({ inputSha256, state: undefined, tickId }).map((owed) => ({ owed, state: undefined }));
  }
  return readJson({ path })
    .mapErr((reason) => TickWorkflowErrors.captureInvalid({ path, reason }))
    .andThen((value) => parseCloseState({ path, value }))
    .andThen((state) => stagesOwed({ inputSha256, state, tickId }).map((owed) => ({ owed, state })));
}

/**
 * What `tick open` captured: its manifest and the reconciliation every close needs.
 *
 * @returns both, or the file that would not read
 */
function readCaptured({
  tickDir,
}: {
  tickDir: string;
}): Result<{ capture: z.output<typeof captureSchema>; reconcile: unknown; reconcilePath: string }, TickWorkflowError> {
  const capturePath = join(tickDir, "capture.json");
  const reconcilePath = join(tickDir, "reconcile.json");
  const capture = readJson({ path: capturePath }).andThen((value) => {
    const parsed = captureSchema.safeParse(value);
    return parsed.success ? ok(parsed.data) : err(`${capturePath}: ${parsed.error.message}`);
  });
  if (capture.isErr()) {
    return err(TickWorkflowErrors.captureInvalid({ path: capturePath, reason: capture.error }));
  }
  return readJson({ path: reconcilePath })
    .mapErr((reason) => TickWorkflowErrors.captureInvalid({ path: reconcilePath, reason }))
    .map((reconcile) => ({ capture: capture.value, reconcile, reconcilePath }));
}

/**
 * Read and validate everything a close decides from.
 *
 * @returns the reads, or the first refusal
 */
export function readClose({
  args,
  deps,
}: {
  args: TickCloseArgs;
  deps: SupervisorTickDeps;
}): Result<CloseRead, TickWorkflowError> {
  const dir = resolve(args.dir);
  const seat = readSeat({ dir });
  if (seat.isErr()) {
    return err(seat.error);
  }
  const tick = closingTick({ args, dir });
  if (tick.isErr()) {
    return err(tick.error);
  }
  const tickDir = join(dir, `tick-${String(tick.value)}`);
  const tickDirIdentity = directoryIdentity({ path: tickDir });
  if (tickDirIdentity === undefined) {
    return err(
      TickWorkflowErrors.captureInvalid({
        path: tickDir,
        reason: "is not a real directory — a link here would aim the close's scratch writes elsewhere",
      }),
    );
  }
  const tickId = tickIdOf({ handoff: seat.value.handoff, tick: tick.value });
  const nowIso = deps.scratch.now();
  const file = readTickFile({ nowIso, tickDir });
  if (file.isErr()) {
    return err(file.error);
  }
  const closeState = readCloseState({ inputSha256: file.value.inputSha256, tickDir, tickId });
  if (closeState.isErr()) {
    return err(closeState.error);
  }
  return readCaptured({ tickDir }).map((captured) => ({
    ...captured,
    ...closeState.value,
    ...file.value,
    dir,
    nowIso,
    seat: seat.value,
    tickDir,
    tickDirIdentity,
    tickId,
  }));
}
