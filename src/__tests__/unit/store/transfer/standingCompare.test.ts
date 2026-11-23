/**
 * A standing ask compared by its cards as well as its id: one question per imported ask, never an activation when
 * a live ask under another id shares a card, every live ask it meets in that question, in an order no input moves.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import type { StandingAsk } from "../../../../profile/standingAsks.js";
import { type ImportPlan, planImport, STORE_IMPORT_COMPARISON_VERSION } from "../../../../store/transfer/compare.js";
import { STORE_EXPORT_PARTS, type StoreExportPartKind } from "../../../../store/transfer/parts.js";
import { type RetainedEntry, standingAskEntries } from "../../../../store/transfer/retained.js";
import { standingAskRelations } from "../../../../store/transfer/standingCompare.js";

/** One standing ask under a fixed quote. */
function ask({ id, covers }: { id: string; covers: readonly string[] }): StandingAsk {
  return {
    covers,
    id,
    quote: {
      anchor: "talk:a0000017-0000-4000-8000-000000000019",
      atIso: "2026-10-04T00:55:00.000Z",
      cut: "none",
      where: "console-voice",
      words: "chuck anything worth a look on the board",
    },
    recordedAtIso: "2026-10-05T00:00:00.000Z",
  };
}

/** Every part empty bar the standing asks. */
function withAsks({
  asks,
}: {
  asks: readonly StandingAsk[];
}): ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]> {
  return new Map(
    STORE_EXPORT_PARTS.map((spec) => [spec.kind, spec.kind === "standing-asks" ? standingAskEntries({ asks }) : []]),
  );
}

/** The plan of an export holding these asks against a live store holding those. */
function plan({ imported, live }: { imported: readonly StandingAsk[]; live: readonly StandingAsk[] }): ImportPlan {
  return unwrap(
    planImport({
      contentDigest: "sha256:export",
      imported: withAsks({ asks: imported }),
      live: withAsks({ asks: live }),
    }),
  );
}

/** The content tag a question line carries for one ask. */
function tag({ of }: { of: StandingAsk }): string {
  return standingAskEntries({ asks: [of] })[0]!.fingerprint.slice(7, 19);
}

/** The standing-asks part's counts. */
function counts({ of }: { of: ImportPlan }): readonly number[] {
  const part = of.parts.find((one) => one.kind === "standing-asks")!;
  return part.status === "compared" ? [part.new, part.identical, part.conflicting] : [];
}

