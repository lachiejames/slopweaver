/**
 * `briefing card --drop`'s shared test fixtures: the open-pages document, a lock-in ledger line and a board row
 * read whole — built here once so the ledger tests and the `--settled-by` tests drop from the SAME document.
 */
import type { SettlingRowReading } from "../../../briefing/openPageDrop.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";

/** The instant every drop is judged at. */
export const NOW = "2026-10-14T09:00:00Z";
/** The page most cases drop. */
export const TRELICA = "https://claude.ai/code/artifact/3eb11d97-9d46-46f6-ae79-b85e441e86b8";
/** A second hosted page, which a drop must leave alone. */
export const OTHER = "https://claude.ai/code/artifact/eaa67d62-9ccf-4603-8bd6-d3e53d432d7e";
/** A local page, keyed `page:<slug>` in the ledger. */
export const LOCAL = "file:///Users/owner/.slopweaver/pages/worker-card-clock/index.html";

/**
 * One open-pages row carrying the four fields the index reads, plus whatever `over` adds.
 *
 * @param over extra keys the row carries, which a drop must keep untouched
 * @returns the row
 */
export function row({ url, over = {} }: { url: string; over?: Record<string, unknown> }): Record<string, unknown> {
  return { ask: "Your word on the page.", label: `page at ${url}`, landedIso: "2026-09-12T19:00:00Z", url, ...over };
}

/**
 * One lock-in ledger line, as `session-start lock-in` writes it.
 *
 * @param over extra or replacement keys on the serialised line
 * @returns the line, unterminated
 */
export function lockIn({
  identity,
  outcome,
  verb = "do",
  againstWhenIso = "2026-09-12T20:00:00Z",
  over = {},
}: {
  identity: string;
  outcome: string;
  verb?: string;
  againstWhenIso?: string;
  over?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    againstWhenIso,
    identity,
    outcome,
    proposed: "the lean",
    schemaVersion: 1,
    tsIso: "2026-09-12T21:27:58.761Z",
    verb,
    ...over,
  });
}

/**
 * A board row read whole: a doc carrying these front-matter lines, and its journal.
 *
 * @param lines front-matter lines after the slug
 * @returns the row as `--settled-by` reads it
 */
export function boardRow({
  lines,
  events = [],
}: {
  lines: readonly string[];
  events?: readonly RunEvent[];
}): SettlingRowReading {
  const text = ["---", "slug: the-row", ...lines, "---", "# doc", ""].join("\n");
  return { doc: parseHandoverDoc({ path: "/home/handovers/the-row.md", text }), events, kind: "read", slug: "the-row" };
}

/**
 * A settled ask's front-matter, publishing `artifact`.
 *
 * @returns the front-matter lines
 */
export function settledAsk({ artifact }: { artifact: string }): readonly string[] {
  return [
    "kind: ask",
    'summary: "a finding"',
    "status: ready",
    "askedIso: 2026-09-29T00:53:31.075Z",
    "origin: finding",
    "observedBy: a-session",
    "evidence: [a log line]",
    "blockedBy: []",
    `artifact: ${artifact}`,
    "doneWhen: []",
    "settlement: filed",
    "settlementWitness: the-fix-row",
  ];
}

/** Three rows, TRELICA in the middle, each carrying a key the index does not read. */
export const DOCUMENT: readonly unknown[] = [
  row({ over: { previousUrl: "https://example.test/v1", readiness: { lane: "a" } }, url: OTHER }),
  row({ over: { detail: "unknown key kept" }, url: TRELICA }),
  row({ over: { zebra: [1, 2, 3] }, url: LOCAL }),
];
