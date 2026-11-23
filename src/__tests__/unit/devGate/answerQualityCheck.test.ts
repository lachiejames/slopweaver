/**
 * The gate's `answer-quality` check — the two lanes, the composed verdict, and the redaction seam that
 * keeps a golden's own words out of anything this check prints.
 *
 * The redaction tests assert BOTH halves on purpose. A `not.toContain` over a summary proves nothing unless
 * the input genuinely carried the thing called absent, so each one first asserts the marker IS in the raw
 * selftest stream — which reddens if the case this test builds ever stops carrying it.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unwrap } from "#lib/result.js";
import {
  answerQualityResult,
  answerQualityVerdict,
  FIXTURE_CASES_LABEL,
  type LaneReport,
  laneClause,
  PRIVATE_CASES_LABEL,
  redactOutcomes,
} from "../../../devGate/answerQualityCheck.js";
import { answerQualityCheckResult } from "../../../devGate/devGate.js";
import { loadAnswerQualityCases } from "../../../eval/answerQuality/caseSchema.js";
import { runSelftest } from "../../../eval/answerQuality/selftest.js";

/** A string no golden, rubric or property name in this repository contains — the leak witness. */
const MARKER = "ZQMARKERTEXT";

/**
 * A case file whose CASE ID, expectation labels and invented-certainty phrase all carry {@link MARKER}, so
 * every degradation property's own name embeds it and so does the id a summary would name the case by.
 *
 * @param claimAnchor what the claim requires — the golden's own words for a sound rubric, something it never
 *   says for a rubric that fails its own golden
 */
function markerCaseFile({ claimAnchor }: { claimAnchor: string }): string {
  return JSON.stringify({
    cases: [
      {
        attributions: [
          {
            id: "a1",
            label: `${MARKER} attributed to the runbook`,
            requires: [["notion"]],
            source: "notion",
          },
        ],
        caveats: [{ id: "c1", label: `${MARKER} not confirmed`, requires: [["cannot be confirmed"]] }],
        claims: [{ id: "cl1", label: `${MARKER} rollout state`, requires: [[claimAnchor]] }],
        goldenText:
          "The rollout is paused.\nWhether the migration caused it cannot be confirmed from the logs.\nThe runbook in notion says to wait for the queue to drain.",
        id: `case-${MARKER}-01`,
        inventedCertainty: [`${MARKER} is definitely the cause`],
      },
    ],
    schemaVersion: 1,
  });
}

/** Every string a lane report can put in front of a reader, joined so one assertion covers the lot. */
function everythingRendered({ reports }: { reports: readonly LaneReport[] }): string {
  return [...reports.map((report) => laneClause({ report })), answerQualityVerdict({ reports }).summary].join("\n");
}

const homes: string[] = [];

/**
 * A temp state home holding nothing, or holding `privateCases` at the declared eval path, registered
 * for teardown so nothing survives the file.
 */
