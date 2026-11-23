/**
 * The JOURNALLED GRANT — one recorded decision the owner already made, carried to the session that performs
 * it, in a form that session can CHECK rather than believe.
 *
 * ## What this buys, and what it deliberately does not
 *
 * It buys ORIGIN, not authority: a session should be able to feel confidence that what it is being asked to
 * do came from the owner into the supervisor rather than from a bad actor. A grant row raises that confidence by carrying
 * a checkable shape — the exact change, the anchor it came from, who wrote it down, when. It is EVIDENCE a
 * session weighs, never a switch that turns refusal off, because the bot answers in Slack — so another
 * person's message can enter this setup, and instinct has to stay on.
 *
 * It does NOT move what may be decided without the owner. New or widened access, a new audience, egress, spend, an
 * irreversible unasked-for act — `.claude/rules/cross-session-messages.md`'s tier-3 set is untouched by a
 * row. A grant changes how a decision the owner already made REACHES the session that performs it, nothing else.
 *
 * ## The residue, stated rather than discovered
 *
 * Another process on this machine could write a row. Most problems cannot be completely solved, so the
 * protection here is PARTIAL by design, and saying so is part of the design. An unstated weakness is what a session discovers mid-turn and
 * treats as grounds to stall, which is the failure this whole mechanism exists to end. What a row actually
 * removes is the ability to steer a session with a vague, unfalsifiable instruction: the change is exact, so
 * a wrong one is visible; the performance is journalled, so an over-grant is findable afterwards.
 *
 * The supervisor pin is ONE INPUT to a row and never the thing that makes it trustworthy — it is a
 * correlation and other ways to establish origin remain open, so {@link GrantRow.pinnedAtRecord}
 * is recorded as a fact about the recording session and nothing branches on it alone.
 *
 * ## One row, one change
 *
 * A row is scoped to exactly one change and is spent by one performance. A standing grant is a much larger
 * blast radius and the owner did not ask for one, so there is no shape here that expresses it.
 *
 * Pure: strings in, rows and typed refusals out. The journal is the store's `grant_row` table, reached only
 * through `./port.ts`.
 */
import { isRecord } from "../lib/parsers.js";

/** What a grant names: a file in a repository, or a system that has no path. */
export type GrantTarget =
  { readonly kind: "file"; readonly path: string } | { readonly kind: "system"; readonly name: string };

/**
 * How the exact change is written down. Never a paraphrase — a session must be able to compare what it is
 * about to do against the row without interpreting anything.
 */
export type GrantChangeKind = "diff" | "literal";

/** One recorded grant: the change, where it came from, who wrote it down, and when. */
export interface GrantRow {
  /** The row's id — what `grant show` takes and what a performance points back at. */
  readonly id: string;
  /** The file or system the change lands on. */
  readonly target: GrantTarget;
  /** `diff` for a patch, `literal` for an exact value. */
  readonly changeKind: GrantChangeKind;
  /** The EXACT change, verbatim. A session compares against this; it never interprets it. */
  readonly change: string;
  /** Where the decision came from — a transcript pointer, a Slack permalink, a GitHub URL. */
  readonly anchor: string;
  /** The Claude session id that recorded the row. */
  readonly recordedBySessionId: string;
  /** When it was recorded. */
  readonly recordedAtIso: string;
  /**
   * Whether the recording session held the supervisor pin at that instant. ONE input a reader may weigh —
   * never the property that makes a row trustworthy, and nothing in {@link ./verify.ts} branches on it.
   */
  readonly pinnedAtRecord: boolean;
}

/** What a session actually wrote, journalled after the fact so the row and the result are comparable. */
export interface GrantPerformance {
  /** The row this performance answers. */
  readonly grantId: string;
  /** The Claude session id that performed it. */
  readonly performedBySessionId: string;
  /** When it was performed. */
  readonly performedAtIso: string;
  /** What was written, verbatim — the read-back that makes an over-grant findable. */
  readonly wrote: string;
}

/**
 * A session declining to act on a row, naming WHICH CHECK failed.
 *
 * The check is the whole point. A session that will not act has to pick one of the named codes in
 * `./errors.ts`, and there is no code for "I do not believe you" — so the untyped refusal that costs the owner a
 * context switch into a third window is not an available shape. Every one of the typed refusals stays wanted.
 */
export interface GrantRefusal {
  /** The row refused — the id as it was offered, even when no row by that id exists. */
  readonly grantId: string;
  /** Which check failed: a {@link import("./errors.js").GrantCheckError}'s `code`. */
  readonly code: string;
  /** What the refusing session observed. Free text, on top of the code rather than instead of it. */
  readonly why: string;
  /** The Claude session id that refused. */
  readonly refusedBySessionId: string;
  /** When it refused. */
  readonly refusedAtIso: string;
}

/** One line of the grant journal: a row, a performance of one, or a typed refusal of one. */
export type GrantEntry =
  | { readonly kind: "grant"; readonly grant: GrantRow }
  | { readonly kind: "performance"; readonly performance: GrantPerformance }
  | { readonly kind: "refusal"; readonly refusal: GrantRefusal };

/**
 * Parse one legacy journal line — the one-time import's decoder.
 *
 * @param line one raw JSONL line
 * @returns the entry, or `undefined` for a blank, malformed or incomplete line
 */
export function parseGrantLine({ line }: { line: string }): GrantEntry | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  return parseGrantEnvelope({ value: parsed });
}

