/**
 * The naming-doctrine gate — one concept, one name (AGENTS.md rule 11).
 *
 * One consistent name per concept across commands, skills, pages and docs, different names when things
 * mean different things. The example is the `vulnfix` verbs sitting behind the `vulnerability-fix` skill.
 *
 * ## What is computable, and so what this gate judges
 *
 * Two surfaces DECLARE their names in one place each, so a divergence between them is a fact rather than a
 * reading of prose:
 *
 * - **The command surface**: every CLI noun (`MANIFEST_MODULES`, `../cli/manifests/index.ts`) and every skill
 *   (`skills/<name>/SKILL.md`, named by its directory). Two of these name ONE concept two ways when their
 *   names differ only by separators, by a plural, or by one abbreviating the other — {@link nameRelation}.
 * - **The sidebar**: every linked `SIDEBAR_ENTRIES` row (`site/lib/sidebarCounts.ts`) carries an address, a
 *   key and a label for one page, and all three must be the same name — {@link sidebarDivergences}.
 *
 * A third half, the retired integration vocabulary (`provider`, `platform`, `connector` as a segment of an
 * identifier we declare), is a criterion over TypeScript declarations rather than over these registries, so it
 * lives in `./namingVocabulary.ts` with its own shell, `./namingVocabularyRun.ts`.
 *
 * ## What it deliberately does NOT judge
 *
 * Prose, React composition and module names. A page composes several components with no primary one
 * (`/workstreams` draws `WorkstreamCandidates` and `WorkstreamTiles`), and an English word in a doc can
 * correctly name a process the code calls something else. A criterion over those would either encode
 * route-specific knowledge or refuse correct text, so they stay a review obligation under rule 11, and a
 * green run here says nothing about them.
 *
 * ## The abbreviation rule's one guard
 *
 * The expanded name needs at least TWO segments. Without that, every prefix reads as an abbreviation: the
 * `hand` skill and the `handover` noun are different concepts, and `hand` is a prefix of `handover`.
 * With it, `vulnfix` splits as `vuln` + `fix` against `vulnerability-fix`, while `org` cannot split across
 * `org-health`'s two segments and stays the distinct concept it is.
 *
 * Pure — every function here takes declarations and returns findings. The effectful shell is
 * `./namingDoctrineRun.ts`; the sidebar extractor is `./namingDoctrineSidebar.ts`.
 */

/** A name the command surface declares: a CLI noun, or a skill's directory. */
export interface CommandSurfaceName {
  readonly name: string;
  readonly surface: "noun" | "skill";
  /** Where it is declared, repo-relative, for reporting. */
  readonly path: string;
}

/** One linked or unlinked row of the console sidebar, as declared. */
export interface SidebarNameDeclaration {
  /** The page address, or `null` for a row that opens no page (the Settings modal). */
  readonly href: string | null;
  readonly key: string;
  readonly label: string;
  readonly line: number;
  readonly path: string;
}

/** How two different names turn out to name one concept. */
export type NameRelation = "separator" | "plural" | "abbreviation";

/** One concept found named two ways. */
export type NamingDivergence =
  | {
      readonly kind: "command-surface";
      readonly left: CommandSurfaceName;
      readonly right: CommandSurfaceName;
      readonly relation: NameRelation;
    }
  | {
      readonly kind: "sidebar";
      readonly entry: SidebarNameDeclaration;
      readonly hrefSegment: string;
      readonly labelSlug: string;
    };

/**
 * A name's lowercase segments, split on hyphens, underscores, whitespace and camelCase boundaries, an acronym
 * run included: `SDKProvider` is `sdk` + `provider`, never `sdkprovider`. Case is read by Unicode category:
 * uppercase and titlecase letters open a segment, and every other identifier-continue character before one (a
 * lowercase, modifier or caseless letter, a letter number, a combining mark, a digit, a connector, `$`, ZWNJ or ZWJ)
 * closes the last, so `FooProviderÉtat`, `ǅProvider`, `日本Provider` and a decomposed `Foó` + `Provider` each split
 * before the retired word.
 *
 * @param name a noun, skill, key, label or identifier as declared
 * @returns its segments, never an empty one
 */
export function nameSegments({ name }: { name: string }): readonly string[] {
  return name
    .replace(/([\p{Lu}\p{Lt}]+)([\p{Lu}\p{Lt}]\p{Ll})/gu, "$1-$2")
    .replace(/([\p{Ll}\p{Lm}\p{Lo}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$‌‍])([\p{Lu}\p{Lt}])/gu, "$1-$2")
    .toLowerCase()
    .split(/[-_\s]+/u)
    .filter((segment) => segment.length > 0);
}

/**
 * The plural forms English spelling rules give one segment: `+s`, consonant-`y` to `ies`, and `+es` after
 * a sibilant. Deterministic on purpose; an irregular plural is not a spelling this gate can derive.
 */
function pluralsOf({ word }: { word: string }): readonly string[] {
  if (/[^aeiou]y$/u.test(word)) {
    return [`${word.slice(0, -1)}ies`];
  }
  if (/(s|x|z|ch|sh)$/u.test(word)) {
    return [`${word}es`];
  }
  return [`${word}s`];
}

/** Whether two segment lists agree on every segment but the last, and one last segment pluralises the other. */
function isPluralPair({ a, b }: { a: readonly string[]; b: readonly string[] }): boolean {
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  const stemsAgree = a.slice(0, -1).every((segment, index) => segment === b[index]);
  const lastA = a.at(-1)!;
  const lastB = b.at(-1)!;
  return stemsAgree && (pluralsOf({ word: lastA }).includes(lastB) || pluralsOf({ word: lastB }).includes(lastA));
}

