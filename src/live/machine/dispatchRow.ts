/**
 * ONE DISPATCH — what the fleet saw, who it blamed, what it seated, and whether anybody ever settled it.
 *
 * This is the finding row every anomaly owes. Its whole reason to exist is that a reading is not a
 * mechanism: `machine capacity` once published a `capacity-hold` naming a stalled hook
 * and nobody acted on it, because nothing anywhere was OBLIGED to. A row is the obligation — it is what
 * `../../supervisor/loadDispatchGate.ts` refuses a tick for not having, and what a settlement clears.
 *
 * ## Three properties the shape enforces rather than asks for
 *
 * - **A row is written even when nothing is seated.** `seated` has a `none` arm carrying WHY — a backoff, a
 *   live investigation already on this signature, a spawn that failed. The alternative (write a row only
 *   when a seat opens) deadlocks against the gate: the backoff suppresses the row, the hold stays true, and
 *   the tick can never be recorded. Seating is the thing that is rate-limited; observing never is.
 * - **A row carries LABELS, never an argv.** `AnomalySubject.tree` is `TreeProcess[]`, whose labels come
 *   from `comm` (`./fleetLoad.ts`, `./cpuHogs.ts`). These rows reach the fleet briefing, and an argv can
 *   carry a token in a flag value.
 * - **A row is parsed defensively.** It is read back from a JSONL file this process did not necessarily
 *   write, so {@link parseDispatchRow} returns `undefined` for anything it cannot fully trust rather than
 *   half a row. A gate reading a half-row would report covered when it saw nothing.
 */
import { isRecord } from "../../lib/parsers.js";
import type { AnomalySubject, AnomalyTrigger } from "./anomaly.js";
import type { TreeProcess } from "./fleetLoad.js";

/** Every trigger kind a row may carry, for the parser to validate against. */
const TRIGGERS: readonly AnomalyTrigger[] = ["hold", "single-process", "process-count", "daemon-footprint"];

/** What the dispatch did about the anomaly: opened a visible seat, or deliberately did not. */
export type DispatchSeat =
  /** A visible cmux workspace was opened on it — the investigation the owner asked to be automatic. */
  | { readonly kind: "seated"; readonly workspace: string; readonly slug: string }
  /**
   * The board row is written and `cmux spawn` has not reported yet — appended BEFORE the spawn, because the
   * spawn is the slow half (minutes under load) and a caller's timeout killing the watch there used to leave a
   * board row citing a dispatch id the register never held (`../../cli/commands/machine/watch.ts`). As a row's
   * LAST word it means the watch died mid-spawn: the board row exists, the workspace may or may not.
   *
   * A reader built before this arm existed rejects it in {@link parseDispatchRow}'s old `parseSeat` and drops
   * the whole line, so for a seat on an older checkout a killed watch's row is still ABSENT: its `machine
   * dispatches` lists nothing, its `settle` refuses the id, its gate and backoff count nothing and its watch
   * may re-seat the signature. That is the stale-seat class (`../../cli/staleSeat.ts`) and ends when the
   * seat's checkout syncs; every reader at or after this arm sees the row.
   */
  | { readonly kind: "registered"; readonly slug: string; readonly sinceIso: string }
  /** No seat was opened, and this is why. Never silence: a row with no seat still has to explain itself. */
  | { readonly kind: "none"; readonly why: string };

/**
 * How a row stopped being open.
 *
 * @internal reached through {@link DispatchRow.settled}; no consumer names the type itself.
 */
export interface DispatchSettlement {
  readonly atIso: string;
  /** What the settler observed — the witness, in their own words. */
  readonly witness: string;
}

/** One dispatch: the reading, the blame, the response, and the settlement when one has happened. */
export interface DispatchRow {
  /** A stable id for this row, minted by the writer. */
  readonly id: string;
  /** When the anomalous reading was taken. */
  readonly observedIso: string;
  /** Every line that fired on that reading. */
  readonly triggers: readonly AnomalyTrigger[];
  /** The dedupe key — trigger kinds, culprit label and owning session. Never a pid. */
  readonly signature: string;
  /** Who the reading blamed, and the one command that ends it. */
  readonly subject: AnomalySubject;
  /** The 1-minute load average at the moment of the reading, so a row can be judged without re-reading. */
  readonly load1: number | undefined;
  /** What was done about it. */
  readonly seated: DispatchSeat;
  /** The settlement, or `undefined` while the row is still OPEN. */
  readonly settled: DispatchSettlement | undefined;
}

/**
 * Whether a row still demands an answer — the predicate the gate and the backoff both read.
 *
 * @param row the row to judge
 * @returns true while nobody has settled it
 */
export function isOpen({ row }: { row: DispatchRow }): boolean {
  return row.settled === undefined;
}

