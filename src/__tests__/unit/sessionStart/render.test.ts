import { describe, expect, it } from "vitest";
import type { Item } from "../../../sessionStart/item.js";
import type { RankedItem, Ranking } from "../../../sessionStart/rank.js";
import {
  CLOSE_MARKER,
  DEFAULT_TOP,
  HEADLINE_CHARS,
  headline,
  listLines,
  pausedLines,
  rowLines,
} from "../../../sessionStart/render.js";
import type { TraceVerdict } from "../../../silver/traceBeforeRanking.js";

const item = ({ nativeId }: { nativeId: string }): Item => ({
  background: "what this thing is, for a reader holding no context",
  doneWhen: "pick reading A or reading B for the PR count",
  nativeId,
  source: "handover",
  whenIso: "2026-08-29T00:00:00.000Z",
  where: `slopweaver handover resume ${nativeId}`,
  who: `the ${nativeId} session`,
});

const row = ({
  nativeId,
  unverified = false,
  verdict = "rank",
}: {
  nativeId: string;
  unverified?: boolean;
  verdict?: TraceVerdict;
}): RankedItem => ({
  contributions: { age: 1, directness: 3, distanceToDone: 3, drift: 0, explicitPriority: 0, stoppedOnOwner: 5 },
  finishesInFlight: true,
  item: item({ nativeId }),
  score: 12,
  trace: {
    carried: [],
    reason:
      verdict === "propose-close"
        ? "the work this asks for was already done somewhere else — close it, do not do it"
        : "traced, and still open where it came from",
    verdict,
  },
  unverified,
  why: "somebody is stopped waiting on you",
});

describe("rowLines", () => {
  it("puts the owner's code-owner slice directly under the ask, before the background", () => {
    const sliced = row({ nativeId: "a-run" });
    const lines = rowLines({
      index: 1,
      row: {
        ...sliced,
        item: {
          ...sliced.item,
          codeOwnerSlice: {
            additions: 1,
            deletions: 1,
            omittedPaths: 0,
            ownedFiles: 1,
            shownPaths: ["apps/ops/datadog/notificationChannels.ts"],
            totalFiles: 30,
          },
        },
      },
    });
    expect(lines.slice(0, 3)).toStrictEqual([
      "1. pick reading A or reading B for the PR count",
      "   Yours as code owner, by login: 1 of 30 files, +1 -1 lines, in apps/ops/datadog/notificationChannels.ts",
      "   what this thing is, for a reader holding no context",
    ]);
  });

  it("leads with what would count as done", () => {
    expect(rowLines({ index: 1, row: row({ nativeId: "a-run" }) })[0]).toBe(
      "1. pick reading A or reading B for the PR count",
    );
  });

  it("puts the background above the identity line, so the row says what it is first", () => {
    expect(rowLines({ index: 1, row: row({ nativeId: "a-run" }) })[1]).toBe(
      "   what this thing is, for a reader holding no context",
    );
  });

  it("puts who, where and when on one line", () => {
    expect(rowLines({ index: 1, row: row({ nativeId: "a-run" }) })[2]).toBe(
      "   the a-run session · slopweaver handover resume a-run · last moved 2026-08-29T00:00:00.000Z",
    );
  });

  it("shows the clause and the score", () => {
    expect(rowLines({ index: 2, row: row({ nativeId: "a-run" }) })[3]).toBe(
      "   somebody is stopped waiting on you (score 12)",
    );
  });

  it("marks a row whose freshness could not be established", () => {
    expect(rowLines({ index: 1, row: row({ nativeId: "a-run", unverified: true }) })[3]).toBe(
      "   somebody is stopped waiting on you (score 12) · freshness unverified",
    );
  });

  it("marks a close proposal before its headline, so the row reads as a different kind of row", () => {
    expect(rowLines({ index: 1, row: row({ nativeId: "a-run", verdict: "propose-close" }) })[0]).toBe(
      "1. CLOSE — pick reading A or reading B for the PR count",
    );
  });

  it("explains a close proposal with what the trace decided, not with the signal that scored it", () => {
    expect(rowLines({ index: 1, row: row({ nativeId: "a-run", verdict: "propose-close" }) })[3]).toBe(
      "   the work this asks for was already done somewhere else — close it, do not do it (score 12)",
    );
  });

  it("leaves an ordinary row unmarked", () => {
    expect(rowLines({ index: 1, row: row({ nativeId: "a-run" }) })[0]).not.toContain(CLOSE_MARKER);
  });
});

describe("headline", () => {
  it("leaves a short single-sentence question exactly as it is", () => {
    expect(headline({ doneWhen: "pick reading A or reading B" })).toBe("pick reading A or reading B");
  });

  it("keeps only the first sentence of a paragraph, with no ellipsis marking the cut", () => {
    expect(headline({ doneWhen: "Rotate the password now. Then post in the channel. Then ticket it." })).toBe(
      "Rotate the password now.",
    );
  });

  it("cuts an over-long first sentence at a word boundary, with no truncation mark", () => {
    const long = `${"word ".repeat(60)}end.`;
    const cut = headline({ doneWhen: long });
    expect(cut.endsWith("…")).toBe(false);
    expect(cut.length).toBeLessThanOrEqual(HEADLINE_CHARS);
    expect(cut.includes("wor ")).toBe(false);
  });

  it("collapses the newlines a recorded question carries", () => {
    expect(headline({ doneWhen: "one line\n\nand   another" })).toBe("one line and another");
  });

  it("leaves a single unbroken token whole rather than slicing it", () => {
    const token = "a".repeat(HEADLINE_CHARS + 20);
    expect(headline({ doneWhen: token })).toBe(token.slice(0, HEADLINE_CHARS));
  });

  it("reads a question that is only whitespace as an empty headline", () => {
    expect(headline({ doneWhen: " \n\t " })).toBe("");
  });
});

