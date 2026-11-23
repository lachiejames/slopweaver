/**
 * The owner's STANDING asks — the words a Queue card rests on when no particular steer of the owner's produced it —
 * the pure half of `slopweaver profile standing`, and what every unsteered Queue card quotes
 * (`site/lib/standingAskSource.ts`).
 *
 * Pretty much every card can carry a quote, even an organization-intelligence finding: an earlier standing ask such
 * as finding anything in any department that is impacting the business is useful to see, and it clarifies that the
 * card is not based on any other particular steer.
 *
 * So a standing ask is the owner's real words, read off their anchor by the same resolver `handover quote` uses, never typed
 * by a session, plus the cards it COVERS. Three rules hold the register honest:
 *
 * - **One card, one standing ask.** No coverage is held by two active asks — refused at the write, a defect at the
 *   read — so a card never has two to choose between and nothing picks by order or date.
 * - **Coverage is exact.** `act:<kind>` names one autonomy kind by string equality, so an auto-merge ruling never
 *   becomes the standing ask behind every act the fleet takes.
 * - **Append-only.** A withdrawal is a line, so every quote that ever stood behind a card stays findable.
 *
 * Pure: lines in, values out.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import type { HisWords } from "../handover/hisWords.js";
import { type StandingAskError, StandingAskErrors } from "./standingAskErrors.js";

/**
 * The cards a standing ask can stand behind, as each is decided in `site/lib/standingAskSource.ts`:
 *
 * - `findings` — a fleet finding, on its own card or on a card belonging to its row;
 * - `registered-rows` — a row a session put on the board recording no words of the owner's behind it;
 * - `bot-replies` — a bot reply held for someone else;
 * - `unlinked-cards` — a hand step, parked draft, review or pull request naming no board row;
 * - `act:<kind>` — an act of exactly that autonomy kind naming no board row.
 */
const STANDING_COVERAGES = ["findings", "registered-rows", "bot-replies", "unlinked-cards"] as const;

/** The autonomy kind grammar `src/autonomy/types.ts` holds an act's `kind` to, which `act:<kind>` names. */
const ACT_KIND = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/u;

/** A standing ask's id: the same slug shape a board row takes, so it reads in a sentence and a flag alike. */
export const STANDING_ASK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** One standing ask as the register folds it. */
export interface StandingAsk {
  readonly id: string;
  /** The owner's words, read off `quote.anchor` by `src/handover/hisWordsResolve.ts`. */
  readonly quote: HisWords;
  /** The cards it stands behind, each a {@link STANDING_COVERAGES} member or `act:<kind>`. */
  readonly covers: readonly string[];
  readonly recordedAtIso: string;
}

/** One journal line. */
export type StandingAskEvent =
  | ({ readonly kind: "recorded" } & StandingAsk)
  | { readonly kind: "withdrawn"; readonly id: string; readonly withdrawnAtIso: string; readonly reason: string };

/**
 * Whether a coverage is one the register knows.
 *
 * @param coverage one `--covers` entry
 * @returns true for a named coverage or an `act:` followed by a kind the autonomy ledger could hold
 */
export function isStandingCoverage({ coverage }: { coverage: string }): boolean {
  if (STANDING_COVERAGES.some((one) => one === coverage)) {
    return true;
  }
  return coverage.startsWith("act:") && ACT_KIND.test(coverage.slice("act:".length));
}

const instant = z.iso.datetime({ offset: true });

/**
 * Whether a string is an instant this register records, the one grammar every `…AtIso` field is read with.
 *
 * @param value the candidate instant
 * @returns true for an ISO date-time carrying `Z` or an offset
 */
export function isStandingAskInstant({ value }: { value: string }): boolean {
  return instant.safeParse(value).success;
}

const quoteSchema = z.strictObject({
  anchor: z.string().min(1),
  atIso: instant,
  cut: z.enum(["none", "start", "end"]),
  where: z.enum(["console-typed", "console-voice", "call", "call-landing", "session"]),
  words: z.string().min(1),
});

const eventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    covers: z.array(z.string().refine((coverage) => isStandingCoverage({ coverage }))).min(1),
    id: z.string().regex(STANDING_ASK_ID),
    kind: z.literal("recorded"),
    quote: quoteSchema,
    recordedAtIso: instant,
  }),
  z.strictObject({
    id: z.string().regex(STANDING_ASK_ID),
    kind: z.literal("withdrawn"),
    reason: z.string().min(1),
    withdrawnAtIso: instant,
  }),
]);

/**
 * One event as the journal line it is written as.
 *
 * @returns the line, no trailing newline
 */
export function standingAskLine({ event }: { event: StandingAskEvent }): string {
  return JSON.stringify(event);
}

/**
 * Whether recording `ask` over the active register keeps it whole: a fresh id, known coverage none repeated, and no
 * coverage another active ask already holds.
 *
 * @param active the asks standing now
 * @param ask the ask about to be recorded
 * @returns `true`, or the first way it would break the register
 */
export function admitStandingAsk({
  active,
  ask,
}: {
  active: readonly StandingAsk[];
  ask: StandingAsk;
}): Result<true, StandingAskError> {
  if (active.some((one) => one.id === ask.id)) {
    return err(StandingAskErrors.duplicateId({ id: ask.id }));
  }
  const unknown = ask.covers.find((coverage) => !isStandingCoverage({ coverage }));
  if (unknown !== undefined) {
    return err(StandingAskErrors.coverageUnknown({ coverage: unknown }));
  }
  for (const coverage of ask.covers) {
    const held = active.find((one) => one.covers.includes(coverage));
    if (held !== undefined) {
      return err(StandingAskErrors.coverageOverlap({ coverage, held: held.id }));
    }
  }
  const repeated = ask.covers.find((coverage, at) => ask.covers.indexOf(coverage) !== at);
  if (repeated !== undefined) {
    return err(StandingAskErrors.coverageOverlap({ coverage: repeated, held: ask.id }));
  }
  return ok(true);
}

/**
 * Fold the journal into the asks standing now, in the order they were recorded. A line that does not read refuses the
 * whole fold rather than being skipped: it could be the withdrawal of an ask a card would otherwise quote.
 *
 * @param lines the journal, one event per line
 * @returns the active asks, or the first line that breaks the register
 */
export function foldStandingAsks({
  lines,
}: {
  lines: readonly string[];
}): Result<readonly StandingAsk[], StandingAskError> {
  let active: readonly StandingAsk[] = [];
  for (const [at, line] of lines.entries()) {
    if (line.trim() === "") {
      continue;
    }
    const event = parseStandingAskEvent({ line, number: at + 1 });
    if (event.isErr()) {
      return err(event.error);
    }
    const applied = applyStandingAskEvent({ active, event: event.value });
    if (applied.isErr()) {
      return err(applied.error);
    }
    active = applied.value;
  }
  return ok(active);
}

/**
 * One journal line as an event, or why it is not one.
 *
 * @param line the line, as the journal holds it
 * @param number its 1-based place in the journal, named in a refusal
 * @returns the event, or `LINE_UNREADABLE`
 */
export function parseStandingAskEvent({
  line,
  number,
}: {
  line: string;
  number: number;
}): Result<StandingAskEvent, StandingAskError> {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return err(StandingAskErrors.lineUnreadable({ line: number, why: "not JSON" }));
  }
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) {
    const why = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    return err(StandingAskErrors.lineUnreadable({ line: number, why }));
  }
  return ok(parsed.data);
}

/**
 * The active asks after one event: a withdrawal removes its ask, a recording is admitted and appended.
 *
 * @param active the asks standing before it
 * @returns the asks standing after it, or why the event breaks the register
 */
export function applyStandingAskEvent({
  active,
  event,
}: {
  active: readonly StandingAsk[];
  event: StandingAskEvent;
}): Result<readonly StandingAsk[], StandingAskError> {
  if (event.kind === "withdrawn") {
    if (!active.some((one) => one.id === event.id)) {
      return err(StandingAskErrors.unknownWithdrawal({ id: event.id }));
    }
    return ok(active.filter((one) => one.id !== event.id));
  }
  const ask: StandingAsk = {
    covers: event.covers,
    id: event.id,
    quote: event.quote,
    recordedAtIso: event.recordedAtIso,
  };
  return admitStandingAsk({ active, ask }).map(() => [...active, ask]);
}
