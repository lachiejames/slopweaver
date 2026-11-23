/*
 * Every steer the owner gave on a call and where it stands (`src/handover/steers.ts`): which rows count, how each is joined to
 * main, and the order the page draws them in. Every row is read back through the real `parseHandoverDoc`, the owner's words
 * written by the same `hisWordsFields` the verbs call.
 */
import { describe, expect, it } from "vitest";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import type { HisWords } from "../../../handover/hisWords.js";
import { hisWordsFields } from "../../../handover/hisWords.js";
import { hisWordsSteerFields } from "../../../handover/hisWordsSteers.js";
import { NO_RUN, type RunState } from "../../../handover/ledger.js";
import {
  mayBeSteer,
  type RepoLandings,
  type SteerLanding,
  type SteerState,
  steerStateOf as stateOfRow,
  steerOriginOf,
  steersOf,
  turnTokenIn,
  witnessPrOf,
} from "../../../handover/steers.js";

const CALL = "talk-call:a0000055-0000-4000-8000-000000000061#turn_000000000000000000005";
const RELAY = "talk:5a828261-0000-4000-8000-000000000001";
/** Further turns of the same call — a further steer must quote a record the row does not already quote. */
const CALL_AGAIN = "talk-call:a0000055-0000-4000-8000-000000000061#turn_000000000000000000006";
const CALL_THIRD = "talk-call:a0000055-0000-4000-8000-000000000061#turn_000000000000000000007";
const CALL_FOURTH = "talk-call:a0000055-0000-4000-8000-000000000061#turn_000000000000000000008";
const TURN = "turn_000000000000000000009";
const REPO_DIR = "/repos/slopweaver";

const WORDS: HisWords = {
  anchor: CALL,
  atIso: "2026-10-05T11:42:00.000Z",
  cut: "none",
  where: "call",
  words: "one page listing every steer given, oldest first",
};

/** A row, read back through the real parser, with the given extra front-matter lines. */
function row({ slug, extra = [] }: { slug: string; extra?: readonly string[] }): HandoverDoc {
  const text = ["---", `slug: ${slug}`, "kind: doc", "status: ready", ...extra, "---", "", `# ${slug}`, ""];
  return parseHandoverDoc({ path: `/h/${slug}.md`, text: text.join("\n") });
}

/** The front-matter lines the owner's own words on a row are written as. */
function wordsLines({ words }: { words: HisWords }): readonly string[] {
  return hisWordsFields({ record: { hisWords: words, kind: "held" } }).map((field) => `${field.key}: ${field.value}`);
}

/** A run that started on `branch` and is in `phase`. */
function runOn({ branch, phase }: { branch: string; phase: RunState["phase"] }): RunState {
  return { ...NO_RUN, branch, entries: 2, phase };
}

/** A landing of PR `number` from `branch`, `undefined` for one the PR ledger holds no record of. */
function landing({ number, branch }: { number: number; branch: string | undefined }): SteerLanding {
  return {
    branch,
    mergedIso: "2026-10-05T15:00:00+00:00",
    number,
    title: `PR ${String(number)}`,
    url: `https://github.com/lachiejames/slopweaver/pull/${String(number)}`,
  };
}

/** A main read with the given landings on it, as the reader keys them: by number always, by branch when known. */
function mainWith({
  landings,
  repo = "lachiejames/slopweaver",
}: {
  landings: readonly SteerLanding[];
  repo?: string;
}): Extract<RepoLandings, { kind: "read" }> {
  return {
    byBranch: new Map(landings.flatMap((one) => (one.branch === undefined ? [] : [[one.branch, one] as const]))),
    byNumber: new Map(landings.map((one) => [one.number, one])),
    kind: "read",
    ref: "origin/main",
    refSha: "da5921b065",
    repo,
  };
}

const EMPTY_MAIN = mainWith({ landings: [] });

/** A row's state against its own main, which is also the only main read, its journal read unless said otherwise. */
function steerStateOf({
  doc,
  landings,
  run,
  runUnread = false,
}: {
  doc: HandoverDoc;
  landings: RepoLandings | undefined;
  run: RunState;
  runUnread?: boolean;
}): SteerState {
  const readMains = landings?.kind === "read" ? [landings] : [];
  return stateOfRow({ doc, landings, readMains, run, runUnread });
}

describe("turnTokenIn", () => {
  it("finds an exact call-turn id in a row's text", () => {
    expect(turnTokenIn({ text: `relay ${TURN}: make the page` })).toBe(TURN);
  });

  it("finds none in text naming no turn, nor in no text", () => {
    expect(turnTokenIn({ text: "turn_short is not one" })).toBe(undefined);
    expect(turnTokenIn({ text: undefined })).toBe(undefined);
  });
});