describe("rowLines — never truncates", () => {
  it("prints the whole question on its own line whenever the headline shortened it", () => {
    const whole = "Rotate the password now. Then post in the channel. Then ticket it.";
    const lines = rowLines({
      index: 1,
      row: { ...row({ nativeId: "a-run" }), item: { ...item({ nativeId: "a-run" }), doneWhen: whole } },
    });

    expect(lines[0]).toBe("1. Rotate the password now.");
    expect(lines).toContain(`   (full) ${whole}`);
  });

  it("prints no folded line when the headline never cut anything", () => {
    const lines = rowLines({ index: 1, row: row({ nativeId: "a-run" }) });

    expect(lines.some((line) => line.startsWith("   (full)"))).toBe(false);
  });

  it("prints the item's title beside its headline when the source names one", () => {
    const withTitle = {
      ...row({ nativeId: "a-run" }),
      item: { ...item({ nativeId: "a-run" }), title: "Fix the flaky upload test" },
    };

    expect(rowLines({ index: 1, row: withTitle })[1]).toBe("   Fix the flaky upload test");
    expect(rowLines({ index: 1, row: withTitle })[2]).toBe("   what this thing is, for a reader holding no context");
  });
});

describe("listLines", () => {
  it("says plainly when nothing is waiting, and how many were read", () => {
    const ranking: Ranking = { dropped: [{ item: item({ nativeId: "a-run" }), reason: "read it live" }], ranked: [] };
    expect(listLines({ ranking, top: DEFAULT_TOP })).toStrictEqual([
      "Nothing is waiting on you.",
      "1 candidate(s) were read and none survived — run with --json to see why each dropped.",
    ]);
  });

  it("counts the ranked rows in its heading", () => {
    const ranking: Ranking = { dropped: [], ranked: [row({ nativeId: "a-run" })] };
    expect(listLines({ ranking, top: DEFAULT_TOP })[0]).toBe("1 thing(s) waiting on you:");
  });

  it("stops at top and says how many more there are", () => {
    const ranking: Ranking = {
      dropped: [],
      ranked: [row({ nativeId: "a" }), row({ nativeId: "b" }), row({ nativeId: "c" })],
    };
    expect(listLines({ ranking, top: 1 })).toContain("2 more — pass --top to see them.");
  });

  it("prints the drop count even when it is zero", () => {
    const ranking: Ranking = { dropped: [], ranked: [row({ nativeId: "a-run" })] };
    expect(listLines({ ranking, top: DEFAULT_TOP })).toContain("0 candidate(s) did not make the list.");
  });

  it("never announces more rows when every row is shown", () => {
    const ranking: Ranking = { dropped: [], ranked: [row({ nativeId: "a-run" })] };
    expect(listLines({ ranking, top: DEFAULT_TOP }).some((line) => line.includes("more — pass --top"))).toBe(false);
  });
});

describe("rowLines and a standing", () => {
  it("says on the row that the owner already answered it, with the ruling's date", () => {
    const lines = rowLines({
      index: 7,
      row: {
        ...row({ nativeId: "a-run" }),
        standing: { atIso: "2026-09-02T12:10:00.000Z", kind: "ruled", outcome: "approved-as-proposed" },
      },
    });
    expect(lines[4]).toBe("   you already answered this: ruled 2026-09-02 (approved-as-proposed)");
  });

  it("adds no line for an untouched row", () => {
    const lines = rowLines({ index: 1, row: { ...row({ nativeId: "a-run" }), standing: { kind: "untouched" } } });
    expect(lines.some((line) => line.includes("already answered"))).toBe(false);
  });
});

describe("pausedLines", () => {
  /** The rule, rendered: the briefing SAYS a workstream is parked on someone, and says nothing else. */
  it("prints one line per parked row, under a heading that rules out a deadline", () => {
    const lines = pausedLines({
      paused: [
        { reason: "paused on a reviewer, since 2026-09-04T02:00:00.000Z — no deadline, never overdue", slug: "a-post" },
      ],
    });

    expect(lines).toEqual([
      "",
      "PAUSED — 1 workstream(s) waiting on someone. Not your move, not forgotten, never overdue:",
      "  a-post — paused on a reviewer, since 2026-09-04T02:00:00.000Z — no deadline, never overdue",
    ]);
  });

  /** Unnumbered on purpose: a row waiting on somebody else is not a position the owner is being asked to work. */
  it("never numbers a row the way the ranked list does", () => {
    const lines = pausedLines({ paused: [{ reason: "paused on a reviewer", slug: "a-post" }] });

    expect(lines.some((line) => /^\s*\d+\./.test(line))).toBe(false);
  });

  it("prints nothing at all when nothing is paused", () => {
    expect(pausedLines({ paused: [] })).toEqual([]);
  });
});