/**
 * Whether `short` splits into exactly `segments.length` non-empty pieces, piece `i` a prefix of segment `i`.
 * Strictness (at least one piece shorter than its segment) is the caller's, because equal concatenations are
 * the separator relation, judged first.
 */
function splitsAsPrefixes({ short, segments }: { short: string; segments: readonly string[] }): boolean {
  const [head, ...rest] = segments;
  if (head === undefined) {
    return short.length === 0;
  }
  const longest = Math.min(head.length, short.length - rest.length);
  for (let take = longest; take >= 1; take -= 1) {
    if (head.startsWith(short.slice(0, take)) && splitsAsPrefixes({ segments: rest, short: short.slice(take) })) {
      return true;
    }
  }
  return false;
}

/** Whether one name abbreviates the other: the expanded one has two or more segments, see the file header. */
function isAbbreviationPair({ a, b }: { a: readonly string[]; b: readonly string[] }): boolean {
  const [shorter, longer] = a.join("").length <= b.join("").length ? [a, b] : [b, a];
  if (longer.length < 2) {
    return false;
  }
  return splitsAsPrefixes({ segments: longer, short: shorter.join("") });
}

/**
 * How two different names name one concept, or `undefined` when they name two.
 *
 * Identical spellings return `undefined`: one name declared on two surfaces is the doctrine being kept.
 *
 * @param a one declared name
 * @param b another
 * @returns the relation that makes them one concept, or undefined
 */
export function nameRelation({ a, b }: { a: string; b: string }): NameRelation | undefined {
  if (a === b) {
    return undefined;
  }
  const left = nameSegments({ name: a });
  const right = nameSegments({ name: b });
  if (left.join("") === right.join("")) {
    return "separator";
  }
  if (isPluralPair({ a: left, b: right })) {
    return "plural";
  }
  if (isAbbreviationPair({ a: left, b: right })) {
    return "abbreviation";
  }
  return undefined;
}

/**
 * Every pair of command-surface names that name one concept two ways. Every pair is compared, nouns against
 * nouns and skills against skills too, because two nouns spelling one concept two ways is the same defect.
 *
 * @param names every CLI noun and skill name
 * @returns one divergence per related pair, in declaration order
 */
export function commandSurfaceDivergences({
  names,
}: {
  names: readonly CommandSurfaceName[];
}): readonly NamingDivergence[] {
  const divergences: NamingDivergence[] = [];
  names.forEach((left, index) => {
    for (const right of names.slice(index + 1)) {
      const relation = nameRelation({ a: left.name, b: right.name });
      if (relation !== undefined) {
        divergences.push({ kind: "command-surface", left, relation, right });
      }
    }
  });
  return divergences;
}

/**
 * A label as an address segment: lowercased, every run of other characters collapsed to one hyphen.
 *
 * @param label the sidebar's visible label
 * @returns its slug
 */
export function labelSlug({ label }: { label: string }): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

/** An address's first non-empty path segment, ignoring any query or fragment; the root address has none. */
function firstPathSegment({ href }: { href: string }): string {
  const path = href.split(/[?#]/u)[0]!;
  const segment = path.split("/").find((part) => part.length > 0);
  if (segment === undefined) {
    return "";
  }
  return segment;
}

/**
 * Every linked sidebar row whose address, key and label do not all spell the same name. A row whose `href` is
 * `null` opens no page, so it has no address to disagree with.
 *
 * @param entries every sidebar row, as declared
 * @returns one divergence per row that names its page more than one way
 */
export function sidebarDivergences({
  entries,
}: {
  entries: readonly SidebarNameDeclaration[];
}): readonly NamingDivergence[] {
  return entries.flatMap((entry): readonly NamingDivergence[] => {
    if (entry.href === null) {
      return [];
    }
    const hrefSegment = firstPathSegment({ href: entry.href });
    const slug = labelSlug({ label: entry.label });
    if (hrefSegment === entry.key && slug === entry.key) {
      return [];
    }
    return [{ entry, hrefSegment, kind: "sidebar", labelSlug: slug }];
  });
}

/**
 * The stable identity of one divergence, which is what a debt row records. A command-surface pair is keyed
 * by both names in sorted order, so the order the registries list them in cannot change it.
 *
 * @param divergence one finding
 * @returns its identity string
 */
export function divergenceIdentity({ divergence }: { divergence: NamingDivergence }): string {
  if (divergence.kind === "sidebar") {
    const { entry } = divergence;
    return `sidebar ${entry.key} href=${divergence.hrefSegment} label=${divergence.labelSlug}`;
  }
  const pair = [divergence.left, divergence.right].map((side) => `${side.surface}:${side.name}`).toSorted();
  return `command-surface ${pair.join(" ")}`;
}

/**
 * One divergence as the line an operator reads.
 *
 * @param divergence one finding
 * @returns the report line, without indentation or newline
 */
export function describeDivergence({ divergence }: { divergence: NamingDivergence }): string {
  if (divergence.kind === "sidebar") {
    const { entry } = divergence;
    return (
      `${entry.path}:${String(entry.line)}: the sidebar's \`${entry.label}\` page has key \`${entry.key}\` ` +
      `and address \`/${divergence.hrefSegment}\` — one page, named more than one way`
    );
  }
  const { left, right, relation } = divergence;
  return (
    `${left.path}: ${left.surface} \`${left.name}\` and ${right.surface} \`${right.name}\` (${right.path}) ` +
    `name one concept two ways (${relation})`
  );
}
