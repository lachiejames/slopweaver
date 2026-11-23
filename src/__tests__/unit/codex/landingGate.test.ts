import { describe, expect, it } from "vitest";

import {
  associateCodexLoop,
  CODEX_LOOP_SUBJECT,
  type CodexLoopInspection,
  codexLoopFinding,
  codexLoopFindingLines,
  codexLoopSummary,
  codexLoopWaiver,
} from "../../../codex/landingGate.js";
import type { LocalCodexLoopRead } from "../../../codex/landingGateTypes.js";
import type { ReviewLeftover } from "../../../codex/reviewLeftovers.js";

const HEAD = { baseSha: "ba5e0000", branch: "feature", headSha: "cafe1234", repository: "acme/widget" } as const;

/** A reading that answers for {@link HEAD}; a case overrides one field to make it answer for something else. */
function reading({
  repository = "acme/widget",
  branch = "feature",
  headSha = "cafe1234",
  baseSha = "ba5e0000",
  failures = [],
  leftovers = [],
  roots = ["/w/repo"],
}: {
  repository?: string;
  branch?: string;
  headSha?: string;
  baseSha?: string;
  failures?: readonly string[];
  leftovers?: readonly ReviewLeftover[];
  roots?: readonly string[];
} = {}): LocalCodexLoopRead {
  return { evidence: { baseSha, branch, failures, headSha, leftovers, repository, roots }, kind: "read" };
}

/** A finding standing after the second and last review pass. */
const LEFTOVER: ReviewLeftover = {
  artifactId: "art-7",
  pass: "r2",
  propertyId: "r2-08",
  summary: "the retry\n  loses a write",
};

describe("associateCodexLoop", () => {
  it("passes the recorded failures through when the reading answers for this pull request", () => {
    const local = reading({ failures: ["no review pass has run on this branch"] });

    expect(associateCodexLoop({ head: HEAD, local })).toEqual({
      failures: ["no review pass has run on this branch"],
      kind: "examined",
      leftovers: [],
    });
  });

  it("reports a clean loop as examined with nothing standing", () => {
    expect(associateCodexLoop({ head: HEAD, local: reading() })).toEqual({
      failures: [],
      kind: "examined",
      leftovers: [],
    });
  });

  it("carries the reading's leftovers forward for the landing verb to check against the body", () => {
    expect(associateCodexLoop({ head: HEAD, local: reading({ leftovers: [LEFTOVER] }) })).toEqual({
      failures: [],
      kind: "examined",
      leftovers: [LEFTOVER],
    });
  });

  /**
   * The finding this whole change exists for: the presser stands somewhere else entirely, and that is no
   * longer a refusal. The reading names the checkouts that answered, none of which need be the verb's own.
   */
  it("examines a pull request whose evidence lives in checkouts the presser is not standing in", () => {
    const local = reading({ roots: ["/w/authoring-worktree", "/w/another"] });

    expect(associateCodexLoop({ head: HEAD, local })).toEqual({ failures: [], kind: "examined", leftovers: [] });
  });

  it("carries an unreadable machine's own reason forward rather than inventing one", () => {
    const local: LocalCodexLoopRead = { kind: "unreadable", reason: "no checkout holds the head commit" };

    expect(associateCodexLoop({ head: HEAD, local })).toEqual({
      kind: "not-examined",
      reason: "no checkout holds the head commit",
    });
  });

  /** Both landing verbs read the floor twice; a second reading about another pull request is not this one's. */
  it("refuses a reading that answers for a different repository", () => {
    const local = reading({ repository: "acme/other" });

    expect(associateCodexLoop({ head: HEAD, local })).toEqual({
      kind: "not-examined",
      reason: "the reading answers for acme/other, but the pull request is in acme/widget",
    });
  });

  it("refuses a reading that answers for a different branch", () => {
    const local = reading({ branch: "some-other-work" });

    expect(associateCodexLoop({ head: HEAD, local })).toEqual({
      kind: "not-examined",
      reason: "the reading answers for branch some-other-work, but the pull request's head branch is feature",
    });
  });

  it("refuses a reading that answers for a different commit", () => {
    const local = reading({ headSha: "beef5678" });

    expect(associateCodexLoop({ head: HEAD, local })).toEqual({
      kind: "not-examined",
      reason: "the reading answers for beef5678, but the pull request's head is cafe1234",
    });
  });

  /** The base commit is what the ratchet-bump witness lists manifests against, so it is associated the same way. */
  it("refuses a reading that answers for a different base commit", () => {
    const local = reading({ baseSha: "0dd0base" });

    expect(associateCodexLoop({ head: HEAD, local })).toEqual({
      kind: "not-examined",
      reason: "the reading answers for base 0dd0base, but the pull request's base is ba5e0000",
    });
  });
});

