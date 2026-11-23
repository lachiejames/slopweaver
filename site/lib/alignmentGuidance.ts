/**
 * The Alignment page's guidance section, decided: what the closed fold says above it, and how the sources group by
 * rank inside it. The reader is `../components/live/readGuidance.ts`; the component `../components/console/AlignmentGuidance.tsx`.
 *
 * Every source is counted above the fold, an empty one as `empty` and one that would not read as `not read`, so a
 * zero is never mistaken for a source nobody looked in. Pure.
 */

/** The three ranks, highest first, as `src/profile/guidanceWire.ts` names them. */
export type GuidanceLevel = "doctrine" | "standing-rules" | "rulings";

/**
 * Every source the wire must carry, as `src/profile/guidanceWire.ts`'s `GUIDANCE_SOURCES` lists them. The reader refuses a
 * wire missing one: a source left out would never be named as not read, so a page or card would show nothing where
 * nobody looked.
 */
export const GUIDANCE_SOURCE_IDS: readonly string[] = [
  "doctrine",
  "class-steers",
  "general-rulings",
  "ruling-gates",
  "standing-asks",
  "memories",
  "owner-profile",
];

/**
 * One entry as the page reads it: its line and citation, the whole of what it says, and — for a class steer only — the
 * exact kinds of act it settles and the subject scope it settles them under (`src/profile/guidanceWire.ts`'s `GuidanceEntry`).
 */
export interface GuidanceEntryView {
  readonly text: string;
  readonly citation: string;
  readonly body: string;
  readonly kinds: readonly string[];
  readonly subjectPrefix: string | null;
}

/** One source as the page reads it. */
export interface GuidanceSourceView {
  readonly id: string;
  readonly label: string;
  readonly level: GuidanceLevel;
  readonly state:
    | { readonly kind: "read"; readonly entries: readonly GuidanceEntryView[]; readonly gaps: readonly string[] }
    | { readonly kind: "unreadable"; readonly why: string };
}

/** The whole read. */
export interface GuidanceView {
  readonly readAtIso: string;
  readonly sources: readonly GuidanceSourceView[];
}

/** Each rank's heading inside the fold, highest first. */
export const GUIDANCE_LEVEL_HEADINGS: readonly { readonly level: GuidanceLevel; readonly heading: string }[] = [
  { heading: "Doctrine: binds every session", level: "doctrine" },
  { heading: "Standing rules: settle a whole class of act", level: "standing-rules" },
  { heading: "Rulings, asks and memory: narrower than a standing rule", level: "rulings" },
];

/**
 * A read source's count: `empty` only when it holds no entry AND every part of it read, because a part that would
 * not read (a run journal, a memory corpus) may hold exactly the guidance the count would otherwise call absent.
 *
 * @param entries how many entries read
 * @param gaps how many parts of the source would not read
 * @returns `empty`, `<n>`, `not read (<g>)`, or `<n>, <g> not read`
 */
function countPhrase({ entries, gaps }: { entries: number; gaps: number }): string {
  if (gaps === 0) {
    return entries === 0 ? "empty" : String(entries);
  }
  return entries === 0 ? `not read (${String(gaps)})` : `${String(entries)}, ${String(gaps)} not read`;
}

/**
 * One source's count as the closed fold prints it. A source with a part that would not read is never `empty` and
 * never a bare count.
 *
 * @returns `<label> <n>`, `<label> empty`, `<label> not read`, `<label> not read (<g>)` or `<label> <n>, <g> not read`
 */
export function guidanceCountOf({ source }: { source: GuidanceSourceView }): string {
  if (source.state.kind === "unreadable") {
    return `${source.label} not read`;
  }
  const { entries, gaps } = source.state;
  return `${source.label} ${countPhrase({ entries: entries.length, gaps: gaps.length })}`;
}

/** One line under a source inside the open fold. */
export type GuidanceItem =
  | { readonly kind: "entry"; readonly text: string; readonly citation: string }
  | { readonly kind: "empty" }
  | { readonly kind: "not-read"; readonly why: string };

/**
 * The lines the open fold draws under one source: its entries, then a `not read` line per part that would not read.
 * `empty` stands alone, and only when the source held no entry and every part of it read.
 *
 * @returns the lines, in the order the fold draws them
 */
export function guidanceItemsOf({ source }: { source: GuidanceSourceView }): readonly GuidanceItem[] {
  if (source.state.kind === "unreadable") {
    return [{ kind: "not-read", why: source.state.why }];
  }
  const { entries, gaps } = source.state;
  if (entries.length === 0 && gaps.length === 0) {
    return [{ kind: "empty" }];
  }
  return [
    ...entries.map((entry): GuidanceItem => ({ citation: entry.citation, kind: "entry", text: entry.text })),
    ...gaps.map((gap): GuidanceItem => ({ kind: "not-read", why: gap })),
  ];
}

/**
 * The sources grouped under each rank, in rank order, a rank with no source left out.
 *
 * @param view the read
 * @returns each rank's heading and its sources, in the wire's order within a rank
 */
export function guidanceByLevel({
  view,
}: {
  view: GuidanceView;
}): readonly { readonly heading: string; readonly sources: readonly GuidanceSourceView[] }[] {
  return GUIDANCE_LEVEL_HEADINGS.map(({ heading, level }) => ({
    heading,
    sources: view.sources.filter((source) => source.level === level),
  })).filter((group) => group.sources.length > 0);
}
