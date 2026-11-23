import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  gatherNothingStaleSection,
  installedCadence,
} from "../../../../../cli/commands/briefing/nothingStaleProjection.js";
import { CYCLE_STANDING_BOUNDS } from "../../../../../cycle/types.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { unwrap } from "../../../../../lib/result.js";
import type { RecipeDefinition } from "../../../../../live/automation/definition.js";
import { GENERIC_STANDING_ROWS } from "../../../../../live/automation/standingRows.js";
import { slackOwedDocument } from "../../../../../live/slack/owedDocument.js";
import { writeSlackOwedDocument } from "../../../../../live/slack/owedStore.js";
import type { BriefingSection } from "../../../../../outbound/briefing/types.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { findingsDigest, renderSweepBoardCensusJson } from "../../../../../sweep/census.js";

const NOW = "2026-09-26T12:00:00.000Z";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

const freshHome = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "sw-nothing-stale-"));
  homes.push(dir);
  return dir;
};

/** Write one hygiene document and stamp its mtime, the freshness clock the reader judges by. */
const writeDocument = ({ path, text, writtenIso }: { path: string; text: string; writtenIso: string }): void => {
  writeFileSync(path, text);
  utimesSync(path, new Date(writtenIso), new Date(writtenIso));
};

/** The one finding the seeded board holds, as its line reads. */
const SEEDED_FINDING = JSON.stringify({
  act: "close",
  slug: "a-dead-leaf",
  verdict: "ORPHANED",
  witness: "its PR merged",
});

/** The four rows whose documents the section reads, as `GENERIC_STANDING_ROWS` declares them. */
const PRODUCING_ROWS = ["hygiene-sweep", "linear-briefing-daily", "sweep-board-daily", "slack-owed-daily"].map(
  (recipeId) => GENERIC_STANDING_ROWS.find((row) => row.definition.recipeId === recipeId)!.definition,
);

/** The declared definition of one producing row. */
const declared = ({ recipeId }: { recipeId: string }): RecipeDefinition =>
  PRODUCING_ROWS.find((definition) => definition.recipeId === recipeId)!;

/**
 * A home holding all five documents and the four producing rows installed (each passed through `edit`), the
 * landing read written at `landingIso` and the census digesting the finding line `censusOf` — the seeded
 * finding unless a case pairs it with another pass's.
 */