/** A string field, or `undefined` when it is absent or not a string. */
function str({ key, on }: { key: string; on: Record<string, unknown> }): string | undefined {
  const value = on[key];
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

/** A finite number field, or `undefined` when it is absent or not one. */
function num({ key, on }: { key: string; on: Record<string, unknown> }): number | undefined {
  const value = on[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

/** One tree entry, or `undefined` when it is not a complete one. */
function parseTreeProcess({ value }: { value: unknown }): TreeProcess | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const pid = num({ key: "pid", on: value });
  const label = str({ key: "label", on: value });
  const cpuPct = num({ key: "cpuPct", on: value });
  if (pid === undefined || label === undefined || cpuPct === undefined) {
    return undefined;
  }
  return { cpuPct, elapsedSeconds: num({ key: "elapsedSeconds", on: value }), label, pid };
}

/** The subject of a row, or `undefined` when it is not a complete one. */
function parseSubject({ value }: { value: unknown }): AnomalySubject | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const label = str({ key: "label", on: value });
  const why = str({ key: "why", on: value });
  if (label === undefined || why === undefined) {
    return undefined;
  }
  const rawTree = value["tree"];
  const tree = Array.isArray(rawTree)
    ? rawTree.flatMap((entry: unknown) => {
        const parsed = parseTreeProcess({ value: entry });
        if (parsed === undefined) {
          return [];
        }
        return [parsed];
      })
    : [];
  return { kill: str({ key: "kill", on: value }), label, sessionId: str({ key: "sessionId", on: value }), tree, why };
}

/** The seat arm of a row, or `undefined` when it is neither of the two shapes. */
function parseSeat({ value }: { value: unknown }): DispatchSeat | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value["kind"] === "seated") {
    const workspace = str({ key: "workspace", on: value });
    const slug = str({ key: "slug", on: value });
    if (workspace === undefined || slug === undefined) {
      return undefined;
    }
    return { kind: "seated", slug, workspace };
  }
  if (value["kind"] === "registered") {
    const slug = str({ key: "slug", on: value });
    const sinceIso = str({ key: "sinceIso", on: value });
    if (slug === undefined || sinceIso === undefined) {
      return undefined;
    }
    return { kind: "registered", sinceIso, slug };
  }
  if (value["kind"] === "none") {
    const why = str({ key: "why", on: value });
    if (why === undefined) {
      return undefined;
    }
    return { kind: "none", why };
  }
  return undefined;
}

/** The settlement of a row, or `undefined` when there is none or it is incomplete. */
function parseSettlement({ value }: { value: unknown }): DispatchSettlement | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const atIso = str({ key: "atIso", on: value });
  const witness = str({ key: "witness", on: value });
  if (atIso === undefined || witness === undefined) {
    return undefined;
  }
  return { atIso, witness };
}

/**
 * Decode one row, defensively — this reads a file the process did not necessarily write.
 *
 * @param value the parsed JSON of one line
 * @returns the row, or `undefined` when any field a reader depends on is missing or wrong-typed
 */
export function parseDispatchRow({ value }: { value: unknown }): DispatchRow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = str({ key: "id", on: value });
  const observedIso = str({ key: "observedIso", on: value });
  const signature = str({ key: "signature", on: value });
  const subject = parseSubject({ value: value["subject"] });
  const seated = parseSeat({ value: value["seated"] });
  if (id === undefined || observedIso === undefined || signature === undefined) {
    return undefined;
  }
  if (subject === undefined || seated === undefined) {
    return undefined;
  }
  const rawTriggers = value["triggers"];
  const triggers = Array.isArray(rawTriggers)
    ? rawTriggers.filter((entry: unknown): entry is AnomalyTrigger => TRIGGERS.some((trigger) => trigger === entry))
    : [];
  if (triggers.length === 0) {
    return undefined;
  }
  return {
    id,
    load1: num({ key: "load1", on: value }),
    observedIso,
    seated,
    settled: parseSettlement({ value: value["settled"] }),
    signature,
    subject,
    triggers,
  };
}

/**
 * One row's one-line summary — what a `dispatches` listing and a briefing clause both print.
 *
 * @param row the row to describe
 * @returns the line, naming the instant, the triggers, the subject and what happened about it
 */
export function dispatchLine({ row }: { row: DispatchRow }): string {
  let state = "OPEN";
  if (row.settled !== undefined) {
    state = `settled ${row.settled.atIso}`;
  }
  return `${row.observedIso}  ${state}  [${row.triggers.join("+")}] ${row.subject.label} — ${row.subject.why}; ${seatClause({ seat: row.seated })}`;
}

/** A seat arm in words — exhaustive, so a new arm fails to compile here instead of rendering as its bare kind. */
function seatClause({ seat }: { seat: DispatchSeat }): string {
  switch (seat.kind) {
    case "seated": {
      return `seated ${seat.slug} in ${seat.workspace}`;
    }
    case "registered": {
      return (
        `board row ${seat.slug} registered at ${seat.sinceIso}, its cmux spawn never reported — if no workspace ` +
        `is on it (\`slopweaver cmux list\`), open one with \`slopweaver cmux spawn ${seat.slug} --model opus\``
      );
    }
    case "none": {
      return `no seat — ${seat.why}`;
    }
    default: {
      const unhandled: never = seat;
      return String(unhandled);
    }
  }
}