describe("steerOriginOf", () => {
  it("counts a row anchored to a call turn as cut from the call", () => {
    const doc = row({ extra: [`anchor: ${CALL}`], slug: "cut" });
    expect(steerOriginOf({ doc, run: NO_RUN })).toEqual({ anchor: CALL, kind: "cut" });
  });

  it("counts a relay row only once a session started a run on it", () => {
    const doc = row({ extra: [`anchor: ${RELAY}`], slug: "relay" });
    expect(steerOriginOf({ doc, run: NO_RUN })).toBe(undefined);
    expect(steerOriginOf({ doc, run: runOn({ branch: "relay", phase: "closed" }) })).toEqual({
      anchor: RELAY,
      kind: "relay-taken-up",
    });
  });

  it("counts an unanchored row naming a call turn in its summary, flagged as named in text", () => {
    const doc = row({ extra: [`summary: steer from ${TURN} — the page`], slug: "named" });
    expect(steerOriginOf({ doc, run: NO_RUN })).toEqual({ kind: "named-in-text", turn: TURN });
  });

  it("does not count a row anchored anywhere else, even naming a turn and run", () => {
    const doc = row({
      extra: ["anchor: transcript:a0000007-0000-4000-8000-000000000008#33dac8fe", `summary: about ${TURN}`],
      slug: "elsewhere",
    });
    expect(steerOriginOf({ doc, run: runOn({ branch: "elsewhere", phase: "open" }) })).toBe(undefined);
    expect(mayBeSteer({ doc })).toBe(false);
  });

  it("does not count an unanchored row naming no turn", () => {
    const doc = row({ extra: ["summary: tidy the docs"], slug: "plain" });
    expect(steerOriginOf({ doc, run: NO_RUN })).toBe(undefined);
    expect(mayBeSteer({ doc })).toBe(false);
  });
});

describe("witnessPrOf", () => {
  it("reads a pull-request URL's repository and number", () => {
    expect(witnessPrOf({ witness: "https://github.com/lachiejames/slopweaver/pull/1878" })).toEqual({
      number: 1878,
      repo: "lachiejames/slopweaver",
    });
  });

  it("reads nothing from a witness that is not one", () => {
    expect(witnessPrOf({ witness: "answered in thread" })).toBe(undefined);
    expect(witnessPrOf({ witness: "https://github.com/lachiejames/slopweaver/issues/3" })).toBe(undefined);
    expect(witnessPrOf({ witness: undefined })).toBe(undefined);
  });
});