const seededHome = ({
  landingIso = NOW,
  censusOf = SEEDED_FINDING,
  edit = (definition) => definition,
}: {
  landingIso?: string;
  censusOf?: string;
  edit?: (definition: RecipeDefinition) => RecipeDefinition;
} = {}): string => {
  const home = freshHome();
  const homePaths = stateHomePaths({ home });
  const paths = homePaths.live.hygiene;
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(homePaths.live.recipe.definitionsDir, { recursive: true });
  PRODUCING_ROWS.forEach((definition) => {
    writeFileSync(
      join(homePaths.live.recipe.definitionsDir, `${definition.recipeId}.json`),
      JSON.stringify(edit(definition)),
    );
  });
  const landing = {
    census: [
      {
        kind: "read",
        pullRequests: [3, 4].map((number) => ({ author: "me", isDraft: false, number })),
        repo: "org/repo",
        viewer: "me",
      },
    ],
    kind: "read",
    people: {},
    presses: [],
    residue: [],
    selection: { author: "@me", includeDrafts: true, repos: ["org/repo"] },
    rows: [
      {
        action: "no-queue",
        askTrail: [],
        blockedOn: [],
        boardRow: { kind: "none-declared" },
        dispatch: { kind: "outside-the-set", why: "no merge queue" },
        headOid: "abcdef1234567890",
        number: 3,
        queue: { kind: "not-queued" },
        repoSlug: "org/repo",
        residue: [],
        title: "A change",
        url: "https://github.com/org/repo/pull/3",
      },
      {
        action: "spawn-ci",
        askTrail: [],
        blockedOn: [],
        boardRow: { kind: "row", slug: "land-org-repo-4-abcdef1" },
        dispatch: { kind: "act", verdict: "rebase-and-fix", why: "red CI" },
        headOid: "abcdef1234567890",
        number: 4,
        queue: { kind: "not-queued" },
        repoSlug: "org/repo",
        residue: [],
        title: "Another change",
        url: "https://github.com/org/repo/pull/4",
      },
    ],
  };
  writeDocument({ path: paths.githubLanding, text: JSON.stringify(landing), writtenIso: landingIso });
  writeDocument({
    path: paths.cycleReconcile,
    text: JSON.stringify({ couldNotSee: CYCLE_STANDING_BOUNDS, proposals: [], proposalsOnly: true }),
    writtenIso: NOW,
  });
  writeDocument({ path: paths.sweepBoard, text: `${SEEDED_FINDING}\n`, writtenIso: NOW });
  const census = {
    census: {
      CONTRADICTED: 0,
      KEEP: 0,
      ORPHANED: 1,
      OVERTAKEN: 0,
      PR_ENDED: 0,
      SHIPPED: 0,
      SUPERSEDED: 0,
      UNCARDED: 0,
      UNWITNESSED: 4,
    },
    findingsSha256: findingsDigest({ lines: [censusOf] }),
    producer: "sweep board" as const,
    scanned: 5,
    schemaVersion: 5 as const,
    swept: 5,
  };
  writeDocument({ path: paths.sweepBoardCensus, text: renderSweepBoardCensusJson({ census }), writtenIso: NOW });
  const owed = slackOwedDocument({
    nowIso: NOW,
    read: {
      couldNotSee: ["the corpus's own copy"],
      movedWithoutOwner: 0,
      movementThreads: [],
      status: "complete",
      taggedWithoutOwner: 0,
      threadsSpokenIn: 0,
      windowDays: 14,
    },
  });
  unwrap(writeSlackOwedDocument({ document: owed, home }));
  return home;
};

/** Every note's headline, flattened to text. */
const headlines = ({ section }: { section: BriefingSection }): readonly string[] =>
  section.notes.map((note) => note.headline.map((run) => run.text).join(""));

describe("gatherNothingStaleSection", () => {
  it("reads all five documents off the home and reports every surface seen", () => {
    const section = unwrap(gatherNothingStaleSection({ home: seededHome(), nowIso: NOW }));
    expect(section.summary).toBe("2 known stale · all five surfaces seen · 4 unproven");
    expect(headlines({ section })).toEqual([
      "Nobody has it — 2",
      "Done for you — 0 moving",
      "Waiting on a named person — 0",
      "Needs your word — 1",
    ]);
  });

  it("reads a pull request moving off its registration's run journal as it stands now", () => {
    const home = seededHome();
    unwrap(
      appendRunEvent({
        event: { atIso: NOW, branch: "b", docHash: "h", kind: "started" },
        runsDir: stateHomePaths({ home }).runs,
        slug: "land-org-repo-4-abcdef1",
      }),
    );
    const section = unwrap(gatherNothingStaleSection({ home, nowIso: NOW }));
    expect(headlines({ section })).toEqual([
      "Nobody has it — 1",
      "Done for you — 1 moving",
      "Waiting on a named person — 0",
      "Needs your word — 1",
    ]);
  });

  it("names pull requests unseen when the landing read is older than its row's cadence allows", () => {
    const section = unwrap(
      gatherNothingStaleSection({ home: seededHome({ landingIso: "2026-09-23T12:00:00.000Z" }), nowIso: NOW }),
    );
    expect(section.summary).toBe("0 known stale; not an all-clear — could not see pull requests · 4 unproven");
    expect(headlines({ section })[0]).toBe("Nobody has it — 0");
  });

  it("refuses a census from another pass than the findings beside it, so yesterday's count never reads as today's", () => {
    const paired = unwrap(gatherNothingStaleSection({ home: seededHome(), nowIso: NOW }));
    const torn = unwrap(
      gatherNothingStaleSection({ home: seededHome({ censusOf: '{"slug":"yesterday"}' }), nowIso: NOW }),
    );
    expect({ paired: paired.summary, torn: torn.summary }).toStrictEqual({
      paired: "2 known stale · all five surfaces seen · 4 unproven",
      torn: "2 known stale; not an all-clear — could not see unproven count",
    });
  });
});