function home({ privateCases }: { privateCases?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "aq-gate-"));
  homes.push(dir);
  if (privateCases !== undefined) {
    mkdirSync(join(dir, "eval"), { recursive: true });
    writeFileSync(join(dir, "eval", "answer-quality-cases.json"), privateCases, "utf8");
  }
  return dir;
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("redactOutcomes", () => {
  it("keeps the property KIND and drops every field the golden's own words reach", () => {
    const cases = unwrap(loadAnswerQualityCases({ label: "marker", raw: markerCaseFile({ claimAnchor: "paused" }) }));
    const raw = runSelftest({ cases });

    // The falsifiable half: the raw stream really does carry the marker, in the per-outcome DETAIL and in
    // the case ID — the two fields the redaction has to remove. Either one going missing reddens this.
    expect(raw.filter((outcome) => outcome.detail.includes(MARKER)).length).toBe(3);
    expect(raw.filter((outcome) => outcome.caseId.includes(MARKER)).length).toBe(7);
    // `property` is a third field the marker used to reach, and `selftest.ts` now builds it out of a closed
    // kind and a synthetic expectation id. Asserting the absence HERE is what makes that structural rather
    // than incidental, so a variant label creeping back into the name reddens this line.
    expect(raw.filter((outcome) => outcome.property.includes(MARKER)).length).toBe(0);

    const redacted = redactOutcomes({ cases, outcomes: raw });
    expect(JSON.stringify(redacted).includes(MARKER)).toBe(false);
    expect(redacted.filter((outcome) => outcome.propertyKind === "degrades-down").length).toBe(3);
  });

  it("leaves a property carrying no variant label unchanged", () => {
    const cases = unwrap(loadAnswerQualityCases({ label: "marker", raw: markerCaseFile({ claimAnchor: "paused" }) }));
    const redacted = redactOutcomes({ cases, outcomes: runSelftest({ cases }) });
    expect(redacted[0]).toEqual({ caseOrdinal: 1, propertyKind: "verbatim-golden-scores-top", state: "pass" });
  });

  it("carries a skip through as a skip, so an unexercised case never reads as a passing one", () => {
    const cases = unwrap(loadAnswerQualityCases({ label: "marker", raw: markerCaseFile({ claimAnchor: "paused" }) }));
    const redacted = redactOutcomes({ cases, outcomes: runSelftest({ cases }) });
    expect(redacted.filter((outcome) => outcome.state === "skip").map((outcome) => outcome.propertyKind)).toEqual([
      "paraphrase-is-measurably-a-paraphrase",
      "paraphrase-scores-top",
    ]);
  });
});

describe("laneClause", () => {
  it("says a lane that did not run did not run, rather than omitting it", () => {
    const report: LaneReport = {
      caseCount: 0,
      label: PRIVATE_CASES_LABEL,
      lane: "private",
      note: `no cases file at ${PRIVATE_CASES_LABEL}`,
      outcomes: [],
      state: "absent",
    };
    expect(laneClause({ report })).toBe(
      "private lane NOT RUN — no cases file at $SLOPWEAVER_HOME/eval/answer-quality-cases.json",
    );
  });

  it("names the case and the property kind of every failure", () => {
    const report: LaneReport = {
      caseCount: 1,
      label: FIXTURE_CASES_LABEL,
      lane: "fixture",
      note: "",
      outcomes: [
        { caseOrdinal: 1, propertyKind: "verbatim-golden-scores-top", state: "fail" },
        { caseOrdinal: 1, propertyKind: "anchors-are-droppable", state: "pass" },
      ],
      state: "ran",
    };
    expect(laneClause({ report })).toBe(
      "fixture 1 case(s), 2 properties, 1 FAILED: case #1 verbatim-golden-scores-top",
    );
  });
});

describe("answerQualityVerdict", () => {
  const ranClean: LaneReport = {
    caseCount: 1,
    label: FIXTURE_CASES_LABEL,
    lane: "fixture",
    note: "",
    outcomes: [{ caseOrdinal: 1, propertyKind: "verbatim-golden-scores-top", state: "pass" }],
    state: "ran",
  };
  const absentPrivate: LaneReport = {
    caseCount: 0,
    label: PRIVATE_CASES_LABEL,
    lane: "private",
    note: `no cases file at ${PRIVATE_CASES_LABEL}`,
    outcomes: [],
    state: "absent",
  };

  it("passes an absent private lane and still names it in the summary", () => {
    const verdict = answerQualityVerdict({ reports: [ranClean, absentPrivate] });
    expect(verdict.ok).toBe(true);
    expect(verdict.summary).toBe(
      "fixture 1 case(s), 1 property, all held; private lane NOT RUN — no cases file at $SLOPWEAVER_HOME/eval/answer-quality-cases.json",
    );
  });

  it("fails on a failed property and points at the verb that prints why", () => {
    const failing: LaneReport = {
      ...ranClean,
      outcomes: [{ caseOrdinal: 1, propertyKind: "degrades-down", state: "fail" }],
    };
    const verdict = answerQualityVerdict({ reports: [failing, absentPrivate] });
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain("1 FAILED: case #1 degrades-down");
    expect(verdict.summary).toContain("slopweaver dev answer-quality");
  });

  it("fails an unreadable lane — a file that is there and will not parse is a defect, not an absence", () => {
    const unreadable: LaneReport = {
      caseCount: 0,
      label: PRIVATE_CASES_LABEL,
      lane: "private",
      note: `2 load error(s) in ${PRIVATE_CASES_LABEL}`,
      outcomes: [],
      state: "unreadable",
    };
    const verdict = answerQualityVerdict({ reports: [ranClean, unreadable] });
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain("private lane NOT RUN — 2 load error(s)");
  });
});

