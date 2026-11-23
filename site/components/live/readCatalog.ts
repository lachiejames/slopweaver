/**
 * The reader for the verb catalog page, exactly as `catalog --json` publishes it. A sibling of `./read.ts`, under
 * every rule its module doc states.
 */
import { isBag, str } from "../../lib/bag";

/** One row of the verb catalog, exactly as `catalog --json` publishes it. */
export interface CatalogRow {
  readonly noun: string;
  readonly verb: string;
  readonly summary: string;
  readonly example: string | undefined;
  /** True when running it writes to a provider — the flag the door's own audit reads. */
  readonly externalWrite: boolean;
  /** True when it can open a Linear issue, a PR or a board row on the reader's behalf. */
  readonly createsWorkItem: boolean;
}

/**
 * Project `catalog --json` into the verb-surface page's shape.
 *
 * A row missing its noun, verb or summary refuses the whole catalog. This is the page whose entire claim is
 * that the command reference cannot disagree with the installed binary, and a silently shorter list is
 * precisely the disagreement it exists to rule out — the count it prints would have been the post-drop one.
 *
 * @returns one row per command, or `undefined` when the payload is not an array of readable commands
 */
export function readCatalog(payload: unknown): readonly CatalogRow[] | undefined {
  if (!Array.isArray(payload)) {
    return undefined;
  }
  const out: CatalogRow[] = [];
  for (const entry of payload as readonly unknown[]) {
    if (!isBag(entry)) {
      return undefined;
    }
    const noun = str({ bag: entry, key: "noun" });
    const verb = str({ bag: entry, key: "verb" });
    const summary = str({ bag: entry, key: "summary" });
    if (noun === undefined || verb === undefined || summary === undefined) {
      return undefined;
    }
    out.push({
      createsWorkItem: entry["createsWorkItem"] === true,
      example: str({ bag: entry, key: "example" }),
      externalWrite: entry["externalWrite"] === true,
      noun,
      summary,
      verb,
    });
  }
  return out;
}
