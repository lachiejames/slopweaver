/**
 * The owner's standing asks, as `slopweaver profile standing --json` publishes them (`src/profile/standingAsks.ts`) — the
 * words an unsteered Queue card quotes (`../../lib/standingAskSource.ts`).
 *
 * **All or nothing.** One ask that will not read refuses the whole reading rather than leaving its siblings: a
 * dropped ask could be the one a card should quote, and a card quoting another one in its place, or none, would read
 * as complete. The verb's own `defect` is a reading too — the journal does not fold — and every card it would have
 * quoted says so rather than claiming no standing ask covers it.
 */
import { type Bag, isBag, str } from "../../lib/bag";
import { type BoardRowQuote, quoteOf } from "./readHisWords";

/** One standing ask as a card draws it. */
export interface StandingAskView {
  readonly id: string;
  readonly quote: BoardRowQuote;
  /** The cards it stands behind: `findings`, `registered-rows`, `bot-replies`, `unlinked-cards` or `act:<kind>`. */
  readonly covers: readonly string[];
}

/** The register as read: the active asks, or why the journal behind them does not fold. */
export type StandingAskReading =
  | { readonly kind: "read"; readonly active: readonly StandingAskView[] }
  | { readonly kind: "defect"; readonly why: string };

/** One published ask, or `undefined` when any field will not read. */
function askOf({ value }: { value: unknown }): StandingAskView | undefined {
  if (!isBag(value)) {
    return undefined;
  }
  const id = str({ bag: value, key: "id" });
  const published = value["quote"];
  const quote = isBag(published) ? quoteOf({ value: published }) : undefined;
  const covers = value["covers"];
  if (id === undefined || quote === undefined || !Array.isArray(covers) || covers.length === 0) {
    return undefined;
  }
  const named = covers.filter((one: unknown): one is string => typeof one === "string" && one.length > 0);
  if (named.length !== covers.length) {
    return undefined;
  }
  return { covers: named, id, quote };
}

/** The active asks, or `undefined` when one will not read or two claim one id or one coverage. */
function activeOf({ bag }: { bag: Bag }): readonly StandingAskView[] | undefined {
  const published = bag["active"];
  if (!Array.isArray(published)) {
    return undefined;
  }
  const active: StandingAskView[] = [];
  for (const value of published) {
    const ask = askOf({ value });
    if (ask === undefined) {
      return undefined;
    }
    active.push(ask);
  }
  const ids = active.map((ask) => ask.id);
  const covers = active.flatMap((ask) => ask.covers);
  if (new Set(ids).size !== ids.length || new Set(covers).size !== covers.length) {
    return undefined;
  }
  return active;
}

/**
 * Read the standing-ask register.
 *
 * @returns the reading, or `undefined` when the payload is not one
 */
export function readStandingAsks(payload: unknown): StandingAskReading | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  if (payload["kind"] === "defect") {
    const why = str({ bag: payload, key: "why" });
    if (why === undefined) {
      return undefined;
    }
    return { kind: "defect", why };
  }
  if (payload["kind"] !== "read") {
    return undefined;
  }
  const active = activeOf({ bag: payload });
  if (active === undefined) {
    return undefined;
  }
  return { active, kind: "read" };
}
