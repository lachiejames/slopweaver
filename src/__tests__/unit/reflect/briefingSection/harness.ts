/*
 * What more than one self-improvement briefing section test file reads: the finding and ranked-finding builders, a
 * summary of an exact word count, a note's headline as text and the renderer unwrapped. A plain module, not a
 * `*.test.ts`, so no test registers twice. It was split out when the section's suite became one file per behaviour.
 */
import { unwrap } from "#lib/result.js";

import type { BriefingNote, BriefingSection } from "../../../../outbound/briefing/types.js";
import { textOfContent } from "../../../../outbound/briefing/vocabulary.js";
import { renderSelfImprovementSection } from "../../../../reflect/briefingSection.js";
import type { FrictionFinding } from "../../../../reflect/finding.js";
import type { RankedFinding } from "../../../../reflect/rank.js";

/**
 * A live, uncovered finding, overridden per test.
 *
 * @returns the default finding with each overridden field replaced
 */
export const finding = (over: Partial<FrictionFinding> = {}): FrictionFinding => ({
  classKey: "probe-filter",
  consequence: "a measured cost",
  cost: 2,
  coveredBy: [],
  evidence: ["run a-doc amended: probe used --filter"],
  firstSeenIso: "2026-09-19T01:00:00.000Z",
  impact: 3,
  knownBy: [],
  lastSeenIso: "2026-09-19T02:00:00.000Z",
  locus: "handover amend",
  occurrences: 4,
  refutedBy: [],
  safety: 4,
  source: "run-journal",
  summary: "4 run(s) amended a live brief over the same thing",
  ...over,
});

/**
 * The default {@link finding} as ranked and never closed, overridden per test.
 *
 * @returns the default ranked finding with each overridden field replaced
 */
export const ranked = (over: Partial<RankedFinding> = {}): RankedFinding => ({
  baseImpact: 3,
  closedAtIso: undefined,
  closedBy: undefined,
  daysSeen: 2,
  finding: finding(),
  grade: undefined,
  id: "f91d4dadf2d0",
  priorSurfacings: 1,
  score: 6,
  ...over,
});

/**
 * A summary of exactly `words` words, so a budget boundary is arithmetic rather than a guess.
 *
 * @returns that many distinct words, joined by single spaces
 */
export const summaryOf = ({ words }: { words: number }): string =>
  Array.from({ length: words }, (_, index) => `w${String(index)}`).join(" ");

/**
 * Read a note's headline as the text a reader sees.
 *
 * @returns the headline's content flattened to one string
 */
export const headlineText = ({ note }: { note: BriefingNote }): string => textOfContent({ content: note.headline });

/**
 * Render the section for a case that expects it to succeed, nothing held back by default.
 *
 * @returns the rendered section, throwing on an unexpected refusal
 */
export const render = ({
  findings,
  notShown = 0,
}: {
  findings: readonly RankedFinding[];
  notShown?: number;
}): BriefingSection => unwrap(renderSelfImprovementSection({ findings, notShown }));
