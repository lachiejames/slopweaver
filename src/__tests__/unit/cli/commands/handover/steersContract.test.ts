/**
 * The PRODUCER half of the `handover steers --json` contract: what the verb prints, pinned to a golden file the
 * console's reader (`site/components/live/readSteers.ts`) is tested against in `site/__tests__/unit/readSteers.test.ts`.
 * The two halves live in separate Yarn projects and neither may import the other's graph, so they meet in ONE file,
 * `src/__tests__/fixtures/contract/handover-steers.json`.
 *
 * The report holds one steer in each state the verb writes — applied by branch and by witness with no ledger branch,
 * settled with and without a witness PR, in flight, landing unknown — every origin kind, a repository read and one
 * unread, and the absent fields the replacer writes as `null`.
 *
 * A change to what the verb prints fails here until the golden is re-cut (`yarn vitest run --config
 * config/vitest/unit.ts <this file> --update`), and the re-cut golden fails the site half until the reader draws it.
 */
import { describe, expect, it } from "vitest";

import { steersJson } from "../../../../../cli/commands/handover/steersRun.js";
import type { SteersReport } from "../../../../../handover/steersRead.js";

/** Where both halves read the contract; relative to this file, as `toMatchFileSnapshot` resolves it. */
const GOLDEN = "../../../../fixtures/contract/handover-steers.json";

const CALL = "talk-call:a0000055-0000-4000-8000-000000000061#turn_000000000000000000005";

const LANDING = {
  branch: "a-console-page",
  mergedIso: "2026-10-05T15:00:00+00:00",
  number: 1880,
  title: "A console page shows each steer",
  url: "https://github.com/lachiejames/slopweaver/pull/1880",
};

const WORDS = {
  anchor: CALL,
  atIso: "2026-10-05T11:42:00.000Z",
  cut: "none",
  where: "call",
  words: "are you still there?",
};

/** A report holding one steer in each state the verb writes. */
const REPORT: SteersReport = {
  observedAtIso: "2026-10-06T02:00:00.000Z",
  repos: [
    {
      commits: 3,
      dir: "/repos/slopweaver",
      kind: "read",
      ledgerUnread: 2,
      ref: "origin/main",
      refSha: "da5921b065",
      repo: "lachiejames/slopweaver",
      unjoined: 4,
    },
    { dir: "/repos/gone", kind: "unread", why: "no origin/main" },
  ],
  steers: [
    {
      againIsos: ["2026-10-05T11:50:00.000Z", undefined],
      askedIso: "2026-10-05T11:42:00.000Z",
      origin: { anchor: CALL, kind: "cut" },
      repo: "/repos/slopweaver",
      slug: "applied",
      state: { kind: "applied", landing: LANDING, via: "branch" },
      timesGiven: 3,
      title: "A console page shows each steer",
      words: WORDS,
    },
    {
      againIsos: [],
      askedIso: undefined,
      origin: { kind: "named-in-text", turn: "turn_000000000000000000009" },
      repo: undefined,
      slug: "settled",
      state: { kind: "settled", settlement: "filed", witness: undefined, witnessPr: undefined },
      timesGiven: 1,
      title: "settled",
      words: undefined,
    },
    {
      againIsos: [],
      askedIso: "2026-10-04T10:00:00.000Z",
      origin: { anchor: "talk:5a828261-0000-4000-8000-000000000001", kind: "relay-taken-up" },
      repo: "/repos/slopweaver",
      slug: "on-a-pr",
      state: {
        kind: "settled",
        settlement: "filed",
        witness: "https://github.com/other/repo/pull/7",
        witnessPr: { number: 7, repo: "other/repo" },
      },
      timesGiven: 1,
      title: "on a pr",
      words: undefined,
    },
    {
      againIsos: [],
      askedIso: undefined,
      origin: { anchor: CALL, kind: "cut" },
      repo: "/repos/slopweaver",
      slug: "moving",
      state: { branch: undefined, kind: "in-flight" },
      timesGiven: 1,
      title: "moving",
      words: undefined,
    },
    {
      againIsos: [],
      askedIso: undefined,
      origin: { anchor: CALL, kind: "cut" },
      repo: undefined,
      slug: "unledgered",
      state: { kind: "applied", landing: { ...LANDING, branch: undefined }, via: "witness" },
      timesGiven: 1,
      title: "unledgered",
      words: undefined,
    },
    {
      againIsos: [],
      askedIso: undefined,
      origin: { anchor: CALL, kind: "cut" },
      repo: undefined,
      slug: "unknown",
      state: { kind: "landing-unknown", why: "no repository" },
      timesGiven: 1,
      title: "unknown",
      words: undefined,
    },
  ],
  unreadableDocs: 0,
  unreadableJournals: ["broken-journal"],
};

describe("handover steers --json, the contract the console reads", () => {
  it("prints exactly the golden the console's reader is tested against", async () => {
    // Re-indented so a re-cut golden diffs line by line; the bytes the console parses are the same document.
    const printed: unknown = JSON.parse(steersJson({ report: REPORT }));
    await expect(`${JSON.stringify(printed, null, 2)}\n`).toMatchFileSnapshot(GOLDEN);
  });
});