describe("codexLoopFinding", () => {
  it("raises nothing only when the loop was examined and cleared the floor", () => {
    expect(codexLoopFinding({ inspection: { failures: [], kind: "examined", leftovers: [] } })).toBeUndefined();
  });

  it("carries every obligation as its own detail line", () => {
    const inspection: CodexLoopInspection = {
      failures: ["no plan ran", "no review ran"],
      kind: "examined",
      leftovers: [],
    };

    expect(codexLoopFinding({ inspection })).toEqual({
      details: ["no plan ran", "no review ran"],
      subject: CODEX_LOOP_SUBJECT,
    });
  });

  /** No description names a leftover, so it stays the finding until an acknowledgement with a reason lands it. */
  it("raises a leftover as codex-loop-incomplete, naming the acknowledgement that lands it", () => {
    const inspection: CodexLoopInspection = { failures: [], kind: "examined", leftovers: [LEFTOVER] };

    expect(codexLoopFinding({ inspection })).toEqual({
      details: [
        "r2/r2-08 (art-7): the retry loses a write is CURRENT and BROKEN after the second and last review pass — " +
          'land it with --acknowledge codex-loop-incomplete --reason "<why it lands with this standing>"',
      ],
      subject: CODEX_LOOP_SUBJECT,
    });
  });

  it("says a leftover recorded no summary rather than printing an empty one", () => {
    const inspection: CodexLoopInspection = {
      failures: [],
      kind: "examined",
      leftovers: [{ ...LEFTOVER, summary: undefined }],
    };

    expect(codexLoopFinding({ inspection })!.details[0]).toContain(
      "r2/r2-08 (art-7): the review recorded no summary is CURRENT and BROKEN",
    );
    expect(codexLoopFinding({ inspection })!.details).toEqual([
      "r2/r2-08 (art-7): the review recorded no summary is CURRENT and BROKEN after the second and last review " +
        'pass — land it with --acknowledge codex-loop-incomplete --reason "<why it lands with this standing>"',
    ]);
  });

  it("lists the floor's failures first, then one line per leftover", () => {
    const inspection: CodexLoopInspection = { failures: ["no plan ran"], kind: "examined", leftovers: [LEFTOVER] };

    expect(codexLoopFinding({ inspection })).toEqual({
      details: [
        "no plan ran",
        "r2/r2-08 (art-7): the retry loses a write is CURRENT and BROKEN after the second and last review pass — " +
          'land it with --acknowledge codex-loop-incomplete --reason "<why it lands with this standing>"',
      ],
      subject: CODEX_LOOP_SUBJECT,
    });
  });

  it("names every leftover on its own line, in the order the reading carried them", () => {
    const second: ReviewLeftover = { artifactId: "art-9", pass: "r3", propertyId: "r3-02", summary: "a stale read" };
    const inspection: CodexLoopInspection = { failures: [], kind: "examined", leftovers: [LEFTOVER, second] };

    expect(codexLoopFinding({ inspection })!.details.map((line) => line.split(" is CURRENT")[0])).toEqual([
      "r2/r2-08 (art-7): the retry loses a write",
      "r3/r3-02 (art-9): a stale read",
    ]);
  });

  /**
   * The asymmetry the whole module exists for: "we could not tell" must cost exactly what "we looked and it
   * was incomplete" costs, or every future gap in association becomes a silent pass.
   */
  it("raises the finding for a reading that could not be examined at all", () => {
    const inspection: CodexLoopInspection = { kind: "not-examined", reason: "HEAD is detached" };

    expect(codexLoopFinding({ inspection })).toEqual({
      details: ["the Codex loop could not be examined: HEAD is detached"],
      subject: CODEX_LOOP_SUBJECT,
    });
  });
});

