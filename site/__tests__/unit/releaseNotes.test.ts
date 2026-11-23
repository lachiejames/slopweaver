/*
 * The release notes: what an update would bring, grouped — the owner's asks, in the app, couldn't tell, behind the scenes —
 * each group two shown and the rest behind its fold, none dropped, none twice; and the one count of how many are in
 * the app.
 */
import { describe, expect, it } from "vitest";

import type { LandedView, LandedWordsView } from "../../components/live/readLanded";
import type { ConsoleCommit } from "../../lib/buildStandingReport";
import {
  inTheApp,
  quotedWords,
  releaseChangeSummary,
  releaseNotes,
  releaseNotesUnchecked,
} from "../../lib/releaseNotes";

/** A full sha out of one hex digit. */
const sha = ({ digit }: { digit: string }): string => digit.repeat(40);

/** A commit, app-changing unless its `[shell, console]` flags say otherwise — a tuple, so an `undefined` stays unread. */
const change = ({
  digit,
  title,
  flags = [true, false],
}: {
  digit: string;
  title: string;
  flags?: readonly [boolean | undefined, boolean | undefined];
}): ConsoleCommit => ({
  changesConsole: flags[1],
  changesShell: flags[0],
  committedIso: "2026-10-08T00:00:00Z",
  pullRequest: undefined,
  sha: sha({ digit }),
  title,
});

/** The owner's words as a landed record carries them. */
const QUOTE = {
  anchor: "talk:x",
  atIso: "2026-10-07T00:00:00Z",
  cut: "none",
  where: "call",
  words: "make the orb rest clear of the bar",
} as const;

/** A landing at a sha, with the words the join found. */
const landing = ({ digit, words }: { digit: string; words: LandedWordsView }): LandedView => ({
  mergedIso: "2026-10-08T00:00:00Z",
  number: 1,
  proof: { kind: "unrecorded", why: "n/a" },
  row: undefined,
  sha: sha({ digit }),
  title: "t",
  under: { kind: "none" },
  url: undefined,
  words,
});

const ASKED: LandedWordsView = { ...QUOTE, kind: "asked" };
const RULING: LandedWordsView = { ...QUOTE, decidedIso: undefined, kind: "ruling", recorded: "r" };
const UNASKED: LandedWordsView = { kind: "unasked", why: "no words" };

/** Newest first: a, b, c, d, e. */
const CHANGES = ["a", "b", "c", "d", "e"].map((digit) => change({ digit, title: `change ${digit}` }));

/** Each section as its group, the titles it shows, the titles in its fold, and the fold's label. */
const layout = ({ sections }: { sections: ReturnType<typeof releaseNotes> }) =>
  sections.map((section) => ({
    group: section.group,
    heading: section.heading,
    hidden: section.notes.hidden.map((note) => note.commit.title),
    more: section.notes.more,
    shown: section.notes.shown.map((note) => note.commit.title),
  }));

/** One of each place a change can sit, newest first: two app, one console-only, three unread shapes, two behind. */
const MIXED = [
  change({ digit: "1", title: "shell" }),
  change({ digit: "2", flags: [false, true], title: "console" }),
  change({ digit: "3", flags: [true, undefined], title: "shell, console unread" }),
  change({ digit: "4", flags: [undefined, undefined], title: "both unread" }),
  change({ digit: "5", flags: [false, undefined], title: "console unread" }),
  change({ digit: "6", flags: [undefined, false], title: "shell unread" }),
  change({ digit: "7", flags: [false, false], title: "cli" }),
  change({ digit: "8", flags: [false, false], title: "deps" }),
];

