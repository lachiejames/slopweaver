/**
 * THE CHAIR POLICY — which model the supervisor chair must be on, decided by how many Claude plans still stand.
 *
 * ## The owner's ruling this carries
 *
 * "keep capacity-maxxing for as long as we have these plans, then use capacity saving tactics when on 1 plan". For
 * the chair that is AGENTS.md rule 5: while more than one Claude plan stands the chair is on Fable and sweeps on a
 * timer; once exactly one stands it is on Opus and wakes on an event (an owner turn, a seat's message); with none
 * standing no Claude chair is valid at all. `../plans/laneShape.ts` judges the lane; this maps it to a requirement.
 *
 * ## Nothing switches on silence
 *
 * An unreadable register and a lane with no row at all both require Fable, today's rule, because neither measured
 * a lapse: a gate that seated Opus on a register it could not read would switch the chair on no evidence.
 *
 * ## Exactly one model passes
 *
 * Under lean, a Fable chair does NOT pass. The point of the lean shape is to stop spending the last plan's top-model
 * allowance on the chair, so a Fable chair there is the defect, and the restore types `/model opus`, never
 * `/model fable` (`./chairRestore.ts`).
 *
 * Pure: a lane read in, a requirement and its words out.
 */
import type { LaneShapeRead } from "../plans/laneShape.js";
import { type ChairVerdict, FABLE_MODEL_ALIAS } from "./chairModel.js";

/** The model families a chair can be required to run on. */
export type ChairModelFamily = "fable" | "opus";

/** What the chair must be on, with the one clause saying why. */
export type ChairRequirement =
  | { readonly kind: "claude"; readonly model: ChairModelFamily; readonly why: string }
  | { readonly kind: "claude-unavailable"; readonly why: string };

/** The `/model` argument per family — an alias, so a version bump never sends an id Claude Code no longer knows. */
const MODEL_ALIAS: Readonly<Record<ChairModelFamily, string>> = { fable: FABLE_MODEL_ALIAS, opus: "opus" };

/** The prefix every Opus model id carries. Fable needs none here: `./chairModel.ts` already judged it `on-fable`. */
const OPUS_MODEL_PREFIX = "claude-opus";

/** The family's display name, as a refusal prints it. */
const MODEL_LABEL: Readonly<Record<ChairModelFamily, string>> = { fable: "Fable", opus: "Opus" };

/** Today's rule, the requirement whenever nothing measured a lapse. */
export const FABLE_CHAIR_REQUIREMENT: ChairRequirement = {
  kind: "claude",
  model: "fable",
  why: "more than one Claude plan stands",
};

/**
 * The requirement a lane read puts on the chair.
 *
 * @param lanes the judged lanes, or why the register could not be read
 * @returns Fable on fill, an unregistered lane or an unreadable register; Opus on lean; no Claude chair on unavailable
 */
export function chairRequirement({ lanes }: { lanes: LaneShapeRead }): ChairRequirement {
  if (lanes.kind === "unreadable") {
    return { kind: "claude", model: "fable", why: `the plan register is unread, so today's rule holds: ${lanes.why}` };
  }
  const claude = lanes.shapes.claude;
  if (claude.mode === "lean") {
    return { kind: "claude", model: "opus", why: "exactly one Claude plan stands, so the chair runs lean" };
  }
  if (claude.mode === "unavailable") {
    return { kind: "claude-unavailable", why: "no Claude plan stands, so no Claude chair is valid" };
  }
  if (claude.mode === "unregistered") {
    return { kind: "claude", model: "fable", why: "no Claude plan is registered, so today's rule holds" };
  }
  return FABLE_CHAIR_REQUIREMENT;
}

/**
 * Whether the chair re-arms a timer sweep this tick: `armed` is today's shape; `event-woken` is the lean shape,
 * where no wakeup is armed and the chair runs when the owner speaks or a seat's message arrives. Nothing new
 * delivers those events — they already reach a running chair as turns, which is all the lean shape relies on.
 */
export type SweepArmDecision = { readonly kind: "armed" } | { readonly kind: "event-woken"; readonly why: string };

/**
 * Decide whether the sweep re-arms on a timer.
 *
 * @param lanes the lanes the chair gate read, or undefined when it read none (a usage read, a Codex chair)
 * @returns event-woken on a lean Claude lane only; armed on every other read, an absent one included
 */
export function sweepArmDecision({ lanes }: { lanes: LaneShapeRead | undefined }): SweepArmDecision {
  if (lanes === undefined || lanes.kind === "unreadable" || lanes.shapes.claude.mode !== "lean") {
    return { kind: "armed" };
  }
  return {
    kind: "event-woken",
    why:
      "exactly one Claude plan stands, so the chair runs lean: no timer sweep is armed, and it wakes on the " +
      "owner's next turn or a seat's message",
  };
}

/**
 * The family a verdict's model belongs to, or none when it is neither Fable nor Opus.
 *
 * @param verdict one session's verdict, never unreadable
 * @returns the family, or undefined for any other model
 */
function verdictFamily({
  verdict,
}: {
  verdict: Exclude<ChairVerdict, { kind: "unreadable" }>;
}): ChairModelFamily | undefined {
  if (verdict.kind === "on-fable") {
    return "fable";
  }
  if (verdict.model.startsWith(OPUS_MODEL_PREFIX)) {
    return "opus";
  }
  return undefined;
}

/**
 * Whether one session's verdict meets the required model.
 *
 * @param verdict the session's verdict
 * @param model the family the requirement names
 * @returns meets, violates, or unread when the transcript said nothing
 */
export function verdictAgainst({
  verdict,
  model,
}: {
  verdict: ChairVerdict;
  model: ChairModelFamily;
}): "meets" | "violates" | "unread" {
  if (verdict.kind === "unreadable") {
    return "unread";
  }
  return verdictFamily({ verdict }) === model ? "meets" : "violates";
}

/**
 * The `/model` line that moves a seat onto a family.
 *
 * @param model the target family
 * @returns the slash command to type
 */
export function restoreCommandFor({ model }: { model: ChairModelFamily }): string {
  return `/model ${MODEL_ALIAS[model]}`;
}

/**
 * The family's display name.
 *
 * @param model the family
 * @returns `Fable` or `Opus`
 */
export function chairModelLabel({ model }: { model: ChairModelFamily }): string {
  return MODEL_LABEL[model];
}

/**
 * The alias a fresh chair is spawned with.
 *
 * @param model the family
 * @returns the `--model` argument
 */
export function chairModelAlias({ model }: { model: ChairModelFamily }): string {
  return MODEL_ALIAS[model];
}
