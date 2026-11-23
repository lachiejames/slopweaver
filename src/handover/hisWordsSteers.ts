/**
 * The owner's FURTHER steers on a board row — each another place they said something that bears on it, stored beside
 * the row's own quote (`./hisWords.ts`) as a numbered group of the same flat keys.
 *
 * One quote alone can leave out the full picture of why a Queue card is in front of the owner, so a row stores every
 * steer that bears on it. The row's `anchor:` is the one thing it answers; each steer here is one more anchor of the
 * owner's words, read off its record by the SAME resolver (`./hisWordsResolve.ts`), so a session names where the
 * owner said it and never types what they said.
 *
 * ## The shape
 *
 * Steer `n` is `ownerWordsSteer<n>Anchor` with either the four held keys (`Words`, `Iso`, `Where`, `Cut`) or one
 * `Unread` — exactly the row's own group with a numbered prefix, validated by the one validator
 * (`hisWordsRecordOf`). A key in the pronoun spelling (`hisWordsSteer<n>…`) reads as its owner-neutral twin
 * (`./hisWords.ts` `ownerWordsView`). Front matter is one flat line per key (`./docFlat.ts`), which is why a list of quotes is
 * numbered keys rather than a nested block: a bad group stays that ONE index's defect, and the row, its own quote and
 * every sibling still read. The steers travel, mirror and archive with the row, so no second register joins them.
 *
 * Pure: flat fields in, values out.
 */
import { flatValue } from "./docFlat.js";
import {
  type HisWordsGroup,
  type HisWordsKey,
  type HisWordsRecord,
  hisWordsFields,
  hisWordsGroupOf,
  hisWordsRecordOf,
  isFlatAnchor,
  OWNER_WORDS_KEYS,
  OWNER_WORDS_STEER_KEY,
  ownerWordsSchemeOf,
  ownerWordsView,
} from "./hisWords.js";

/** One further steer as a row stores it: its index, and the record or the defect its keys spell. */
export interface HisWordsSteer {
  readonly index: number;
  readonly group: Exclude<HisWordsGroup, { readonly kind: "absent" }>;
  /**
   * The anchor a DEFECTIVE group still declares, so a relate of that anchor finds this number rather than writing it
   * a second time. Absent on a readable steer, whose record names its anchor, and on a defect declaring none.
   */
  readonly declaredAnchor?: string;
}

/** The role suffix each of the row's own keys is stored under in a numbered steer. */
const ROLE: Readonly<Record<HisWordsKey, string>> = {
  ownerWords: "Words",
  ownerWordsAnchor: "Anchor",
  ownerWordsCut: "Cut",
  ownerWordsIso: "Iso",
  ownerWordsUnread: "Unread",
  ownerWordsWhere: "Where",
};

/**
 * The front-matter key steer `index` stores one of the group's values under.
 *
 * @param index the steer's number, from 1
 * @param key the row's own key for the same value
 * @returns `ownerWordsSteer<index><Role>`
 */
function hisWordsSteerKey({ index, key }: { index: number; key: HisWordsKey }): string {
  return `ownerWordsSteer${String(index)}${ROLE[key]}`;
}

/**
 * Every key steer `index` may declare.
 *
 * @param index the steer's number
 * @returns the keys, in {@link OWNER_WORDS_KEYS} order
 */
export function hisWordsSteerKeys({ index }: { index: number }): readonly string[] {
  return OWNER_WORDS_KEYS.map((key) => hisWordsSteerKey({ index, key }));
}

/**
 * The front-matter fields a steer's record is written as — the row's own group's, renamed.
 *
 * @param index the steer's number
 * @param record what to store
 * @returns the fields, values spelled for the flat reader
 */
export function hisWordsSteerFields({
  index,
  record,
}: {
  index: number;
  record: HisWordsRecord;
}): readonly { readonly key: string; readonly value: string }[] {
  return hisWordsFields({ record }).map((field) => {
    const own = OWNER_WORDS_KEYS.find((key) => key === field.key)!;
    return { key: hisWordsSteerKey({ index, key: own }), value: field.value };
  });
}

