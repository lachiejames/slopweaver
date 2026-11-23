/**
 * The throwaway home, synthetic board rows and recording fakes `sampleDraw.test.ts` and `sample.test.ts` drive
 * `value sample` with. Every seam is a plain function passed in; the sample itself is kept in a real temp home.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import type { CardReceipt, ValueSampleDeps } from "../../../../../cli/commands/value/sample.js";
import type { TranscriptSpend } from "../../../../../sessions/spendFold.js";
import type { BoardAskRow, SeatSpawn } from "../../../../../value/sample.js";

/** A Wednesday noon, so the ISO week is 2026-W48 in every timezone a test machine runs in. */
export const NOW = "2026-11-25T12:00:00.000Z";

/** The week {@link NOW} falls in. */
export const WEEK = "2026-W48";

/** The one pull request the eligible ask names. */
export const PR_URL = "https://github.com/acme/widgets/pull/7";

/**
 * One board row: an ask answered the day before {@link NOW}, naming {@link PR_URL}, unless overridden.
 *
 * @returns the row, with every overridden field replaced
 */
export const boardRow = (over: Partial<BoardAskRow> = {}): BoardAskRow => ({
  artifact: undefined,
  kind: "ask",
  prUrls: [PR_URL],
  settledIso: "2026-11-24T09:00:00.000Z",
  settlement: "answered",
  settlementWitness: "https://acme.slack.com/archives/C0FIXTURE/p1",
  slug: "acme-ask",
  summary: "Export the widget report",
  ...over,
});

/** A board holding the one eligible ask beside a doc and an ask that ended outside the week. */
const BOARD: readonly BoardAskRow[] = [
  boardRow(),
  boardRow({ kind: "doc", slug: "acme-doc" }),
  boardRow({ settledIso: "2026-11-01T09:00:00.000Z", slug: "acme-old" }),
];

/** The seat spawned for the eligible ask. */
const SEAT: SeatSpawn = { cwd: "/work/acme-ask", slug: "acme-ask" };

/** One transcript run in the seat: 100 fresh input and 10 output tokens on Sonnet 5 over two turns. */
const TRANSCRIPT: TranscriptSpend = {
  contextFloor: null,
  cwd: "/work/acme-ask",
  path: "/work/acme-ask/t.jsonl",
  refusals: { other: 0, "poll-gate": 0, python: 0, "raw-side-effect": 0, "shell-script": 0, "whole-tree": 0 },
  seat: "handover-seat",
  unreadable: 0,
  usage: [
    {
      day: "2026-11-24",
      model: "claude-sonnet-5-20260101",
      totals: { cacheCreationTokens: 0, cacheReadTokens: 0, inputTokens: 100, outputTokens: 10, turns: 2 },
    },
  ],
};

/** What the fakes were asked, in order. */
export interface Seen {
  readonly rowReads: string[];
  readonly prReads: string[];
  readonly published: string[];
  readonly cards: { readonly week: string; readonly pageUrl: string }[];
  readonly out: string[];
  readonly diagnostics: string[];
}

/** The seams a case may replace; every other one answers as a healthy install would. */
export interface Overrides {
  readonly rows?: Result<readonly BoardAskRow[]>;
  readonly spawns?: Result<readonly SeatSpawn[]>;
  readonly publishFails?: string;
}

/** Every home {@link freshHome} minted and no test has yet removed; each test file's `afterEach` drains it. */
export const mintedHomes: string[] = [];

/**
 * A fresh throwaway home, listed in {@link mintedHomes} for its test file to remove.
 *
 * @returns the new home's path
 */
export const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "value-sample-"));
  mintedHomes.push(home);
  return home;
};

/**
 * The verb's seams over plain fakes, and the record of what each was asked.
 *
 * @returns the seams and the record they fill
 */
export const fakeDeps = ({ rows, spawns, publishFails }: Overrides = {}): { deps: ValueSampleDeps; seen: Seen } => {
  const seen: Seen = { cards: [], diagnostics: [], out: [], prReads: [], published: [], rowReads: [] };
  const deps: ValueSampleDeps = {
    fetchPr: ({ number, owner, repo }) => {
      seen.prReads.push(`${owner}/${repo}#${String(number)}`);
      return Promise.resolve(
        ok({ mergeCommitOid: "0".repeat(40), mergedAt: "2026-11-24T08:00:00Z", state: "MERGED" as const, url: PR_URL }),
      );
    },
    nowIso: () => NOW,
    placeCard: ({ pageUrl, sample }) => {
      seen.cards.push({ pageUrl, week: sample.week });
      return Promise.resolve(ok<CardReceipt>("placed"));
    },
    publish: ({ slug }) => {
      seen.published.push(slug);
      if (publishFails !== undefined) {
        return Promise.resolve(err([publishFails]));
      }
      const frozen = { frozenIso: NOW, key: slug, sha256: `sha256:${"0".repeat(64)}` };
      return Promise.resolve(ok({ bytes: 1, frozen, path: `/pages/${slug}`, url: `slopweaver-page://${slug}` }));
    },
    readRows: ({ home }) => {
      seen.rowReads.push(home);
      if (rows !== undefined) {
        return rows;
      }
      return ok(BOARD);
    },
    readSpawns: () => {
      if (spawns !== undefined) {
        return spawns;
      }
      return ok([SEAT]);
    },
    readTranscripts: () => ok([TRANSCRIPT]),
    writeDiagnostic: (line) => {
      seen.diagnostics.push(line);
    },
    writeOut: (line) => {
      seen.out.push(line);
    },
  };
  return { deps, seen };
};