describe("answerQualityResult over a real state home", () => {
  it("holds every ordering property of the SHIPPED fixture, and says the private lane did not run", () => {
    const result = answerQualityResult({ home: home() });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe(
      "fixture 2 case(s), 13 properties, all held; private lane NOT RUN — no cases file at $SLOPWEAVER_HOME/eval/answer-quality-cases.json",
    );
  });

  it("runs the private lane when the machine holds one, and says how many cases it read", () => {
    const result = answerQualityResult({ home: home({ privateCases: markerCaseFile({ claimAnchor: "paused" }) }) });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe(
      "fixture 2 case(s), 13 properties, all held; private 1 case(s), 7 properties, all held",
    );
  });

  it("fails on a private rubric that no longer fits its own golden, naming no word of that golden", () => {
    const raw = markerCaseFile({ claimAnchor: "the golden never says this" });
    const result = answerQualityResult({ home: home({ privateCases: raw }) });

    // The falsifiable half: the file under test really does carry the marker.
    expect(raw.includes(MARKER)).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("private 1 case(s), 7 properties, 1 FAILED: case #1 verbatim-golden-scores-top");
    expect(result.summary.includes(MARKER)).toBe(false);
  });

  it("fails rather than passes when the cases file is THERE and cannot be read", () => {
    const dir = home();
    // A directory where the file should be: present to `stat`, EISDIR to a read. The r1 review pass found
    // that every read error used to fold into absence, so this machine-holds-it case passed silently.
    mkdirSync(join(dir, "eval", "answer-quality-cases.json"), { recursive: true });
    const result = answerQualityResult({ home: dir });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain(
      "private lane NOT RUN — $SLOPWEAVER_HOME/eval/answer-quality-cases.json could not be read (EISDIR)",
    );
  });

  it("reports an unparseable private file as a load-error COUNT, never as its messages", () => {
    const result = answerQualityResult({ home: home({ privateCases: `{"schemaVersion":1,"cases":[]}` }) });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain(
      "private lane NOT RUN — 1 load error(s) in $SLOPWEAVER_HOME/eval/answer-quality-cases.json",
    );
  });
});

describe("answerQualityCheckResult", () => {
  it("is the gate check named answer-quality", () => {
    const result = answerQualityCheckResult({ home: home() });
    expect(result.name).toBe("answer-quality");
    expect(result.ok).toBe(true);
  });
});

describe("everything this check can print", () => {
  it("carries no string out of the cases file — not a label, not a phrase, not the case id", () => {
    const raw = markerCaseFile({ claimAnchor: "never said" });
    const cases = unwrap(loadAnswerQualityCases({ label: "marker", raw }));
    const reports: readonly LaneReport[] = [
      {
        caseCount: cases.length,
        label: PRIVATE_CASES_LABEL,
        lane: "private",
        note: "",
        outcomes: redactOutcomes({ cases, outcomes: runSelftest({ cases }) }),
        state: "ran",
      },
    ];

    // The falsifiable half: the file under test carries the marker in its id and in its rubric.
    expect(cases[0]!.id.includes(MARKER)).toBe(true);
    expect(raw.includes(MARKER)).toBe(true);

    expect(everythingRendered({ reports }).includes(MARKER)).toBe(false);
    expect(everythingRendered({ reports })).toContain("case #1 verbatim-golden-scores-top");
  });
});