describe("steerStateOf", () => {
  it("is applied when a PR from the row's declared branch landed, ahead of the run's and the slug's", () => {
    const doc = row({ extra: [`anchor: ${CALL}`, "branch: declared"], slug: "the-slug" });
    const main = mainWith({
      landings: [
        landing({ branch: "declared", number: 1 }),
        landing({ branch: "recorded", number: 2 }),
        landing({ branch: "the-slug", number: 3 }),
      ],
    });
    const state = steerStateOf({ doc, landings: main, run: runOn({ branch: "recorded", phase: "closed" }) });
    expect(state).toEqual({ kind: "applied", landing: landing({ branch: "declared", number: 1 }), via: "branch" });
  });

  it("joins by the run's recorded branch, then by the slug", () => {
    const doc = row({ extra: [`anchor: ${CALL}`], slug: "the-slug" });
    const both = mainWith({
      landings: [landing({ branch: "recorded", number: 2 }), landing({ branch: "the-slug", number: 3 })],
    });
    const recorded = steerStateOf({ doc, landings: both, run: runOn({ branch: "recorded", phase: "closed" }) });
    expect(recorded).toEqual({ kind: "applied", landing: landing({ branch: "recorded", number: 2 }), via: "branch" });
    const bySlug = steerStateOf({ doc, landings: both, run: NO_RUN });
    expect(bySlug).toEqual({ kind: "applied", landing: landing({ branch: "the-slug", number: 3 }), via: "branch" });
  });

  it("is applied through the PR its run was settled with, when that one is on main", () => {
    const doc = row({
      extra: [
        `anchor: ${CALL}`,
        "settlement: filed",
        "settlementWitness: https://github.com/LachieJames/Slopweaver/pull/7",
      ],
      slug: "witnessed",
    });
    const main = mainWith({ landings: [landing({ branch: "some-other-branch", number: 7 })] });
    expect(steerStateOf({ doc, landings: main, run: NO_RUN })).toEqual({
      kind: "applied",
      landing: landing({ branch: "some-other-branch", number: 7 }),
      via: "witness",
    });
  });

  it("is settled on its PR, not applied, when that PR is not on main or is another repository's", () => {
    const doc = row({
      extra: [`anchor: ${CALL}`, "settlement: filed", "settlementWitness: https://github.com/other/repo/pull/7"],
      slug: "elsewhere-pr",
    });
    const main = mainWith({ landings: [landing({ branch: "b", number: 7 })] });
    expect(steerStateOf({ doc, landings: main, run: NO_RUN })).toEqual({
      kind: "settled",
      settlement: "filed",
      witness: "https://github.com/other/repo/pull/7",
      witnessPr: { number: 7, repo: "other/repo" },
    });
  });

  it("finds its settlement PR on whichever main is that PR's repository, ledger record or none", () => {
    const doc = row({
      extra: [
        `anchor: ${CALL}`,
        "settlement: filed",
        "settlementWitness: https://github.com/acme/acme-admin/pull/16624",
      ],
      slug: "on-the-other-repo",
    });
    const unledgered = landing({ branch: undefined, number: 16624 });
    const other = mainWith({ landings: [unledgered], repo: "acme/acme-admin" });
    expect(
      stateOfRow({ doc, landings: undefined, readMains: [EMPTY_MAIN, other], run: NO_RUN, runUnread: false }),
    ).toEqual({ kind: "applied", landing: unledgered, via: "witness" });
  });

  it("is unknown, never not started, when its journal would not read and nothing joined", () => {
    const doc = row({ extra: [`anchor: ${CALL}`, "settlement: answered"], slug: "journal-gone" });
    expect(steerStateOf({ doc, landings: EMPTY_MAIN, run: NO_RUN, runUnread: true })).toEqual({
      kind: "landing-unknown",
      why: "its run journal would not read, so neither the branch its run recorded nor how far it got is known",
    });
    const landed = mainWith({ landings: [landing({ branch: "journal-gone", number: 4 })] });
    expect(steerStateOf({ doc, landings: landed, run: NO_RUN, runUnread: true })).toEqual({
      kind: "applied",
      landing: landing({ branch: "journal-gone", number: 4 }),
      via: "branch",
    });
  });

  it("is settled with nothing landed when the witness is not a PR", () => {
    const doc = row({
      extra: [`anchor: ${CALL}`, "settlement: answered", "settlementWitness: said so in thread"],
      slug: "answered",
    });
    expect(steerStateOf({ doc, landings: EMPTY_MAIN, run: NO_RUN })).toEqual({
      kind: "settled",
      settlement: "answered",
      witness: "said so in thread",
      witnessPr: undefined,
    });
  });

  it("is unknown when the row names no repository, or its main would not read — never not applied", () => {
    const doc = row({ extra: [`anchor: ${CALL}`], slug: "unknown" });
    expect(steerStateOf({ doc, landings: undefined, run: NO_RUN })).toEqual({
      kind: "landing-unknown",
      why: "the row names no repository, so no main could be read for it",
    });
    const unread: RepoLandings = { kind: "unread", why: "no origin/main" };
    expect(steerStateOf({ doc, landings: unread, run: NO_RUN })).toEqual({
      kind: "landing-unknown",
      why: "no origin/main",
    });
  });

  it("is in flight while its run is open or waiting on the owner, run-closed after, and waiting with no run", () => {
    const doc = row({ extra: [`anchor: ${CALL}`], slug: "moving" });
    expect(steerStateOf({ doc, landings: EMPTY_MAIN, run: runOn({ branch: "b", phase: "open" }) })).toEqual({
      branch: "b",
      kind: "in-flight",
    });
    expect(steerStateOf({ doc, landings: EMPTY_MAIN, run: runOn({ branch: "b", phase: "waiting-on-owner" }) })).toEqual(
      { branch: "b", kind: "in-flight" },
    );
    expect(steerStateOf({ doc, landings: EMPTY_MAIN, run: runOn({ branch: "b", phase: "closed" }) })).toEqual({
      branch: "b",
      kind: "run-closed",
    });
    expect(steerStateOf({ doc, landings: EMPTY_MAIN, run: NO_RUN })).toEqual({ kind: "waiting" });
  });

  it("is ended when the row was closed with nothing landed", () => {
    const doc = parseHandoverDoc({
      path: "/h/ended.md",
      text: `---\nslug: ended\nkind: doc\nstatus: cancelled\nanchor: ${CALL}\n---\n\n# ended\n`,
    });
    expect(steerStateOf({ doc, landings: EMPTY_MAIN, run: NO_RUN })).toEqual({ kind: "ended", status: "cancelled" });
  });
});

