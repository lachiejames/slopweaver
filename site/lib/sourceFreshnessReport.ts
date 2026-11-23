/**
 * The source-freshness report as `slopweaver automation freshness --json` prints it: the states and sources it may
 * name, how each source reads to a person, and the row and report shapes. How the console words it is
 * `./sourceFreshness.ts`.
 *
 * Imports nothing but types, so the root unit lane typechecks it under both module resolutions.
 */

/** One source's primary state, as the verb decided it. */
export type SourceFreshnessState =
  "current" | "late" | "failing" | "blocked" | "paused" | "unscheduled" | "never-synced" | "unreadable" | "unverified";

/** Every state the verb may send, so the parser refuses one it does not know. */
export const SOURCE_FRESHNESS_STATES: readonly SourceFreshnessState[] = [
  "current",
  "late",
  "failing",
  "blocked",
  "paused",
  "unscheduled",
  "never-synced",
  "unreadable",
  "unverified",
];

/** A corpus source the verb may report — `CorpusSource` in `src/integrations/corpusSources.ts`, restated because this module imports nothing. */
export type SourceFreshnessSource =
  "github" | "slack" | "linear" | "notion" | "gmail" | "calendar" | "fathom" | "chatgpt" | "outlook-calendar";

/**
 * Every source the verb reports — `FETCHABLE_SOURCES`, pinned by `src/__tests__/unit/sourceFreshnessMirror.test.ts`.
 * The parser refuses a report naming one outside it, and one missing any of it: a source absent from the report
 * would read as that source being fine.
 */
export const SOURCE_FRESHNESS_SOURCES: readonly SourceFreshnessSource[] = [
  "github",
  "slack",
  "linear",
  "notion",
  "gmail",
  "calendar",
  "fathom",
  "chatgpt",
  "outlook-calendar",
];

/**
 * How each source reads to a person. The page names a source itself rather than reading the wire's `label`, so no
 * row can draw under another source's name.
 */
export const SOURCE_FRESHNESS_LABELS: Readonly<Record<SourceFreshnessSource, string>> = {
  calendar: "Calendar",
  chatgpt: "ChatGPT",
  fathom: "Fathom",
  github: "GitHub",
  gmail: "Gmail",
  linear: "Linear",
  notion: "Notion",
  "outlook-calendar": "Outlook Calendar",
  slack: "Slack",
};

/** One provider's row, as `automation freshness --json` prints it. */
export interface SourceFreshnessRow {
  readonly source: SourceFreshnessSource;
  readonly label: string;
  readonly windowMs: number;
  readonly lastVerifiedSyncAtIso: string | undefined;
  readonly newestRecordAtIso: string | undefined;
  readonly state: SourceFreshnessState;
  readonly problems: readonly string[];
  readonly blocker: { readonly reason: string; readonly steps: readonly string[] } | undefined;
}

/** The whole report. */
export interface SourceFreshnessReport {
  readonly observedAtIso: string;
  readonly sources: readonly SourceFreshnessRow[];
  readonly issues: readonly string[];
}