describe("codexLoopFindingLines", () => {
  const finding = {
    details: ["no planning pass has run on this branch", "r2 (switch-integrity) is STALE"],
    subject: CODEX_LOOP_SUBJECT,
  } as const;

  it("names every waived obligation, in order, when the finding is acknowledged", () => {
    expect(codexLoopFindingLines({ finding, state: "ACKNOWLEDGED" })).toEqual([
      "ACKNOWLEDGED: codex-loop-incomplete: no planning pass has run on this branch",
      "ACKNOWLEDGED: codex-loop-incomplete: r2 (switch-integrity) is STALE",
    ]);
  });

  it("names every standing obligation, in order, when the finding is refused", () => {
    expect(codexLoopFindingLines({ finding, state: "refused" })).toEqual([
      "refused: codex-loop-incomplete: no planning pass has run on this branch",
      "refused: codex-loop-incomplete: r2 (switch-integrity) is STALE",
    ]);
  });
});

describe("codexLoopWaiver", () => {
  it("waives nothing when the subject was never named", () => {
    expect(codexLoopWaiver({ acknowledge: ["ci-not-green"], acknowledgeAll: false, reason: "why" })).toBeUndefined();
  });

  it("waives nothing when the subject is named without a reason", () => {
    expect(
      codexLoopWaiver({ acknowledge: [CODEX_LOOP_SUBJECT], acknowledgeAll: false, reason: undefined }),
    ).toBeUndefined();
  });

  /** A blank reason writes a ledger entry that records nothing, which is worse than refusing. */
  it("waives nothing on a whitespace-only reason", () => {
    expect(
      codexLoopWaiver({ acknowledge: [CODEX_LOOP_SUBJECT], acknowledgeAll: false, reason: "   " }),
    ).toBeUndefined();
  });

  /**
   * `String.trim()` leaves every Unicode FORMAT character, so `"\u200b".trim().length` is 1 and an invisible
   * reason passed as non-blank. Found by a Codex review of this diff, which forged exactly this string.
   */
  /**
   * The second invisible codepoint two reviews in a row: U+034F COMBINING GRAPHEME JOINER is a MARK, not a
   * format character, so a denylist of `\p{Cf}`/`\p{Cc}` missed it. That repeat is why the predicate asks what
   * a reason must CONTAIN instead of listing what to strip.
   */
  /**
   * The fourth blank-rendering string in four rounds, and the one that settled the shape: U+2800 BRAILLE
   * PATTERN BLANK is a Symbol and is NOT default-ignorable, so no exclusion list caught it. The predicate now
   * states what a reason must contain — a letter or a digit — which no arrangement of invisibles produces.
   */
  it("waives nothing on a reason made only of blank braille", () => {
    expect(
      codexLoopWaiver({ acknowledge: [CODEX_LOOP_SUBJECT], acknowledgeAll: false, reason: "\u2800\u2800" }),
    ).toBeUndefined();
  });

  it("waives nothing on a reason made only of punctuation, which carries no statement either", () => {
    expect(
      codexLoopWaiver({ acknowledge: [CODEX_LOOP_SUBJECT], acknowledgeAll: false, reason: "..." }),
    ).toBeUndefined();
  });

  it("waives on a right-to-left reason, which the criterion must never reject", () => {
    expect(codexLoopWaiver({ acknowledge: [CODEX_LOOP_SUBJECT], acknowledgeAll: false, reason: "خطأ مطبعي" })).toEqual({
      reason: "خطأ مطبعي",
      subject: CODEX_LOOP_SUBJECT,
    });
  });

  it("waives nothing on a reason made only of combining marks", () => {
    expect(
      codexLoopWaiver({ acknowledge: [CODEX_LOOP_SUBJECT], acknowledgeAll: false, reason: "\u034f\u034f" }),
    ).toBeUndefined();
  });

  /**
   * The third invisible codepoint in three rounds, and the one that settled the shape: U+115F HANGUL CHOSEONG
   * FILLER is a LETTER, so no class of Other/Separator/Mark could exclude it. The predicate now defers to
   * Unicode's own `Default_Ignorable_Code_Point` rather than enumerating invisibles here.
   */
  it("waives nothing on a reason made only of default-ignorable letters", () => {
    expect(
      codexLoopWaiver({ acknowledge: [CODEX_LOOP_SUBJECT], acknowledgeAll: false, reason: "\u115f\u3164" }),
    ).toBeUndefined();
  });

  it("waives on a reason in a non-Latin script, which the criterion must never reject", () => {
    expect(codexLoopWaiver({ acknowledge: [CODEX_LOOP_SUBJECT], acknowledgeAll: false, reason: "誤字の修正" })).toEqual(
      {
        reason: "誤字の修正",
        subject: CODEX_LOOP_SUBJECT,
      },
    );
  });

  it("still waives an accented reason, whose marks ride a real character", () => {
    expect(codexLoopWaiver({ acknowledge: [CODEX_LOOP_SUBJECT], acknowledgeAll: false, reason: "café" })).toEqual({
      reason: "café",
      subject: CODEX_LOOP_SUBJECT,
    });
  });

  it("waives nothing on a reason made only of zero-width characters", () => {
    expect(
      codexLoopWaiver({ acknowledge: [CODEX_LOOP_SUBJECT], acknowledgeAll: false, reason: "\u200b\u200b" }),
    ).toBeUndefined();
  });

  it("still waives when a real reason merely contains one", () => {
    expect(
      codexLoopWaiver({ acknowledge: [CODEX_LOOP_SUBJECT], acknowledgeAll: false, reason: "a\u200b typo fix" }),
    ).toEqual({ reason: "a\u200b typo fix", subject: CODEX_LOOP_SUBJECT });
  });

  it("records the subject and the reason when both are given", () => {
    expect(codexLoopWaiver({ acknowledge: [CODEX_LOOP_SUBJECT], acknowledgeAll: false, reason: "a typo fix" })).toEqual(
      {
        reason: "a typo fix",
        subject: CODEX_LOOP_SUBJECT,
      },
    );
  });

  it("records it under --acknowledge-all too, which carries its own reason obligation", () => {
    expect(codexLoopWaiver({ acknowledge: [], acknowledgeAll: true, reason: "migrating an in-flight branch" })).toEqual(
      {
        reason: "migrating an in-flight branch",
        subject: CODEX_LOOP_SUBJECT,
      },
    );
  });
});

describe("codexLoopSummary", () => {
  it("names the single obligation when there is one", () => {
    const finding = { details: ["no plan ran"], subject: CODEX_LOOP_SUBJECT } as const;

    expect(codexLoopSummary({ finding })).toBe("the Codex pairing floor is unmet: no plan ran");
  });

  it("counts the rest rather than pasting them into one line", () => {
    const finding = { details: ["no plan ran", "no review ran", "r1 is BROKEN"], subject: CODEX_LOOP_SUBJECT } as const;

    expect(codexLoopSummary({ finding })).toBe("the Codex pairing floor is unmet: no plan ran (+2 more)");
  });
});
