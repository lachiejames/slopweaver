/**
 * The pure half of `supervisor tick open|close`: which tick is next, what the capture already witnesses, how a
 * validated tick file becomes a sweep-block edit, and which commit stages a close still owes.
 *
 * ## Why close is staged rather than atomic
 *
 * A close writes five different files — the archive, the form, the two refreshed snapshots, the published
 * page and its freeze, and one ledger line — and no primitive commits them together. So the promise is the
 * one this module can keep: EVERY validation runs before the first durable write, then each stage is recorded
 * in `close-state.json` as it completes, and re-running the same close resumes at the first stage it has not
 * done. A different input after any committed stage is refused by hash, because resuming it would publish
 * one sweep's page over another sweep's tick row.
 *
 * The state binds BOTH things the committed stages were decided against: the tick file (`inputSha256`) and the owner's
 * list as staged at `tick-<n>/run.json` (`listSha256`, `null` when the render read the seat's own list and nothing
 * was staged). A resume whose staged list no longer hashes to the recorded digest — a rewrite, a hard link — is
 * refused rather than rendered as the list the close decided on (`../cli/commands/supervisor/tickCloseListPolicy.ts`).
 *
 * Pure — no clock, no filesystem.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import type { SweepBlockInput } from "../briefing/sweepBlock.js";
import type { AuthoredAction, TickInput } from "./tickInput.js";
import type { TickSeat } from "./tickSeat.js";
import { type TickWorkflowError, TickWorkflowErrors } from "./tickWorkflowErrors.js";

/** A tick directory's name: `tick-<digits>`. */
const TICK_DIR = /^tick-(\d+)$/u;

/**
 * The next tick number in a seat's scratch directory: one past the highest `tick-<n>` there, or 1.
 *
 * Only exact `tick-<digits>` names count, so a `tick-618b` rerun directory or a `tick-draft.log` never
 * moves the count.
 *
 * @param names the directory's immediate entries
 * @returns the next tick number
 */