describe("planImport over standing asks", () => {
  it("asks one conflict, never an activation, when the imported ask shares a card with a live ask under another id", () => {
    const imported = ask({ covers: ["findings"], id: "a" });
    const live = ask({ covers: ["findings", "bot-replies"], id: "b" });
    const made = plan({ imported: [imported], live: [live] });

    expect(counts({ of: made })).toEqual([0, 0, 1]);
    expect(
      made.questions.map(({ kind, key, imported: line, live: current, actions }) => [
        kind,
        key,
        line,
        current,
        actions,
      ]),
    ).toEqual([
      [
        "conflict",
        "a",
        `standing ask a, covers findings [content ${tag({ of: imported })}]`,
        `standing ask b, covers findings, bot-replies (shares findings) [content ${tag({ of: live })}]`,
        ["keep-current", "take-imported"],
      ],
    ]);
  });

  it("puts every live ask it meets in ONE question, ordered by id, whatever order the live side lists them", () => {
    const imported = ask({ covers: ["findings", "bot-replies"], id: "a" });
    const sameId = ask({ covers: ["act:auto.merge"], id: "a" });
    const onFindings = ask({ covers: ["findings"], id: "b" });
    const onReplies = ask({ covers: ["bot-replies"], id: "c" });
    const forward = plan({ imported: [imported], live: [onReplies, sameId, onFindings] });
    const backward = plan({ imported: [imported], live: [onFindings, sameId, onReplies] });

    expect(forward.questions.map((question) => question.live)).toEqual([
      [
        `standing ask a, covers act:auto.merge (same id) [content ${tag({ of: sameId })}]`,
        `standing ask b, covers findings (shares findings) [content ${tag({ of: onFindings })}]`,
        `standing ask c, covers bot-replies (shares bot-replies) [content ${tag({ of: onReplies })}]`,
      ].join("; "),
    ]);
    expect(backward.questions).toEqual(forward.questions);
    expect(backward.digest).toBe(forward.digest);
  });

  it("holds the same ask under its own id as identical and asks nothing, and asks to activate one meeting none", () => {
    const held = ask({ covers: ["findings"], id: "a" });
    const unmet = ask({ covers: ["bot-replies"], id: "b" });
    const made = plan({ imported: [held, unmet], live: [held] });

    expect(counts({ of: made })).toEqual([1, 1, 0]);
    expect(made.questions.map(({ kind, key, live }) => [kind, key, live])).toEqual([["activation", "b", null]]);
  });

  it("moves the question id with WHICH live ask shares the card, the imported side unchanged", () => {
    const imported = ask({ covers: ["findings"], id: "a" });
    const viaB = plan({ imported: [imported], live: [ask({ covers: ["findings"], id: "b" })] });
    const viaC = plan({ imported: [imported], live: [ask({ covers: ["findings"], id: "c" })] });

    expect(viaB.questions[0]!.key).toBe(viaC.questions[0]!.key);
    expect(viaB.questions[0]!.id).not.toBe(viaC.questions[0]!.id);
  });

  it("names a live ask under the same id with other content as `same id`, with no card shared", () => {
    const imported = ask({ covers: ["findings"], id: "a" });
    const live = ask({ covers: ["bot-replies"], id: "a" });
    const made = plan({ imported: [imported], live: [live] });

    expect(counts({ of: made })).toEqual([0, 0, 1]);
    expect(made.questions.map(({ kind, live: current }) => [kind, current])).toEqual([
      ["conflict", `standing ask a, covers bot-replies (same id) [content ${tag({ of: live })}]`],
    ]);
  });

  it("names both reasons for a live ask under the same id that also shares cards, sorted", () => {
    const imported = ask({ covers: ["findings", "bot-replies"], id: "a" });
    const live = ask({ covers: ["findings", "bot-replies", "act:auto.merge"], id: "a" });

    expect(plan({ imported: [imported], live: [live] }).questions.map((question) => question.live)).toEqual([
      "standing ask a, covers findings, bot-replies, act:auto.merge (same id, shares bot-replies, findings) " +
        `[content ${tag({ of: live })}]`,
    ]);
  });

  it("asks a conflict for the same ask under its own id when another live ask also shares its card", () => {
    const held = ask({ covers: ["findings"], id: "a" });
    const other = ask({ covers: ["findings"], id: "b" });
    const made = plan({ imported: [held], live: [held, other] });
    // The imported and live `a` are the same content, so their short tags would read alike: every tag on the
    // question widens to the whole fingerprint.
    const whole = ({ of }: { of: StandingAsk }): string => standingAskEntries({ asks: [of] })[0]!.fingerprint.slice(7);

    expect(counts({ of: made })).toEqual([0, 0, 1]);
    expect(made.questions.map((question) => question.live)).toEqual([
      [
        `standing ask a, covers findings (same id, shares findings) [content ${whole({ of: held })}]`,
        `standing ask b, covers findings (shares findings) [content ${whole({ of: other })}]`,
      ].join("; "),
    ]);
  });

  it("gives the same questions and digest whichever order BOTH sides list their asks", () => {
    const first = ask({ covers: ["findings"], id: "a" });
    const second = ask({ covers: ["bot-replies"], id: "b" });
    const liveOne = ask({ covers: ["findings"], id: "c" });
    const liveTwo = ask({ covers: ["bot-replies"], id: "d" });
    const forward = plan({ imported: [first, second], live: [liveOne, liveTwo] });
    const backward = plan({ imported: [second, first], live: [liveTwo, liveOne] });

    expect(forward.questions.map((question) => question.key)).toEqual(["a", "b"]);
    expect(backward.questions).toEqual(forward.questions);
    expect(backward.digest).toBe(forward.digest);
  });

  it("moves the question id and the digest with the live ask's content, its id and cards unchanged", () => {
    const imported = ask({ covers: ["findings"], id: "a" });
    const before = ask({ covers: ["findings"], id: "b" });
    const after = { ...before, recordedAtIso: "2026-10-06T00:00:00.000Z" };
    const was = plan({ imported: [imported], live: [before] });
    const now = plan({ imported: [imported], live: [after] });

    expect(tag({ of: before })).not.toBe(tag({ of: after }));
    expect(now.questions[0]!.id).not.toBe(was.questions[0]!.id);
    expect(now.digest).not.toBe(was.digest);
  });

  it("moves the question id with WHICH cards are shared, the same live ask under the same id", () => {
    const imported = ask({ covers: ["findings", "bot-replies"], id: "a" });
    const sharesOne = plan({ imported: [imported], live: [ask({ covers: ["findings"], id: "b" })] });
    const sharesOther = plan({ imported: [imported], live: [ask({ covers: ["bot-replies"], id: "b" })] });

    expect(sharesOne.questions[0]!.id).not.toBe(sharesOther.questions[0]!.id);
  });

  it("plans by comparison version 5, which still compares a standing ask by its cards", () => {
    expect(STORE_IMPORT_COMPARISON_VERSION).toBe(5);
    expect(plan({ imported: [], live: [] }).comparisonVersion).toBe(5);
  });
});

describe("standingAskRelations", () => {
  it("names each live ask it meets with the cards both cover, sorted, and leaves out one sharing none", () => {
    const [row] = standingAskEntries({ asks: [ask({ covers: ["findings", "bot-replies"], id: "a" })] });
    const live = new Map(
      standingAskEntries({
        asks: [ask({ covers: ["bot-replies", "findings"], id: "z" }), ask({ covers: ["act:auto.merge"], id: "y" })],
      }).map((entry) => [entry.key, entry]),
    );

    expect(
      standingAskRelations({ live, row: row! }).map(({ key, overlaps, sameKey }) => [key, overlaps, sameKey]),
    ).toEqual([["z", ["bot-replies", "findings"], false]]);
  });
});

describe("standingAskEntries", () => {
  it("carries every ask's own cards, in its own order, on the entry the comparison reads", () => {
    const entries = standingAskEntries({
      asks: [ask({ covers: ["findings", "bot-replies"], id: "a" }), ask({ covers: ["act:auto.merge"], id: "b" })],
    });

    expect(entries.map(({ key, covers }) => [key, covers])).toEqual([
      ["a", ["findings", "bot-replies"]],
      ["b", ["act:auto.merge"]],
    ]);
  });
});
