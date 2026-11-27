/**
 * Which plan a session was started on, and every reading that choice was made from — the control plane's own record of
 * the decision, kept on the session's ledger row (`./session.ts`) so it is never re-derived later from a store path.
 *
 * It is built INSIDE the routing decision, while the readings are still in scope (`../claude/planChoiceOf.ts` for a
 * Claude seat, `../codex/seatPlanChoice.ts` for a Codex one), carried unchanged on the plan and the launch spec, and
 * written by the one ledger writer (`../sessionHarness/recordingHarness.ts`).
 *
 * **Aliases and readings only.** No field carries an account address, an organisation, a store or token path, or a
 * credential: a reading is composed from an alias, percentages, a typed kind and ISO instants. The decoder holds that
 * line too — a string carrying `@`, `/` or `\` is refused, so a row that leaked one is unreadable rather than shown.
 */
import { z } from "zod";

/** Where one plan stood in the decision. */
type PlanChoiceState = "chosen" | "eligible" | "excluded" | "unreadable";

/** One plan's reading, as the decision used it. */
export interface PlanChoiceReading {
  /** The plan's alias — never its account address or store. */
  readonly alias: string;
  readonly state: PlanChoiceState;
  /** What was read, e.g. `fable-week 44%, all-models week 30%`, or the exclusion's kind and its figures. */
  readonly reading: string;
  /** When the reading was taken, ISO-8601, when it was a live gauge. */
  readonly observedAtIso?: string;
}

/** How the plan came to be the one: chosen by routing, a standing pin, named by `--plan`, or kept by a resume. */
type PlanChoiceBasis = "routed" | "pinned" | "requested" | "resumed";

/** The plan a session started on, and why — or that no plan decided it at all. */
export type SessionPlanChoice =
  | {
      readonly kind: "named";
      readonly vendor: "claude" | "codex";
      readonly alias: string;
      readonly basis: PlanChoiceBasis;
      readonly reason: string;
      /** Every reading the decision used, each plan exactly once. */
      readonly readings: readonly PlanChoiceReading[];
      /** How to make the other choice, e.g. `--plan <alias>`. */
      readonly alternative: string;
    }
  | {
      /** No plan's store decided what the session spends: nothing is registered, or an API key outranks every store. */
      readonly kind: "ambient";
      readonly vendor: "claude";
      readonly reason: string;
      readonly alternative: string;
    };

/** A string that carries no address, path or credential separator — the one shape every field may take. */
const safeText = z
  .string()
  .min(1)
  .refine((text) => !/[@/\\]/u.test(text), { message: "carries an address or a path separator" });

const readingSchema = z.strictObject({
  alias: safeText,
  observedAtIso: safeText.optional(),
  reading: safeText,
  state: z.enum(["chosen", "eligible", "excluded", "unreadable"]),
});

const choiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    alias: safeText,
    alternative: safeText,
    basis: z.enum(["routed", "pinned", "requested", "resumed"]),
    kind: z.literal("named"),
    readings: z.array(readingSchema),
    reason: safeText,
    vendor: z.enum(["claude", "codex"]),
  }),
  z.strictObject({ alternative: safeText, kind: z.literal("ambient"), reason: safeText, vendor: z.literal("claude") }),
]);

/**
 * A ledger row's `planChoice` field, decoded strictly: an unknown key, a missing field or a string carrying an address
 * or a path is refused, never trimmed to what fits.
 *
 * @param value the field as the line carried it, known to be present
 * @returns the choice, or `undefined` when it is malformed
 */
export function decodePlanChoice({ value }: { value: unknown }): SessionPlanChoice | undefined {
  const parsed = choiceSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  const choice = parsed.data;
  if (choice.kind === "ambient") {
    return { alternative: choice.alternative, kind: "ambient", reason: choice.reason, vendor: "claude" };
  }
  return {
    alias: choice.alias,
    alternative: choice.alternative,
    basis: choice.basis,
    kind: "named",
    readings: choice.readings.map((reading): PlanChoiceReading => ({
      alias: reading.alias,
      reading: reading.reading,
      state: reading.state,
      ...(reading.observedAtIso === undefined ? {} : { observedAtIso: reading.observedAtIso }),
    })),
    reason: choice.reason,
    vendor: choice.vendor,
  };
}

/** One reading as the line prints it. */
function readingText({ reading }: { reading: PlanChoiceReading }): string {
  const at = reading.observedAtIso === undefined ? "" : `, read ${reading.observedAtIso}`;
  return `${reading.alias} ${reading.state} (${reading.reading}${at})`;
}

/**
 * The one line a session's plan choice reads as, beside its row (rule 7: one line, aliases and figures only).
 *
 * @param choice the recorded choice
 * @returns the line
 */
export function planChoiceLine({ choice }: { choice: SessionPlanChoice }): string {
  if (choice.kind === "ambient") {
    return `plan: ambient ${choice.vendor} login — ${choice.reason}; alternative: ${choice.alternative}`;
  }
  const readings =
    choice.readings.length === 0 ? "none" : choice.readings.map((reading) => readingText({ reading })).join(", ");
  return `plan: ${choice.alias} (${choice.vendor}, ${choice.basis}) — ${choice.reason}; readings: ${readings}; alternative: ${choice.alternative}`;
}