export function nextTickNumber({ names }: { names: readonly string[] }): number {
  const numbers = names.flatMap((name) => {
    const match = TICK_DIR.exec(name);
    return match === null ? [] : [Number(match[1])];
  });
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

/**
 * The tick ledger's id for one tick, in the shape the chair has always written: `<handoff>-tick-<n>`.
 *
 * @param handoff the seat's handoff
 * @param tick the tick number
 * @returns the id
 */
export function tickIdOf({ handoff, tick }: { handoff: string; tick: number }): string {
  return `${handoff}-tick-${String(tick)}`;
}

/**
 * The actions a landing reading already witnesses — each press and each registration it made — so the
 * chair's template carries them rather than the chair retyping what the verb did.
 *
 * A `would-*` or `skipped` outcome is not an act and is left out; a `failed` one IS recorded, as failed,
 * because a press that failed is exactly what the next tick has to see.
 *
 * @param landing the landing reading's parsed JSON
 * @param witnessPath the reading's file, which witnesses every action taken from it
 * @returns the actions, presses first
 */
export function landingActions({
  landing,
  witnessPath,
}: {
  landing: unknown;
  witnessPath: string;
}): readonly AuthoredAction[] {
  if (!isRecord(landing) || landing["kind"] === "skipped") {
    return [];
  }
  const presses = Array.isArray(landing["presses"]) ? landing["presses"] : [];
  const registrations = Array.isArray(landing["registrations"]) ? landing["registrations"] : [];
  const witness = { kind: "artifact" as const, ref: witnessPath };
  const pressed = presses.filter(isRecord).flatMap((press): AuthoredAction[] => {
    const outcome = pressOutcome({ outcome: press["outcome"] });
    const reference = referenceOf({ entry: press });
    if (outcome === undefined || reference === undefined) {
      return [];
    }
    return [
      {
        actionId: `landing-press-${reference.label}`,
        detail: `github landing --press: ${String(press["detail"])}`,
        kind: "enqueued",
        outcome,
        subject: { id: reference.url, kind: "pull-request", label: reference.label },
        witness,
      },
    ];
  });
  const registered = registrations.filter(isRecord).flatMap((registration): AuthoredAction[] => {
    const outcome = registrationOutcome({ outcome: registration["outcome"] });
    const reference = referenceOf({ entry: registration });
    const slug = registration["slug"];
    if (outcome === undefined || reference === undefined || typeof slug !== "string" || slug.length === 0) {
      return [];
    }
    return [
      {
        actionId: `landing-register-${reference.label}`,
        detail: `github landing --register: ${String(registration["detail"])}`,
        kind: "state-amended",
        outcome,
        subject: { id: slug, kind: "handover", label: reference.label },
        witness,
      },
    ];
  });
  return [...pressed, ...registered];
}

/**
 * A press's outcome in the ledger's vocabulary.
 *
 * @returns completed, failed, or undefined for an outcome that is not an act
 */
function pressOutcome({ outcome }: { outcome: unknown }): "completed" | "failed" | undefined {
  if (outcome === "pressed") {
    return "completed";
  }
  return outcome === "failed" ? "failed" : undefined;
}

/**
 * A registration's outcome in the ledger's vocabulary.
 *
 * @returns completed, failed, or undefined for an outcome that is not an act
 */
function registrationOutcome({ outcome }: { outcome: unknown }): "completed" | "failed" | undefined {
  if (outcome === "registered") {
    return "completed";
  }
  return outcome === "failed" ? "failed" : undefined;
}

/**
 * The `owner/name#n` label and permalink a landing entry names.
 *
 * @returns both, or undefined when the entry does not carry them
 */
function referenceOf({
  entry,
}: {
  entry: Readonly<Record<string, unknown>>;
}): { label: string; url: string } | undefined {
  const { repoSlug, number, url } = entry;
  if (typeof repoSlug !== "string" || typeof number !== "number" || typeof url !== "string") {
    return undefined;
  }
  return { label: `${repoSlug}#${String(number)}`, url };
}

/** How many recent blocks a sweep keeps open — `briefing sweep-block`'s own default. */
const TICK_KEEP_RECENT = 4;

/**
 * The sweep-block edit one close makes: the seat's header, the reconciliation's own alignment words, and the
 * chair's typed headline and folds.
 *
 * The alignment headline and intake clause are READ off `handover reconcile --json`, never authored — the
 * chair's script piped both through `jq -r` into flags, and a reconcile that failed read as the literal
 * `null` on the page.
 *
 * @param seat the seat's constants
 * @param input the validated tick file
 * @param reconcile the capture's reconciliation, parsed
 * @param reconcilePath its file, named when a field is missing
 * @returns the edit, or why the reconciliation cannot supply it
 */
export function sweepBlockInputOf({
  seat,
  input,
  reconcile,
  reconcilePath,
}: {
  seat: TickSeat;
  input: TickInput;
  reconcile: unknown;
  reconcilePath: string;
}): Result<SweepBlockInput, TickWorkflowError> {
  const headline = isRecord(reconcile) ? reconcile["headline"] : undefined;
  if (typeof headline !== "string" || headline.trim().length === 0) {
    return err(TickWorkflowErrors.captureInvalid({ path: reconcilePath, reason: "carries no `headline` string" }));
  }
  const intake = isRecord(reconcile) ? reconcile["intakeClause"] : undefined;
  return ok({
    alignment: {
      details: input.alignmentDetails,
      headline,
      intake: typeof intake === "string" && intake.trim().length > 0 ? intake : undefined,
      summary: input.alignmentSummary,
    },
    dropCardPrefixes: input.dropCards,
    earlierSummary: input.earlierSummary,
    header: {
      handoff: seat.handoff,
      lede: input.lede,
      model: seat.model,
      pinnedAt: seat.pinnedAtIso,
      sleeping: input.sleeping,
      workspace: seat.workspace,
    },
    keepRecent: TICK_KEEP_RECENT,
    recent: { folds: input.folds, foldSummary: input.foldSummary, sentences: input.headline },
  });
}

/** Every commit stage, in the order a close performs them. */
export const CLOSE_STAGES = ["form-committed", "snapshots-resolved", "page-published", "tick-recorded"] as const;

/** One commit stage. */
export type CloseStage = (typeof CLOSE_STAGES)[number];

/** A bare lowercase sha256 hex digest. */
const SHA256_HEX = /^[0-9a-f]{64}$/u;

const closeStateSchema = z
  .object({
    done: z.array(z.enum(CLOSE_STAGES)),
    inputSha256: z.string().regex(SHA256_HEX),
    listSha256: z.string().regex(SHA256_HEX).nullable(),
    pageUrl: z.string().optional(),
    schemaVersion: z.literal(2),
    tickId: z.string().min(1),
  })
  .strict();

/**
 * What `close-state.json` records: which input, which staged list (`null` for the seat's own), which stages it has
 * done, and the page it published.
 */
export type CloseState = z.output<typeof closeStateSchema>;

/**
 * A document's sha256, hex.
 *
 * @param text the bytes, as a string
 * @returns the digest
 */
export function sha256Hex({ text }: { text: string }): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Read a `close-state.json`, refusing one this build cannot trust.
 *
 * A version-1 state is refused by name: it recorded no staged-list digest, so nothing can say which list its
 * committed stages saw. Removing it restarts the close safely — `form.before.json` keeps the form proposal stable
 * and `tick-recorded` checks the ledger before appending.
 *
 * @param value the parsed file
 * @param path the file, named in a refusal
 * @returns the state
 */
export function parseCloseState({
  value,
  path,
}: {
  value: unknown;
  path: string;
}): Result<CloseState, TickWorkflowError> {
  if (isRecord(value) && value["schemaVersion"] === 1) {
    return err(
      TickWorkflowErrors.captureInvalid({
        path,
        reason:
          "schemaVersion 1 predates the staged-list digest, so which list its stages saw is unknown — remove this " +
          "close-state to restart the close",
      }),
    );
  }
  const parsed = closeStateSchema.safeParse(value);
  if (!parsed.success) {
    return err(TickWorkflowErrors.captureInvalid({ path, reason: `not a close state: ${parsed.error.message}` }));
  }
  return ok(parsed.data);
}

/**
 * The stages a close still owes, given what an earlier run of it recorded.
 *
 * @param state the recorded state, or undefined for a first close
 * @param inputSha256 this run's tick file's digest
 * @param tickId this run's tick id
 * @returns the stages left, in order — empty when the close already completed — or a hash conflict
 */
export function stagesOwed({
  state,
  inputSha256,
  tickId,
}: {
  state: CloseState | undefined;
  inputSha256: string;
  tickId: string;
}): Result<readonly CloseStage[], TickWorkflowError> {
  if (state === undefined) {
    return ok(CLOSE_STAGES);
  }
  if (state.inputSha256 !== inputSha256 || state.tickId !== tickId) {
    return err(TickWorkflowErrors.closeStateConflict({ actualHash: inputSha256, expectedHash: state.inputSha256 }));
  }
  return ok(CLOSE_STAGES.filter((stage) => !state.done.includes(stage)));
}

/**
 * The state after one more stage completed.
 *
 * @param state the state before it
 * @param stage the stage that completed
 * @param pageUrl the published page, when this stage published it
 * @returns the new state
 */
export function withStageDone({
  state,
  stage,
  pageUrl,
}: {
  state: CloseState;
  stage: CloseStage;
  pageUrl?: string;
}): CloseState {
  return {
    ...state,
    done: state.done.includes(stage) ? state.done : [...state.done, stage],
    ...(pageUrl === undefined ? {} : { pageUrl }),
  };
}