/** Any key spelled as a steer's, whatever its number — the net a misnumbered group is caught in rather than ignored. */
const ANY_STEER_KEY = /^ownerWordsSteer([0-9]+)(?:Anchor|Words|Iso|Where|Cut|Unread)$/u;

/**
 * The steer numbers a set of keys names, ascending numerically, each once — and, by the number as written, every
 * steer-shaped key no row writes: 0, a leading zero, or past what a `number` holds exactly, where two distinct
 * numbers would collapse into one and lose a group silently.
 */
function indexesIn({ keys }: { keys: readonly string[] }): {
  readonly indexes: readonly number[];
  readonly misnumbered: ReadonlyMap<string, readonly string[]>;
} {
  const found = new Set<number>();
  const misnumbered = new Map<string, string[]>();
  for (const key of keys) {
    const loose = ANY_STEER_KEY.exec(key);
    if (loose === null) {
      continue;
    }
    const index = Number(loose[1]);
    if (OWNER_WORDS_STEER_KEY.test(key) && Number.isSafeInteger(index)) {
      found.add(index);
      continue;
    }
    const written = loose[1]!;
    const named = misnumbered.get(written);
    if (named === undefined) {
      misnumbered.set(written, [key]);
    } else if (!named.includes(key)) {
      named.push(key);
    }
  }
  return { indexes: [...found].toSorted((one, other) => one - other), misnumbered };
}

/**
 * One defect per misnumbered group, at number 0 — never a steer's own, so a new steer still numbers past the highest
 * real one — each still holding the anchor it declares, so relating that anchor lands on it rather than beside it.
 */
function misnumberedSteers({
  misnumbered,
  fields,
}: {
  misnumbered: ReadonlyMap<string, readonly string[]>;
  fields: ReadonlyMap<string, string>;
}): readonly HisWordsSteer[] {
  return [...misnumbered.entries()]
    .toSorted(([one], [other]) => one.localeCompare(other))
    .map(([written, keys]): HisWordsSteer => {
      const why = `${keys.join(", ")} ${keys.length === 1 ? "is" : "are"} numbered ${written}, which no row writes a steer under; renumber by hand`;
      const declaredAnchor = flatValue({ fields, key: `ownerWordsSteer${written}Anchor` });
      if (declaredAnchor === undefined || !isFlatAnchor({ anchor: declaredAnchor })) {
        return { group: { kind: "defect", why }, index: 0 };
      }
      return { declaredAnchor, group: { kind: "defect", why }, index: 0 };
    });
}

/** The anchor a record was read off. */
function anchorOf({ record }: { record: HisWordsRecord }): string {
  return record.kind === "held" ? record.hisWords.anchor : record.anchor;
}

/** One steer's group, before it is judged against the anchors read ahead of it. */
function steerGroupOf({
  index,
  fields,
  duplicated,
}: {
  index: number;
  fields: ReadonlyMap<string, string>;
  duplicated: readonly string[];
}): HisWordsSteer["group"] {
  const twice = OWNER_WORDS_KEYS.filter((key) => duplicated.includes(hisWordsSteerKey({ index, key })));
  if (twice.length > 0) {
    const named = twice.map((key) => hisWordsSteerKey({ index, key })).join(", ");
    return { kind: "defect", why: `steer ${String(index)} declares ${named} more than once` };
  }
  const declared = OWNER_WORDS_KEYS.filter((key) => fields.has(hisWordsSteerKey({ index, key })));
  const record = hisWordsRecordOf({
    declared,
    value: ({ key }) => flatValue({ fields, key: hisWordsSteerKey({ index, key }) }),
  });
  if (typeof record === "string") {
    return { kind: "defect", why: `steer ${String(index)}: ${record}` };
  }
  if (ownerWordsSchemeOf({ anchor: anchorOf({ record }) }) === undefined) {
    return {
      kind: "defect",
      why: `steer ${String(index)} names ${anchorOf({ record })}, which is not the owner's words`,
    };
  }
  return record;
}

