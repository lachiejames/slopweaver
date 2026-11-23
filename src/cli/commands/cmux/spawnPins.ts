/**
 * The three pins `cmux spawn` settles BEFORE any worktree or workspace effect — `--driver`, `--model` and
 * `--effort` — and the refusals each of them can raise.
 *
 * Split out of `./run.ts` as its own seam, which is what it always was: every function here is a decision
 * about the argv alone, reachable before a single directory is created, so re-running with the right flags
 * costs nothing. `./spawnWorktreeOptions.ts` is the sibling leaf with the same shape for the provisioning
 * flags.
 */
import { modelTierAdvisory, opusSpawnEffort, spawnModelRefusal } from "../../../cmux/modelPin.js";
import type { CmuxDriver } from "../../../cmux/pickupCommand.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";

import { resolveCmuxDriver, resolveSpawnEffort, stringFlag } from "./core.js";

/** The boot-time pins one spawn carries, once every refusal below has declined to fire. */
export interface SpawnPins {
  readonly driver: CmuxDriver;
  /** The `--effort` level: the one passed, else {@link defaultSpawnEffort}'s, absent when that is none too. */
  readonly effort?: string;
}

/**
 * The refusals that need the argv alone and no host: a `--model` that is missing or is Fable without the
 * override (`cmux/modelPin.ts`'s header carries the measurement and the owner's ruling), and an `--effort` that
 * names a level `claude` does not accept. Run ahead of the plan register read an omitted `--driver` makes, so a
 * spawn refused on its argv never waits on the store, and an unreadable register never masks one of these.
 *
 * @param parsed the verb's parsed flags
 * @param slug the doc's slug, for the re-run line
 * @returns the pinned model and the passed effort, or the exit code to stop on
 */
export function refuseSpawnArgv({
  parsed,
  slug,
}: {
  parsed: ParsedFlags;
  slug: string;
}): { readonly effort: string | undefined; readonly model: string } | number {
  const model = stringFlag({ name: "model", parsed });
  const refusal = spawnModelRefusal({ env: process.env, model, slug });
  if (refusal !== undefined) {
    logger.error({ msg: `cmux spawn: ${refusal}` });
    return EXIT_USAGE;
  }
  const effort = resolveSpawnEffort({ parsed });
  if ("error" in effort) {
    logger.error({ msg: `cmux spawn: ${effort.error}` });
    return EXIT_USAGE;
  }
  return { effort: effort.effort, model: model! };
}

/**
 * The refusals that need the host: an unknown `--driver`, and an `--effort` passed to a `codex` spawn that has
 * nowhere to put it. Refusing here keeps re-running with the right flags free.
 *
 * @param argvPins the model and effort {@link refuseSpawnArgv} already let through
 * @param defaultDriver the host an omitted `--driver` boots on, read off the register (`./spawnDriver.ts`)
 * @param parsed the verb's parsed flags
 * @returns the pins to boot with, or the exit code to stop on
 */
export function resolveSpawnPins({
  argvPins,
  defaultDriver,
  parsed,
}: {
  argvPins: { readonly effort: string | undefined; readonly model: string };
  defaultDriver: CmuxDriver;
  parsed: ParsedFlags;
}): SpawnPins | number {
  const resolvedDriver = resolveCmuxDriver({ defaultDriver, parsed });
  if ("error" in resolvedDriver) {
    logger.error({ msg: `cmux spawn: ${resolvedDriver.error}` });
    return EXIT_USAGE;
  }
  const { effort, model } = argvPins;
  const clash = codexEffortRefusal({ driver: resolvedDriver.driver, effort });
  if (clash !== undefined) {
    logger.error({ msg: `cmux spawn: ${clash}` });
    return EXIT_USAGE;
  }
  const defaulted = defaultSpawnEffort({ driver: resolvedDriver.driver, effort, model });
  if (defaulted !== effort) {
    logger.info({ msg: `cmux spawn: --model ${model} with no --effort boots at --effort ${defaulted!}` });
  }
  // The effort is resolved ONCE, here, and travels as a value — never re-read at the plan site. `--model` is
  // re-read there because it is required and so cannot be absent; an optional pin has no such guarantee, and
  // a second read is a second chance to disagree with the one the refusals were computed from.
  return { driver: resolvedDriver.driver, ...(defaulted === undefined ? {} : { effort: defaulted }) };
}

/**
 * The `--effort` a spawn boots at: the one it was given, else `OPUS_SPAWN_EFFORT` for an Opus spawn on the
 * claude driver, else none.
 *
 * Defaulted here, at the one door every CLI spawn passes through, because an Opus 5.5 seat that names no
 * `--effort` runs at `medium` whatever the saved `effortLevel` says (`cmux/modelPin.ts` carries the
 * measurement). A caller that names a level keeps it; the substitution is printed by {@link resolveSpawnPins}.
 *
 * @internal — exported for its own unit test; {@link resolveSpawnPins} is the only production caller
 * @param driver the already-resolved host this spawn boots
 * @param effort the `--effort` the caller passed, or `undefined` when it passed none
 * @param model the `--model` the spawn pins, already refused-or-not
 * @returns the level to boot at, or `undefined` for no flag
 */
export function defaultSpawnEffort({
  driver,
  effort,
  model,
}: {
  driver: CmuxDriver;
  effort: string | undefined;
  model: string;
}): string | undefined {
  if (effort !== undefined) {
    return effort;
  }
  return opusSpawnEffort({ host: driver === "codex" ? "codex" : "claude-code", model });
}

/**
 * Why a `codex` spawn cannot take an `--effort`, or `undefined` when nothing was asked of it.
 *
 * It REFUSES rather than accepting the value and dropping it: `cmux/spawn.ts`'s boot line for that host is
 * the bare literal `codex --no-alt-screen` with nowhere to put an effort level, so a silent accept would
 * report a successful spawn to an operator who believes a knob was set. Saying the substitution out loud is
 * the rule (`no-silent-fallback`) and a refusal is the honest shape of it.
 *
 * @internal — exported for its own unit test; {@link resolveSpawnPins} is the only production caller
 * @param driver the already-resolved host this spawn boots
 * @param effort the already-validated level, or `undefined` when the flag was not passed
 * @returns the refusal text, or `undefined` when nothing stands in the way
 */
export function codexEffortRefusal({
  driver,
  effort,
}: {
  driver: CmuxDriver;
  effort: string | undefined;
}): string | undefined {
  if (effort === undefined || driver !== "codex") {
    return undefined;
  }
  return (
    `--effort ${effort} cannot be set on a codex spawn: codex boots as \`codex --no-alt-screen\` and has no ` +
    `effort flag, so the level would be accepted and silently dropped. Drop --effort, or spawn this slug on ` +
    `the claude driver`
  );
}

/**
 * The `--model` this spawn pins — already refused-or-not by {@link refuseSpawnArgv}, so here it is a string
 * — with the doc's own tier advice printed beside it when the two disagree.
 *
 * @param doc the doc being spawned, for its `statusSummary:`
 * @param parsed the verb's parsed flags
 * @returns the `--model` value
 */
export function resolveSpawnModel({ doc, parsed }: { doc: HandoverDoc; parsed: ParsedFlags }): string {
  // `refuseSpawnArgv` ran first in `resolveSpawnTarget`, so an absent `--model` cannot reach here.
  const model = stringFlag({ name: "model", parsed })!;
  const advisory = modelTierAdvisory({ model, slug: doc.slug, statusSummary: doc.statusSummary });
  if (advisory !== undefined) {
    logger.error({ msg: `cmux spawn: ${advisory}` });
  }
  return model;
}