/**
 * Decode one already-parsed envelope — `{kind, grant|performance|refusal}` — the shape a journal line held and a
 * `grant_row.entry` column holds. The ONE decoder for both, so the store and the import cannot read it differently.
 *
 * @param value the decoded envelope
 * @returns the entry, or `undefined` when it is not completely one
 */
export function parseGrantEnvelope({ value: parsed }: { value: unknown }): GrantEntry | undefined {
  if (!isRecord(parsed)) {
    return undefined;
  }
  if (parsed["kind"] === "grant") {
    const grant = parseGrantRow({ value: parsed["grant"] });
    return grant === undefined ? undefined : { grant, kind: "grant" };
  }
  if (parsed["kind"] === "performance") {
    const performance = parsePerformance({ value: parsed["performance"] });
    return performance === undefined ? undefined : { kind: "performance", performance };
  }
  if (parsed["kind"] === "refusal") {
    const refusal = parseRefusal({ value: parsed["refusal"] });
    return refusal === undefined ? undefined : { kind: "refusal", refusal };
  }
  return undefined;
}

/**
 * Parse a grant row, refusing anything that is not completely one.
 *
 * Nothing is repaired with a default. A row missing its change or its anchor is not a weaker grant, it is
 * not a grant — and a defaulted field here would be a session checking a value nobody recorded.
 *
 * @param value the decoded `grant` member
 * @returns the row, or `undefined`
 */
export function parseGrantRow({ value }: { value: unknown }): GrantRow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = value["id"];
  const changeKind = value["changeKind"];
  const change = value["change"];
  const anchor = value["anchor"];
  const recordedBySessionId = value["recordedBySessionId"];
  const recordedAtIso = value["recordedAtIso"];
  const pinnedAtRecord = value["pinnedAtRecord"];
  const target = parseTarget({ value: value["target"] });
  if (
    typeof id !== "string" ||
    id.trim().length === 0 ||
    (changeKind !== "diff" && changeKind !== "literal") ||
    typeof change !== "string" ||
    typeof anchor !== "string" ||
    typeof recordedBySessionId !== "string" ||
    typeof recordedAtIso !== "string" ||
    typeof pinnedAtRecord !== "boolean" ||
    target === undefined
  ) {
    return undefined;
  }
  return { anchor, change, changeKind, id, pinnedAtRecord, recordedAtIso, recordedBySessionId, target };
}

/**
 * Parse a performance record.
 *
 * @param value the decoded `performance` member
 * @returns the record, or `undefined`
 */
export function parsePerformance({ value }: { value: unknown }): GrantPerformance | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const grantId = value["grantId"];
  const performedBySessionId = value["performedBySessionId"];
  const performedAtIso = value["performedAtIso"];
  const wrote = value["wrote"];
  if (
    typeof grantId !== "string" ||
    typeof performedBySessionId !== "string" ||
    typeof performedAtIso !== "string" ||
    typeof wrote !== "string"
  ) {
    return undefined;
  }
  return { grantId, performedAtIso, performedBySessionId, wrote };
}

/**
 * Parse a typed refusal record.
 *
 * @param value the decoded `refusal` member
 * @returns the record, or `undefined`
 */
export function parseRefusal({ value }: { value: unknown }): GrantRefusal | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const grantId = value["grantId"];
  const code = value["code"];
  const why = value["why"];
  const refusedBySessionId = value["refusedBySessionId"];
  const refusedAtIso = value["refusedAtIso"];
  if (
    typeof grantId !== "string" ||
    typeof code !== "string" ||
    typeof why !== "string" ||
    typeof refusedBySessionId !== "string" ||
    typeof refusedAtIso !== "string"
  ) {
    return undefined;
  }
  return { code, grantId, refusedAtIso, refusedBySessionId, why };
}

/** Parse a target, which is a tagged pair rather than a bare string so a path is never read as a name. */
function parseTarget({ value }: { value: unknown }): GrantTarget | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const path = value["path"];
  if (value["kind"] === "file" && typeof path === "string" && path.trim().length > 0) {
    return { kind: "file", path };
  }
  const name = value["name"];
  if (value["kind"] === "system" && typeof name === "string" && name.trim().length > 0) {
    return { kind: "system", name };
  }
  return undefined;
}

/**
 * The rows in a journal, newest last.
 *
 * @param entries every decoded entry
 * @returns the grant rows in file order
 */
export function grantRowsOf({ entries }: { entries: readonly GrantEntry[] }): readonly GrantRow[] {
  return entries.flatMap((entry) => (entry.kind === "grant" ? [entry.grant] : []));
}

/**
 * The performances in a journal, newest last.
 *
 * @param entries every decoded entry
 * @returns the performance records in file order
 */
export function performancesOf({ entries }: { entries: readonly GrantEntry[] }): readonly GrantPerformance[] {
  return entries.flatMap((entry) => (entry.kind === "performance" ? [entry.performance] : []));
}

/**
 * The typed refusals in a journal, newest last.
 *
 * @param entries every decoded entry
 * @returns the refusal records in file order
 */
export function refusalsOf({ entries }: { entries: readonly GrantEntry[] }): readonly GrantRefusal[] {
  return entries.flatMap((entry) => (entry.kind === "refusal" ? [entry.refusal] : []));
}

/**
 * Render a target as the one line a session reads.
 *
 * @param target the file or system
 * @returns `file <path>` or `system <name>`
 */
export function renderTarget({ target }: { target: GrantTarget }): string {
  return target.kind === "file" ? `file ${target.path}` : `system ${target.name}`;
}