describe("releaseNotes", () => {
  it("groups the changes in the app, then the ones it could not place, then the ones behind the scenes", () => {
    expect(layout({ sections: releaseNotes({ changing: MIXED, landings: [] }) })).toEqual([
      {
        group: "app",
        heading: "In the app",
        hidden: ["shell, console unread"],
        more: "1 more change",
        shown: ["shell", "console"],
      },
      {
        group: "unknown",
        heading: "Couldn’t tell where",
        hidden: ["shell unread"],
        more: "1 more change",
        shown: ["both unread", "console unread"],
      },
      { group: "behind", heading: "Behind the scenes", hidden: [], more: undefined, shown: ["cli", "deps"] },
    ]);
  });

  it("puts what the owner asked for first whatever it touched, and never again in its own group", () => {
    const landings = [landing({ digit: "7", words: ASKED }), landing({ digit: "2", words: RULING })];
    const sections = releaseNotes({ changing: MIXED, landings });
    expect(layout({ sections }).map((section) => [section.group, [...section.shown, ...section.hidden]])).toEqual([
      ["asked", ["console", "cli"]],
      ["app", ["shell", "shell, console unread"]],
      ["unknown", ["both unread", "console unread", "shell unread"]],
      ["behind", ["deps"]],
    ]);
    expect(sections[0].heading).toBe("You asked for these");
    expect(sections[0].notes.shown.map((note) => note.quote)).toEqual([QUOTE, QUOTE]);
  });

  it("folds the owner's asks after two, newest first, like every other group", () => {
    const landings = ["b", "c", "e"].map((digit) => landing({ digit, words: ASKED }));
    const asked = releaseNotes({ changing: CHANGES, landings })[0];
    expect(asked.notes.shown.map((note) => note.commit.title)).toEqual(["change b", "change c"]);
    expect(asked.notes.hidden.map((note) => note.commit.title)).toEqual(["change e"]);
  });

  it("never ranks words that are not the owner's, nor a landing outside the missing set", () => {
    const landings = [landing({ digit: "a", words: UNASKED }), landing({ digit: "f", words: ASKED })];
    const sections = releaseNotes({ changing: CHANGES, landings });
    expect(sections.map((section) => section.group)).toEqual(["app"]);
    expect(sections[0].notes.shown.map((note) => note.quote)).toEqual([undefined, undefined]);
  });

  it("holds every change exactly once across its groups", () => {
    const landings = [landing({ digit: "4", words: ASKED })];
    const all = releaseNotes({ changing: MIXED, landings }).flatMap((section) => [
      ...section.notes.shown,
      ...section.notes.hidden,
    ]);
    expect(all.map((note) => note.commit.sha).toSorted()).toEqual(MIXED.map((commit) => commit.sha).toSorted());
  });

  it("draws no group for no changes", () => {
    expect(releaseNotes({ changing: [], landings: [] })).toEqual([]);
  });
});

describe("releaseChangeSummary", () => {
  it("says how many, and how many of those are in the app", () => {
    expect(releaseChangeSummary({ changing: MIXED })).toBe("8 changes, 3 in the app");
  });

  it("counts a change both flags call in the app once", () => {
    const both = change({ digit: "9", flags: [true, true], title: "both" });
    expect(releaseChangeSummary({ changing: [both] })).toBe("1 change, 1 in the app");
  });

  it("names no in-app count when none is, and never counts an unread one", () => {
    expect(releaseChangeSummary({ changing: MIXED.slice(3) })).toBe("5 changes");
  });

  it("is empty for no changes", () => {
    expect(releaseChangeSummary({ changing: [] })).toBe("");
  });
});

describe("inTheApp", () => {
  it("is yes on either flag, no only when both say no, and unknown otherwise", () => {
    expect(MIXED.map((commit) => inTheApp({ commit }))).toEqual([
      true,
      true,
      true,
      undefined,
      undefined,
      undefined,
      false,
      false,
    ]);
  });
});

describe("releaseNotesUnchecked", () => {
  const LEDGER_DOWN: LandedWordsView = { kind: "not-joined", why: "the PR ledger would not list: EACCES" };

  it("names every change whose words could not be reached, never silently ranking without them", () => {
    const landings = [
      landing({ digit: "a", words: LEDGER_DOWN }),
      landing({ digit: "b", words: { kind: "unread", why: "record b would not read" } }),
      landing({ digit: "c", words: ASKED }),
    ];
    expect(releaseNotesUnchecked({ changing: CHANGES, landings })).toBe(
      "2 changes could not be checked against your asks: the PR ledger would not list: EACCES",
    );
  });

  it("is silent when every change was checked, and counts only the changes the app is missing", () => {
    expect(releaseNotesUnchecked({ changing: CHANGES, landings: [landing({ digit: "a", words: UNASKED })] })).toBe(
      undefined,
    );
    const outside = [landing({ digit: "f", words: LEDGER_DOWN }), landing({ digit: "a", words: LEDGER_DOWN })];
    expect(releaseNotesUnchecked({ changing: CHANGES, landings: outside })).toBe(
      "1 change could not be checked against your asks: the PR ledger would not list: EACCES",
    );
  });
});

describe("quotedWords", () => {
  it("is the owner's words whole when the record holds all of them", () => {
    expect(quotedWords({ quote: QUOTE })).toBe("make the orb rest clear of the bar");
  });

  it("marks with an ellipsis where the record is short of them", () => {
    expect(quotedWords({ quote: { ...QUOTE, cut: "end" } })).toBe("make the orb rest clear of the bar…");
    expect(quotedWords({ quote: { ...QUOTE, cut: "start" } })).toBe("…make the orb rest clear of the bar");
  });
});
