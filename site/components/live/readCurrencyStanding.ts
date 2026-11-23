/**
 * The standing half of the strict `handover currency` reader (`./readCurrency.ts`): a schema-3 row's changes to the owner's
 * standing rulings, memories and owner profile, and the reading's line for each of those sources. Required on schema
 * 3 and never read off an older shape, which did not read the owner's standing guidance — so a schema-2 row carrying a
 * standing list decodes without it, and its steers half never passes.
 */
import { type Bag, bags, str } from "../../lib/bag";
import type { CurrencyStandingChange } from "../../lib/cardCurrency";

/** Which reading shape a document is: the ask-only one, a row per card kind, or one that also read the owner's standing guidance. */
export type Schema = "legacy" | 2 | 3;

const STANDING_SOURCES: readonly CurrencyStandingChange["source"][] = ["memory", "profile", "ruling"];
const FILINGS: readonly CurrencyStandingChange["filed"][] = ["here", "unfiled"];

/**
 * One change to the owner's standing guidance.
 *
 * @param bag the change object
 * @returns the change, or `undefined`
 */
function readStandingChange({ bag }: { bag: Bag }): CurrencyStandingChange | undefined {
  const atIso = str({ bag, key: "atIso" });
  const pointer = str({ bag, key: "pointer" });
  const source = STANDING_SOURCES.find((each) => each === str({ bag, key: "source" }));
  const filed = FILINGS.find((each) => each === str({ bag, key: "filed" }));
  if (atIso === undefined || pointer === undefined || source === undefined || filed === undefined) {
    return undefined;
  }
  return { atIso, filed, pointer, source };
}

/**
 * A schema-3 row's standing changes, required there; an older row never carries them.
 *
 * @param sinceBag the row's `since` object
 * @param schema the document's shape
 * @returns the changes, `"absent"` on an older schema, or `undefined` when they will not read
 */
export function readStanding({
  sinceBag,
  schema,
}: {
  sinceBag: Bag;
  schema: Schema;
}): readonly CurrencyStandingChange[] | "absent" | undefined {
  if (schema !== 3) {
    return "absent";
  }
  const changeBags = bags({ bag: sinceBag, key: "standing" });
  const changes = changeBags?.map((each) => readStandingChange({ bag: each }));
  if (changes === undefined || changes.some((change) => change === undefined)) {
    return undefined;
  }
  return changes.filter((change) => change !== undefined);
}

/**
 * What a schema-3 reading's standing read found in each source — required there, absent on every older shape.
 *
 * @param sources the reading's `sources` object
 * @param schema the document's shape
 * @returns the three lines, `"absent"` on an older schema, or `"invalid"` when one will not read
 */
export function readStandingSources({
  sources,
  schema,
}: {
  sources: Bag;
  schema: Schema;
}): { readonly memory: string; readonly profile: string; readonly rulings: string } | "absent" | "invalid" {
  if (schema !== 3) {
    return "absent";
  }
  const memory = str({ bag: sources, key: "memory" });
  const profile = str({ bag: sources, key: "profile" });
  const rulings = str({ bag: sources, key: "rulings" });
  if (memory === undefined || profile === undefined || rulings === undefined) {
    return "invalid";
  }
  return { memory, profile, rulings };
}
