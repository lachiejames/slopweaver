/**
 * The reader for the owner's open pull requests as the verb ranked and folded them. A sibling of `./read.ts`, under every
 * rule its module doc states.
 */
import { type Bag, bags, isBag, str, strings, sub } from "../../lib/bag";

/** One open pull request of the owner's, already ranked and already folded by the verb that measured it. */
export interface PrRow {
  readonly key: string;
  readonly title: string;
  /** The one-word state the verb chose — `review`, `blocked`, `merge` and so on. */
  readonly badge: string;
  /** The single next act, in the verb's own words. */
  readonly verb: string;
  /** Why it is where it is. */
  readonly why: string;
  /** The fold: every line the verb printed under the row, carried verbatim. */
  readonly detail: readonly string[];
}

/** What the pull-request section shows, including the two things a zero has to carry. */
export interface PrStatus {
  readonly rows: readonly PrRow[];
  /**
   * The verb's own instant. Carried separately from the route's stamp because `pane pr-status` publishes
   * it as `measuredAtIso`, a `Measured` wrapper rather than the bare `observedAtIso` the route reads — so
   * the tile prints both and says which is which instead of letting one pass for the other.
   */
  readonly measuredAtIso: string | undefined;
  /**
   * The sentence the verb prints when it found nothing. Rendering an empty list without it would turn a
   * MEASURED zero into an unread one, which is the cohesive-picture failure by name.
   */
  readonly emptyReason: string | undefined;
}

/**
 * Read a `Measured` field — the `{ known, value }` wrapper `src/measurement/measure.ts` publishes.
 *
 * @param bag the document the field sits on
 * @param key the field name
 * @returns the value when the reading was taken, else `undefined` — never a substituted instant
 */
function measured({ bag, key }: { bag: Bag; key: string }): string | undefined {
  const held = sub({ bag, key });
  if (held === undefined || held["known"] !== true) {
    return undefined;
  }
  return str({ bag: held, key: "value" });
}

/**
 * Project `pane pr-status --json` into the section that answers what is blocked on what.
 *
 * Nothing here re-derives a rank, a blocker or a badge: every one of those is already computed by
 * `src/pane/`, and computing it a second time is how two surfaces over the same question start to
 * disagree. A row missing its title, key or detail refuses the whole reading.
 *
 * @returns the ranked rows with the verb's own instant and its empty sentence, or `undefined` when the
 *   payload is not the document this section reads
 */
export function readPrStatus(payload: unknown): PrStatus | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const rows = bags({ bag: payload, key: "rows" });
  if (rows === undefined) {
    return undefined;
  }
  const out: PrRow[] = [];
  for (const row of rows) {
    const key = str({ bag: row, key: "key" });
    const title = str({ bag: row, key: "title" });
    const badge = str({ bag: row, key: "badge" });
    const verb = str({ bag: row, key: "verb" });
    const why = str({ bag: row, key: "why" });
    const detail = strings({ bag: row, key: "detail" });
    const readable =
      key !== undefined &&
      title !== undefined &&
      badge !== undefined &&
      verb !== undefined &&
      why !== undefined &&
      detail !== undefined;
    if (!readable) {
      return undefined;
    }
    out.push({ badge, detail, key, title, verb, why });
  }
  return {
    emptyReason: str({ bag: payload, key: "emptyReason" }),
    measuredAtIso: measured({ bag: payload, key: "measuredAtIso" }),
    rows: out,
  };
}