/**
 * Read a row's further steers off its flat fields, in index order. Each bad index is its OWN defect and never takes a
 * sibling with it; an anchor the row already answers, or an earlier steer already holds, is a defect too, because two
 * quotes of one record would draw the owner's one steer twice.
 *
 * @param fields the doc's flat scalars (`./docFlat.ts` `flatFields`)
 * @param duplicated every key the front matter declared more than once
 * @param anchor the row's own `anchor:`
 * @returns the steers, ascending by index, led by a defect at 0 for each group numbered as no row writes one
 */
function hisWordsSteersOf({
  fields,
  duplicated,
  anchor,
}: {
  fields: ReadonlyMap<string, string>;
  duplicated: readonly string[];
  anchor: string | undefined;
}): readonly HisWordsSteer[] {
  const seen = new Set<string>();
  if (anchor !== undefined) {
    seen.add(anchor);
  }
  const { indexes, misnumbered } = indexesIn({ keys: [...fields.keys(), ...duplicated] });
  const unnumbered = misnumberedSteers({ fields, misnumbered });
  for (const steer of unnumbered) {
    if (steer.declaredAnchor !== undefined) {
      seen.add(steer.declaredAnchor);
    }
  }
  const steers = indexes.map((index): HisWordsSteer => {
    const group = steerGroupOf({ duplicated, fields, index });
    if (group.kind === "defect") {
      const declaredAnchor = flatValue({ fields, key: hisWordsSteerKey({ index, key: "ownerWordsAnchor" }) });
      if (declaredAnchor === undefined || !isFlatAnchor({ anchor: declaredAnchor })) {
        return { group, index };
      }
      seen.add(declaredAnchor);
      return { declaredAnchor, group, index };
    }
    const at = anchorOf({ record: group });
    if (seen.has(at)) {
      return {
        group: { kind: "defect", why: `steer ${String(index)} repeats ${at}, already quoted on this row` },
        index,
      };
    }
    seen.add(at);
    return { group, index };
  });
  return [...unnumbered, ...steers];
}

/** Every quote of the owner's a board row stores (`./doc.ts` `HandoverDoc`). */
export interface HisWordsOnRow {
  /** The owner's words at the row's `anchor:`, stored beside it (`./hisWords.ts`) — absent, readable, or a defect never drawn. */
  readonly hisWords: HisWordsGroup;
  /** The owner's further steers on the row, each another anchor of their words quoted beside its own. */
  readonly hisWordsSteers: readonly HisWordsSteer[];
}

/**
 * Every quote of the owner's a row stores, as the doc carries them: its own group at `anchor:` and each further steer.
 *
 * @param fields the doc's flat scalars
 * @param duplicated every key the front matter declared more than once
 * @param anchor the row's own `anchor:`
 * @returns the row's own group and its steers
 */
export function hisWordsOnRow({
  fields,
  duplicated,
  anchor,
}: {
  fields: ReadonlyMap<string, string>;
  duplicated: readonly string[];
  anchor: string | undefined;
}): HisWordsOnRow {
  const view = ownerWordsView({ duplicated, fields });
  return {
    hisWords: hisWordsGroupOf({ anchor, duplicated: view.duplicated, fields: view.fields }),
    hisWordsSteers: hisWordsSteersOf({ anchor, duplicated: view.duplicated, fields: view.fields }),
  };
}

/**
 * The number a new steer takes: one past the highest a row holds, a defective one included, so a hand-broken group
 * is never overwritten by a new one.
 *
 * @param steers the row's steers
 * @returns the next free number, from 1
 */
export function nextHisWordsSteerIndex({ steers }: { steers: readonly HisWordsSteer[] }): number {
  return steers.reduce((highest, steer) => Math.max(highest, steer.index), 0) + 1;
}

/**
 * The anchor a steer holds: its record's, or the one a defective group still declares — so the number stays that
 * anchor's and a relate of it lands on the defect rather than beside it. `undefined` for a defect declaring none.
 *
 * @returns its anchor
 */
export function steerAnchor({ steer }: { steer: HisWordsSteer }): string | undefined {
  if (steer.group.kind === "defect") {
    return steer.declaredAnchor;
  }
  return anchorOf({ record: steer.group });
}
