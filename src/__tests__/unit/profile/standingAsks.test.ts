/**
 * The standing-ask register's pure fold: what stands, what a withdrawal takes back, and every line that breaks it.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { StandingAskErrors } from "../../../profile/standingAskErrors.js";
import {
  admitStandingAsk,
  foldStandingAsks,
  isStandingAskInstant,
  isStandingCoverage,
  type StandingAsk,
  type StandingAskEvent,
  standingAskLine,
} from "../../../profile/standingAsks.js";

const QUOTE = {
  anchor: "talk:a0000062-0000-4000-8000-000000000068",
  atIso: "2026-10-04T00:55:00.000Z",
  cut: "none",
  where: "console-voice",
  words: "if you ever find something that's worth a look, chuck it on the board",
} as const;

/** One recorded ask. */
function ask({ id, covers }: { id: string; covers: readonly string[] }): StandingAsk {
  return { covers, id, quote: QUOTE, recordedAtIso: "2026-10-09T12:00:00.000Z" };
}

/** The journal line one event is written as. */
function line({ event }: { event: StandingAskEvent }): string {
  return standingAskLine({ event });
}

const RECORDED = line({ event: { kind: "recorded", ...ask({ covers: ["findings"], id: "org-intel" }) } });

describe("foldStandingAsks", () => {
  it("folds one recorded line into one active ask, the owner's words unchanged", () => {
    const active = unwrap(foldStandingAsks({ lines: [RECORDED] }));
    expect(active).toEqual([ask({ covers: ["findings"], id: "org-intel" })]);
  });

  it("reads an empty journal as no asks, and skips a blank line", () => {
    expect(unwrap(foldStandingAsks({ lines: [] }))).toEqual([]);
    expect(unwrap(foldStandingAsks({ lines: ["", RECORDED, " "] })).map((one) => one.id)).toEqual(["org-intel"]);
  });

  it("takes a withdrawn ask off, and lets its id and coverage be recorded again after", () => {
    const withdrawn = line({
      event: { id: "org-intel", kind: "withdrawn", reason: "superseded", withdrawnAtIso: "2026-10-09T13:00:00.000Z" },
    });
    expect(unwrap(foldStandingAsks({ lines: [RECORDED, withdrawn] }))).toEqual([]);
    expect(unwrap(foldStandingAsks({ lines: [RECORDED, withdrawn, RECORDED] })).map((one) => one.id)).toEqual([
      "org-intel",
    ]);
  });

  it("refuses the whole fold on a line that is not JSON, naming the line", () => {
    const folded = foldStandingAsks({ lines: [RECORDED, "{not json"] });
    expect(unwrapErr(folded).message).toBe("standing-ask journal line 2 does not read: not JSON");
  });

  it("refuses a recorded line carrying a field of its own, or a coverage outside the grammar", () => {
    const extra = JSON.stringify({ ...JSON.parse(RECORDED), words: "typed by a session" });
    expect(unwrapErr(foldStandingAsks({ lines: [extra] })).code).toBe("LINE_UNREADABLE");
    const bad = line({ event: { kind: "recorded", ...ask({ covers: ["everything"], id: "wide" }) } });
    expect(unwrapErr(foldStandingAsks({ lines: [bad] })).code).toBe("LINE_UNREADABLE");
  });

  it("refuses a second active ask under one id, and a withdrawal naming none", () => {
    expect(unwrapErr(foldStandingAsks({ lines: [RECORDED, RECORDED] })).message).toBe(
      "standing ask org-intel is already recorded and not withdrawn",
    );
    const stray = line({
      event: { id: "nobody", kind: "withdrawn", reason: "x", withdrawnAtIso: "2026-10-09T13:00:00.000Z" },
    });
    expect(unwrapErr(foldStandingAsks({ lines: [stray] }))).toEqual(
      StandingAskErrors.unknownWithdrawal({ id: "nobody" }),
    );
  });

  it("refuses two active asks covering one kind of card", () => {
    const second = line({ event: { kind: "recorded", ...ask({ covers: ["bot-replies", "findings"], id: "other" }) } });
    expect(unwrapErr(foldStandingAsks({ lines: [RECORDED, second] })).message).toBe(
      "standing ask org-intel already covers findings; one card quotes one standing ask, so withdraw it first",
    );
  });
});

describe("admitStandingAsk", () => {
  it("admits disjoint coverage beside an active ask", () => {
    const admitted = admitStandingAsk({
      active: [ask({ covers: ["findings"], id: "org-intel" })],
      ask: ask({ covers: ["act:github.merge"], id: "auto-merge" }),
    });
    expect(unwrap(admitted)).toBe(true);
  });

  it("refuses a coverage repeated inside one ask", () => {
    const admitted = admitStandingAsk({ active: [], ask: ask({ covers: ["findings", "findings"], id: "twice" }) });
    expect(unwrapErr(admitted)).toEqual(StandingAskErrors.coverageOverlap({ coverage: "findings", held: "twice" }));
  });
});

describe("isStandingCoverage", () => {
  it("knows the four named coverages and one exact act kind", () => {
    const known = ["findings", "registered-rows", "bot-replies", "unlinked-cards", "act:slack.post.as-me"];
    expect(known.map((coverage) => isStandingCoverage({ coverage }))).toEqual([true, true, true, true, true]);
  });

  it("refuses a bare act:, a pattern, and an unknown word", () => {
    const unknown = ["act:", "act:github.*", "Findings", "everything"];
    expect(unknown.map((coverage) => isStandingCoverage({ coverage }))).toEqual([false, false, false, false]);
  });
});

describe("isStandingAskInstant", () => {
  it("admits a UTC instant and one with an offset", () => {
    const instants = ["2026-11-02T00:00:00.000Z", "2026-11-02T11:00:00+11:00"];
    expect(instants.map((value) => isStandingAskInstant({ value }))).toEqual([true, true]);
  });

  it("refuses a word, a bare date, an instant with no offset, and the empty string", () => {
    const refused = ["not-an-instant", "2026-11-02", "2026-11-02T00:00:00", ""];
    expect(refused.map((value) => isStandingAskInstant({ value }))).toEqual([false, false, false, false]);
  });

  it("agrees with the fold on a withdrawal written at that instant", () => {
    const folds = ({ withdrawnAtIso }: { withdrawnAtIso: string }): boolean =>
      foldStandingAsks({
        lines: [RECORDED, line({ event: { id: "org-intel", kind: "withdrawn", reason: "replaced", withdrawnAtIso } })],
      }).isOk();
    const candidates = ["2026-11-02T00:00:00.000Z", "not-an-instant", "2026-11-02T00:00:00"];
    expect(candidates.map((value) => [folds({ withdrawnAtIso: value }), isStandingAskInstant({ value })])).toEqual([
      [true, true],
      [false, false],
      [false, false],
    ]);
  });
});