describe("steersOf", () => {
  it("draws each steer with the owner's words, how often they gave it, newest first and undated last", () => {
    const later: HisWords = { ...WORDS, atIso: "2026-10-05T11:50:00.000Z", words: "are you still there?" };
    const repeated = row({
      extra: [
        `anchor: ${CALL}`,
        `repo: ${REPO_DIR}`,
        "askedIso: 2026-10-05T11:42:00.000Z",
        "summary: A console page shows each steer",
        ...wordsLines({ words: WORDS }),
        ...hisWordsSteerFields({ index: 1, record: { hisWords: { ...later, anchor: CALL_AGAIN }, kind: "held" } }).map(
          (field) => `${field.key}: ${field.value}`,
        ),
      ],
      slug: "repeated",
    });
    const newer = row({
      extra: [`summary: relay ${TURN}`, `repo: ${REPO_DIR}`, "askedIso: 2026-10-06T09:00:00.000Z"],
      slug: "newer",
    });
    const undated = row({ extra: [`anchor: ${CALL}`], slug: "undated" });
    const notOne = row({ extra: ["summary: not a steer"], slug: "not-one" });
    const steers = steersOf({
      docs: [undated, repeated, notOne, newer],
      landings: new Map([[REPO_DIR, mainWith({ landings: [landing({ branch: "repeated", number: 9 })] })]]),
      noRun: NO_RUN,
      runs: new Map(),
      unreadRuns: new Set(),
    });
    expect(steers.map((steer) => steer.slug)).toEqual(["newer", "repeated", "undated"]);
    const [first, second, third] = steers;
    expect(first!.origin).toEqual({ kind: "named-in-text", turn: TURN });
    expect(first!.words).toBe(undefined);
    expect(first!.state).toEqual({ kind: "waiting" });
    expect(second!.timesGiven).toBe(2);
    expect(second!.title).toBe("A console page shows each steer");
    expect(second!.words).toEqual(WORDS);
    expect(second!.state).toEqual({
      kind: "applied",
      landing: landing({ branch: "repeated", number: 9 }),
      via: "branch",
    });
    expect(second!.againIsos).toEqual(["2026-10-05T11:50:00.000Z"]);
    expect(third!.title).toBe("undated");
    expect(third!.timesGiven).toBe(1);
    expect(third!.againIsos).toEqual([]);
    expect(third!.state.kind).toBe("landing-unknown");
  });

  it("places each further steer on the instant its words carry, in order, one with no readable words on none", () => {
    const fields = ({
      index,
      record,
    }: {
      index: number;
      record: Parameters<typeof hisWordsSteerFields>[0]["record"];
    }): readonly string[] => hisWordsSteerFields({ index, record }).map((field) => `${field.key}: ${field.value}`);
    const again = row({
      extra: [
        `anchor: ${CALL}`,
        "askedIso: 2026-10-01T00:00:00.000Z",
        ...wordsLines({ words: WORDS }),
        ...fields({
          index: 1,
          record: { hisWords: { ...WORDS, anchor: CALL_AGAIN, atIso: "2026-10-03T00:00:00.000Z" }, kind: "held" },
        }),
        ...fields({ index: 2, record: { anchor: CALL_THIRD, kind: "unread", why: "the call file is gone" } }),
        // A group re-quoting the row's own anchor is a defect of the quote, never a doc problem, and carries no instant.
        ...fields({ index: 3, record: { hisWords: { ...WORDS, atIso: "2026-10-04T00:00:00.000Z" }, kind: "held" } }),
        ...fields({
          index: 4,
          record: { hisWords: { ...WORDS, anchor: CALL_FOURTH, atIso: "2026-10-02T00:00:00.000Z" }, kind: "held" },
        }),
      ],
      slug: "again",
    });
    const [steer] = steersOf({
      docs: [again],
      landings: new Map(),
      noRun: NO_RUN,
      runs: new Map(),
      unreadRuns: new Set(),
    });
    expect(steer!.timesGiven).toBe(5);
    expect(steer!.againIsos).toEqual(["2026-10-03T00:00:00.000Z", undefined, undefined, "2026-10-02T00:00:00.000Z"]);
  });

  it("draws nothing from a board with no steer on it", () => {
    const steers = steersOf({
      docs: [row({ extra: ["summary: tidy"], slug: "tidy" })],
      landings: new Map(),
      noRun: NO_RUN,
      runs: new Map(),
      unreadRuns: new Set(),
    });
    expect(steers).toEqual([]);
  });

  it("counts a relay row whose journal would not read, rather than dropping it, and says its landing is unknown", () => {
    const relay = row({ extra: [`anchor: ${RELAY}`, `repo: ${REPO_DIR}`], slug: "relay-journal-gone" });
    const untaken = row({ extra: [`anchor: ${RELAY}`, `repo: ${REPO_DIR}`], slug: "relay-chatter" });
    const steers = steersOf({
      docs: [relay, untaken],
      landings: new Map([[REPO_DIR, EMPTY_MAIN]]),
      noRun: NO_RUN,
      runs: new Map(),
      unreadRuns: new Set(["relay-journal-gone"]),
    });
    expect(steers.map((steer) => steer.slug)).toEqual(["relay-journal-gone"]);
    expect(steers[0]!.origin).toEqual({ anchor: RELAY, kind: "relay-taken-up" });
    expect(steers[0]!.state.kind).toBe("landing-unknown");
  });
});