describe("gatherNothingStaleSection over the installed rows", () => {
  it("judges a document by the cadence its installed row carries, not the declared one", () => {
    const landingIso = "2026-09-26T10:30:00.000Z";
    const hourly = seededHome({
      edit: (definition) =>
        definition.recipeId === "hygiene-sweep" ? { ...definition, cadence: "0 * * * *" } : definition,
      landingIso,
    });
    const asDeclared = unwrap(gatherNothingStaleSection({ home: seededHome({ landingIso }), nowIso: NOW }));
    const asInstalled = unwrap(gatherNothingStaleSection({ home: hourly, nowIso: NOW }));
    expect({ asDeclared: asDeclared.summary, asInstalled: asInstalled.summary }).toStrictEqual({
      asDeclared: "2 known stale · all five surfaces seen · 4 unproven",
      asInstalled: "0 known stale; not an all-clear — could not see pull requests · 4 unproven",
    });
  });

  it("names a document unseen when its producing row is paused", () => {
    const paused = seededHome({
      edit: (definition) =>
        definition.recipeId === "slack-owed-daily" ? { ...definition, enabled: false } : definition,
    });
    const section = unwrap(gatherNothingStaleSection({ home: paused, nowIso: NOW }));
    expect(section.summary).toBe("2 known stale; not an all-clear — could not see threads · 4 unproven");
  });
});

describe("installedCadence", () => {
  const sweep = declared({ recipeId: "hygiene-sweep" });

  it("resolves the cadence of the one enabled installed row", () => {
    const edited = { ...sweep, cadence: "0 * * * *" };
    expect(installedCadence({ installed: { definitions: [edited] }, recipeId: "hygiene-sweep" })).toEqual({
      cadence: "0 * * * *",
    });
  });

  it("names a row not installed, rather than guessing a cadence", () => {
    expect(installedCadence({ installed: { definitions: [] }, recipeId: "hygiene-sweep" })).toEqual({
      reason: "0 installed row(s) carry `hygiene-sweep`, so its cadence is unknown",
    });
  });

  it("names a doubled row, since two cadences cannot both be the one that fires", () => {
    expect(installedCadence({ installed: { definitions: [sweep, sweep] }, recipeId: "hygiene-sweep" })).toEqual({
      reason: "2 installed row(s) carry `hygiene-sweep`, so its cadence is unknown",
    });
  });

  it("names an enabled row a standing hold keeps off, and judges one whose hold was cleared by its cadence", () => {
    const hold = { askedIso: "2026-09-25T00:00:00.000Z", reason: "owner hold" };
    const held = { ...sweep, hold: { ...hold, clearedBy: null } };
    const cleared = { ...sweep, hold: { ...hold, clearedBy: { atIso: "2026-09-25T01:00:00.000Z", runSlug: "r" } } };
    expect({
      cleared: installedCadence({ installed: { definitions: [cleared] }, recipeId: "hygiene-sweep" }),
      held: installedCadence({ installed: { definitions: [held] }, recipeId: "hygiene-sweep" }),
    }).toStrictEqual({
      cleared: { cadence: sweep.cadence },
      held: { reason: "the installed row `hygiene-sweep` is held, so nothing refreshes its document" },
    });
  });

  it("names a paused row", () => {
    expect(
      installedCadence({ installed: { definitions: [{ ...sweep, enabled: false }] }, recipeId: "hygiene-sweep" }),
    ).toEqual({ reason: "the installed row `hygiene-sweep` is paused, so nothing refreshes its document" });
  });

  it("carries a directory that would not list through as the reason", () => {
    expect(installedCadence({ installed: { reason: "it would not list" }, recipeId: "hygiene-sweep" })).toEqual({
      reason: "it would not list",
    });
  });
});
