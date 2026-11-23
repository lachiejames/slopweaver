/**
 * The item-level pieces both digest cards share: the count sentence, an index line's metrics and width, an
 * item's below-fold paragraph, the owner decision and the citation numbering.
 *
 * Split from `./digest.ts` so the triage card there and the alerts card in `./digestAlerts.ts` read one copy
 * of each rather than two that drift.
 */
import type { DigestItem } from "./digestFields.js";
import { SEVERITIES, SEVERITY_WORD } from "./severity.js";
import type { Citation, DetailBlock, InlineRun } from "./types.js";

/**
 * `1 red, 2 orange` — non-zero buckets only, so a quiet day does not advertise three zeroes.
 *
 * @returns the counts joined, worst severity first
 */
export function countSentence({ items }: { items: readonly DigestItem[] }): string {
  const parts = SEVERITIES.filter((severity) => items.some((item) => item.severity === severity)).map((severity) => {
    const count = items.filter((item) => item.severity === severity).length;
    return `${String(count)} ${SEVERITY_WORD[severity]}`;
  });
  return parts.join(", ");
}

/**
 * The trailing clause of an index line: the count, then the trend when there is one.
 *
 * @returns the count, and the trend after a comma when the item has one
 */
export function itemMetrics({ item }: { item: DigestItem }): string {
  return item.trend === undefined ? String(item.count) : `${String(item.count)}, ${item.trend}`;
}

/**
 * The visible width of a derived line, by the same rule the caps use: a link costs its label, a chip its `[n]`.
 *
 * @returns the width in the layout's own units
 */
export function lineWidth({ runs, chipWidth }: { runs: readonly InlineRun[]; chipWidth: number }): number {
  return runs.reduce((total, run) => {
    if (run.type === "text") {
      return total + run.text.length;
    }
    if (run.type === "link") {
      return total + run.label.length;
    }
    return total + chipWidth;
  }, 0);
}

/**
 * The below-fold paragraph for one item that carries substance.
 *
 * The ticket leads the sentence as a link so the paragraph is navigable on its own, matching how the index
 * line reads. An item with no ticket contributes its prose alone.
 *
 * @returns the paragraph, or undefined when the item has neither substance nor an owner
 */
export function itemParagraph({
  item,
  isKnownPerson,
}: {
  item: DigestItem;
  isKnownPerson: (person: string) => boolean;
}): DetailBlock | undefined {
  if (item.substance === undefined && item.owner === undefined) {
    return undefined;
  }
  const lead: readonly InlineRun[] =
    item.ticket === undefined
      ? []
      : [
          { label: item.ticket.id, type: "link", url: item.ticket.url },
          { text: " ", type: "text" },
        ];
  const body: readonly InlineRun[] = item.substance === undefined ? [] : [{ text: item.substance, type: "text" }];
  const owner = item.owner === undefined ? [] : ownerRuns({ isKnownPerson, owner: item.owner });
  return { runs: [...lead, ...body, ...owner], type: "paragraph" };
}

/**
 * The owner clause: a real `@` ping when the person resolves, PLAIN TEXT when they do not.
 *
 * Degrading rather than refusing is a deliberate choice about an UNATTENDED job. Everywhere else in this repo an
 * unresolvable mention refuses the whole send, which is right when a human is composing and can fix it — but here
 * it would mean no digest at all at 16:00 because the roster had drifted. So the ping is best-effort and the
 * failure is LOUD instead: the reader sees `arlo (unresolved)` in the message itself, and the caller is handed
 * the name to warn about. What never happens is a silent drop, or a guess at who was meant.
 */
function ownerRuns({
  owner,
  isKnownPerson,
}: {
  owner: NonNullable<DigestItem["owner"]>;
  isKnownPerson: (person: string) => boolean;
}): readonly InlineRun[] {
  const tag: InlineRun = isKnownPerson(owner.person)
    ? { person: owner.person, type: "mention" }
    : { text: `${owner.person} (unresolved)`, type: "text" };
  const ask = owner.ask === undefined ? [] : [{ text: ` ${owner.ask}`, type: "text" as const }];
  // A full stop rather than the em dash this used to open with. The dash is a literal rule in the operator's
  // own voice list, and it sat here for weeks because nothing read a DERIVED card's prose: the digest's own
  // form schema never sees this string, and the below-fold half of the door only runs at a send. Found by
  // `derived-card-voice` on the day that gate landed. Reproduce: `yarn lint --only derived-card-voice`.
  return [{ text: ". Owner: ", type: "text" }, tag, ...ask];
}

/**
 * Resolve each distinct owner ONCE, and answer from that decision thereafter.
 *
 * ## Why this is not a cache for speed
 *
 * The rendering and the caller's `unresolvedOwners` list used to consult `isKnownPerson` SEPARATELY for the same
 * person. At the CLI seam that predicate performs a fresh roster read per call, so the two could disagree: an
 * adversarial review found that a roster changing between the two reads renders `arlo (unresolved)` into the
 * card while reporting an EMPTY unresolved list — so the refusal guard sees nothing to refuse, the warning never
 * prints, and the degraded card posts. The mention pre-check downstream cannot catch it either, because by then
 * the ping is plain text rather than a mention run.
 *
 * Deciding once makes the two consistent BY CONSTRUCTION rather than by both happening to read the same thing.
 * Fewer roster reads is a side benefit, not the reason.
 *
 * The returned predicate deliberately carries no parameter annotation: it inherits its shape from this function's
 * declared return type, which is what keeps it a legal one-parameter callback rather than a positional signature.
 *
 * @param items the digest items, in any order
 * @param isKnownPerson the roster predicate, called at most once per distinct owner
 * @returns a predicate answering from the decisions already taken
 */
export function decideOwners({
  items,
  isKnownPerson,
}: {
  items: readonly DigestItem[];
  isKnownPerson: (person: string) => boolean;
}): (person: string) => boolean {
  const decisions = new Map<string, boolean>();
  for (const item of items) {
    const person = item.owner?.person;
    if (person !== undefined && !decisions.has(person)) {
      decisions.set(person, isKnownPerson(person));
    }
  }
  return (person) => decisions.get(person) === true;
}

/**
 * One citation per INDEXED item that supplied a query URL, labelled `[n]` in severity order.
 *
 * Indexed only, because the index line is the one place a `[n]` chip is emitted — the table rows below the
 * fold carry none. Passing every item here declared citations nothing cited, which is exactly the
 * accept-and-drop `./citationMarkers.ts` closes.
 *
 * The id is POSITIONAL (`c1`, `c2`) rather than derived from the ticket key, so uniqueness is guaranteed by
 * construction. Two items legitimately share a ticket when one ticket causes two symptoms, and a ticket-keyed
 * id would then collide — which `updateArtifactSchema` rejects as "citation ids must be unique", failing the
 * whole send over a naming choice.
 *
 * @param items the items in their final, severity-ordered position
 * @returns the citations, and the per-item id map the index lines reference
 */
export function deriveCitations({ items }: { items: readonly DigestItem[] }): {
  readonly citations: readonly Citation[];
  readonly idFor: ReadonlyMap<number, string>;
} {
  const citations: Citation[] = [];
  const idFor = new Map<number, string>();
  items.forEach((item, position) => {
    if (item.citationUrl === undefined) {
      return;
    }
    const id = `c${String(citations.length + 1)}`;
    idFor.set(position, id);
    citations.push({ id, label: `[${String(citations.length + 1)}]`, url: item.citationUrl });
  });
  return { citations, idFor };
}
