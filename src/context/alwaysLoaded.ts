/**
 * The always-loaded context every session gets, whatever project it is in — and the seam a second
 * provider joins.
 *
 * What is known about the owner must be GLOBAL rather than per Claude project, and loading it needs mechanical
 * enforcement, so it is loaded when it needs to be. A session that remembers to read a file is
 * not enforcement; a hook that puts the text in front of it before it acts is.
 *
 * ## Why this is a PROVIDER list rather than one renderer
 *
 * A second always-loaded source is settled: certain learnings are always loaded in Claude project memory, but
 * very few and far between, and most things go into something more retrieval based. That memories table is its own board row
 * (`learnings-are-retrieved-from-a-supabase-memories-table-few-always-loaded`) and is deliberately NOT
 * built here. What is built here is the envelope it lands in: this module owns the ordering, the
 * marker and the status rendering, so that row adds a `memories` section and changes no hook, no CLI verb
 * and no test of delivery. Reserving its table, its columns or an empty-success reader for it would be
 * worse than reserving nothing — a fake empty reader reports "no memories" on a machine where the table
 * does not exist, which is the shape `a-check-that-cannot-fail-reports-clean` names.
 *
 * ## Every section says what it IS, including when it is not there
 *
 * A section carries a status rather than being omitted when it fails, because omission is the one thing a
 * reader cannot interpret: a session cannot tell "the owner has no recorded ways of working" from "the database
 * was down". `unavailable` prints and says why, which is the difference between a gap a session works
 * around and a gap it does not know it has.
 */

/** Which always-loaded source a section came from. A new provider is a new member here and nowhere else. */
export type ContextProvider = "owner-profile" | "voice-register" | "memories";

/** Whether a section has content, genuinely has none, or could not be read at all. *
 * @internal
 */
export type ContextStatus = "loaded" | "empty" | "unavailable";

/** One always-loaded source's contribution, whatever happened when it was read. */
export interface AlwaysLoadedSection {
  readonly provider: ContextProvider;
  /** The heading a session reads, e.g. `About the owner`. */
  readonly title: string;
  readonly status: ContextStatus;
  /** The content, one line each. Empty unless `status` is `loaded`. */
  readonly lines: readonly string[];
  /** Why there is nothing, on `empty` or `unavailable`. Empty string on `loaded`. */
  readonly detail: string;
  /** The row revision this content came from, so a reader can tell two renders apart. `null` when none. */
  readonly revision: number | null;
}

/**
 * The line every injected context block opens with, and the witness a delivery test greps for.
 *
 * A constant rather than a phrase each caller spells, because the negative control depends on it: break
 * the hook registration, run a real session, and the absence of THIS string is the evidence. A check
 * whose witness cannot be named is a check that reports clean when it never ran.
 */
export const ALWAYS_LOADED_MARKER = "[slopweaver] always-loaded context";

/** How a cached block announces its own age rather than passing itself off as a live read. */
export const STALE_CACHE_PREFIX = "SOURCE IS A CACHE";

/** One section as the lines it contributes, heading included, whatever its status. */
function sectionLines({ section }: { section: AlwaysLoadedSection }): readonly string[] {
  const revision = section.revision === null ? "" : ` (revision ${String(section.revision)})`;
  if (section.status === "loaded") {
    return [`## ${section.title}${revision}`, ...section.lines];
  }
  return [`## ${section.title}`, `${section.status}: ${section.detail}`];
}

/**
 * Every section as one block of text, opening with the marker.
 *
 * Returns an empty array when there are no sections AT ALL, which is the only silence this produces: a
 * hook with nothing registered stays quiet rather than injecting a header with nothing under it. A
 * section that failed is not silence — it is a section that says it failed.
 *
 * @param sections what each provider returned, in the order they should be read
 * @param capturedAtIso when the content was read from the store, which is not when it is being injected
 *   if it came from a cache
 * @param staleReason set when these lines come from a cache rather than a live read, saying how old and
 *   why — printed directly under the marker so a session cannot miss it
 * @returns the lines to inject, or none
 */
export function buildAlwaysLoadedContext({
  sections,
  capturedAtIso,
  staleReason = "",
}: {
  sections: readonly AlwaysLoadedSection[];
  capturedAtIso: string;
  staleReason?: string;
}): readonly string[] {
  if (sections.length === 0) {
    return [];
  }
  return [
    ...contextHeaderLines({ capturedAtIso, staleReason }),
    ...sections.flatMap((section) => sectionLines({ section })),
  ];
}

/**
 * The marker line, and the stale banner under it when these lines came from a cache.
 *
 * Exported because the cache path emits stored lines rather than re-rendering sections, and a header
 * built a second way is a header that drifts — the marker is the witness a delivery test greps for, so
 * exactly one function may spell it.
 *
 * @param capturedAtIso when the content was read from the store
 * @param staleReason how old this cache is and why the live read failed, empty on a live read
 * @returns the header lines
 */
export function contextHeaderLines({
  capturedAtIso,
  staleReason = "",
}: {
  capturedAtIso: string;
  staleReason?: string;
}): readonly string[] {
  const header = [`${ALWAYS_LOADED_MARKER} — read at ${capturedAtIso}`];
  if (staleReason.length > 0) {
    header.push(`${STALE_CACHE_PREFIX}: ${staleReason}`);
  }
  return header;
}

/**
 * A section that could not be read, carrying the reason instead of vanishing.
 *
 * @param provider which source failed
 * @param title the heading it would have printed under
 * @param detail why — a store refusal's own message, never a paraphrase
 * @returns the section
 */
export function unavailableSection({
  provider,
  title,
  detail,
}: {
  provider: ContextProvider;
  title: string;
  detail: string;
}): AlwaysLoadedSection {
  return { detail, lines: [], provider, revision: null, status: "unavailable", title };
}
