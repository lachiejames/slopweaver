/** An Alignment act card's related guidance: what settles its act exactly, what mentions its kind, and what was not read. */
import { describe, expect, it } from "vitest";

import type { GuidanceEntryView, GuidanceView } from "../../lib/alignmentGuidance";
import { kindWords, relatedGuidance } from "../../lib/relatedGuidance";

/** An entry that settles no kind. */
function plain({ text, citation, body }: { text: string; citation: string; body?: string }): GuidanceEntryView {
  const entry: GuidanceEntryView = { body: text, citation, kinds: [], subjectPrefix: null, text };
  if (body === undefined) {
    return entry;
  }
  return { ...entry, body };
}

/** A synthetic organisation's guidance. */
const VIEW: GuidanceView = {
  readAtIso: "2026-11-13T00:00:00.000Z",
  sources: [
    {
      id: "doctrine",
      label: "Doctrine (AGENTS.md)",
      level: "doctrine",
      state: {
        entries: [
          plain({
            body: "**1 · Land your own work.** Enqueue it once green; a bump presses merge when ready.",
            citation: "AGENTS.md rule 1",
            text: "Land your own work",
          }),
          plain({
            body: "**3 · One door.** Every Slack read goes through a verb.",
            citation: "AGENTS.md rule 3",
            text: "One door",
          }),
          plain({ body: "**9 · Pair.** Codex reviews the merge.", citation: "AGENTS.md rule 9", text: "Pair" }),
        ],
        gaps: [],
        kind: "read",
      },
    },
    {
      id: "class-steers",
      label: "Standing rules (class steers)",
      level: "standing-rules",
      state: {
        entries: [
          {
            body: "presses: press them all",
            citation: "talk:presses",
            kinds: ["press-merge-when-ready"],
            subjectPrefix: null,
            text: "presses: press them all",
          },
          {
            body: "acme-only: only on acme",
            citation: "talk:scoped",
            kinds: ["press-merge-when-ready"],
            subjectPrefix: "https://github.com/acme/",
            text: "acme-only: only on acme",
          },
        ],
        gaps: [],
        kind: "read",
      },
    },
    {
      id: "memories",
      label: "Feedback memories",
      level: "rulings",
      state: { entries: [], gaps: ["acme-other: EACCES"], kind: "read" },
    },
    {
      id: "owner-profile",
      label: "Owner profile",
      level: "rulings",
      state: { kind: "unreadable", why: "timed out" },
    },
  ],
};

describe("kindWords", () => {
  it("keeps the words of four letters or more, glue words out", () => {
    expect(kindWords({ kind: "press-merge-when-ready" })).toEqual(["press", "merge", "ready"]);
  });

  it("drops a short word, so a kind of only short words matches on nothing", () => {
    expect(kindWords({ kind: "close-superseded-pr" })).toEqual(["close", "superseded"]);
    expect(kindWords({ kind: "pr" })).toEqual([]);
  });
});

describe("relatedGuidance", () => {
  it("names the standing rules that settle the act, a scoped one only on a subject it admits", () => {
    const outside = relatedGuidance({
      kind: "press-merge-when-ready",
      subject: "https://github.com/other/x/pull/1",
      view: VIEW,
    });
    const inside = relatedGuidance({
      kind: "press-merge-when-ready",
      subject: "https://github.com/acme/x/pull/1",
      view: VIEW,
    });

    expect(outside.settles.map((entry) => entry.citation)).toEqual(["talk:presses"]);
    expect(inside.settles.map((entry) => entry.citation)).toEqual(["talk:presses", "talk:scoped"]);
  });

  it("mentions an entry naming two of the kind's words, most named first, and says which words", () => {
    const related = relatedGuidance({ kind: "press-merge-when-ready", subject: "s", view: VIEW });

    // Rule 1 names all three (`presses` begins with `press`); rule 9 names only `merge`, one short of two.
    expect(related.mentions.map((entry) => [entry.citation, entry.named])).toEqual([
      ["AGENTS.md rule 1", ["press", "merge", "ready"]],
    ]);
  });

  it("says only the words an entry names, never every word of the kind", () => {
    const view: GuidanceView = {
      readAtIso: "2026-11-13T00:00:00.000Z",
      sources: [
        {
          id: "memories",
          label: "Feedback memories",
          level: "rulings",
          state: {
            entries: [plain({ citation: "memory:acme/press.md", text: "press merge" })],
            gaps: [],
            kind: "read",
          },
        },
      ],
    };

    expect(relatedGuidance({ kind: "press-merge-ready", subject: "s", view }).mentions[0].named).toEqual([
      "press",
      "merge",
    ]);
  });

  it("needs only the one word when the kind has one", () => {
    const related = relatedGuidance({ kind: "enqueue", subject: "s", view: VIEW });

    expect(related.mentions.map((entry) => entry.citation)).toEqual(["AGENTS.md rule 1"]);
  });

  it("mentions nothing for a kind with no word long enough to match", () => {
    const related = relatedGuidance({ kind: "pr", subject: "s", view: VIEW });

    expect(related.settles).toEqual([]);
    expect(related.mentions).toEqual([]);
  });

  it("names every source that was not wholly read, so nothing related is never read as no guidance", () => {
    expect(relatedGuidance({ kind: "enqueue", subject: "s", view: VIEW }).unread).toEqual([
      "Feedback memories (in part)",
      "Owner profile",
    ]);
  });
});
