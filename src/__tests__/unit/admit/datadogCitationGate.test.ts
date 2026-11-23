/**
 * The gate that refuses an answer whose Datadog citations open on something other than their claim's evidence.
 *
 * The citation sets below are synthetic fixtures in the shape a reviewed answer carries under
 * `$SLOPWEAVER_HOME/live/slack/reviews/<thread>/`: a first draft, and a reviewed answer whose claims review has
 * already corrected. The headline case is the last one in this file — the reviewed answer still trips the
 * gate, which is what makes "review classifies claims and never citations" a property this test holds down
 * rather than a story.
 */
import { describe, expect, it } from "vitest";

import {
  DATADOG_CITATION_OVERRIDE,
  datadogCitationFindings,
  datadogCitationGate,
} from "../../../admit/datadogCitationGate.js";
import { admitDoor } from "../../../admit/door.js";
import type { DoorRequest } from "../../../admit/types.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";

/** A traces citation frozen with the APM params, which the console clamps to 15 minutes. */
const LEGACY_TRACE_FREEZE_FIXTURE =
  "https://ap1.datadoghq.com/apm/traces?query=service%3Aacme-fixture-api%20env%3Aproduction%20%40http.status_code%3A503" +
  "&start=1700000000000&end=1700003600000&paused=true";

/** A logs citation, correctly frozen. */
const LOGS_FROZEN =
  "https://ap1.datadoghq.com/logs?query=env%3A%28prod%20OR%20production%29%20service%3Aacme-fixture-api" +
  "%20%40err.code%3AFIXTURE_SHED&from_ts=1700000000000&to_ts=1700003600000&live=false";

/** An unscoped database metric citation — the blended line a figure gets read off. No `exp_scope`. */
const UNSCOPED_METRIC_FIXTURE =
  "https://ap1.datadoghq.com/metric/explorer?exp_metric=gcp.cloudsql.database.cpu.utilization" +
  "&exp_agg=avg&start=1700000000000&end=1700003600000&paused=true";

/** The same citation scoped to the one database the claim is about. */
const SCOPED_METRIC_FIXTURE =
  "https://ap1.datadoghq.com/metric/explorer?exp_metric=gcp.cloudsql.database.cpu.utilization" +
  "&exp_agg=avg&exp_scope=database_id%3Aacme-fixture%3Aacme-fixture-postgres" +
  "&start=1700000000000&end=1700003600000&paused=true";

/** A source permalink cited alongside them — a non-Datadog link the gate must never judge. */
const GITHUB_CITATION =
  "https://github.com/acme/acme-admin/blob/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678/services/api/src/server/start.ts#L44-L50";

function citation({ label, url }: { label: string; url: string }): AnswerFormAnswer["citations"][number] {
  return { id: `c${label.replace(/\D/gu, "")}`, label, url };
}

function answer({ urls }: { urls: readonly string[] }): AnswerFormAnswer {
  return {
    body: [],
    citations: urls.map((url, index) => citation({ label: `[${String(index + 1)}]`, url })),
    documents: [],
    grounding: {
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: ["i did not walk one FixtureCheckout trace end to end"] },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "conversation",
      provenance: {
        model: "the dispatched worker in workspace:166 (Claude Code, in-turn)",
        skillsLoaded: [],
        verbsLoaded: ["datadog logs", "datadog metrics"],
      },
      reason: "read the live spans and metrics",
    },
    images: [],
    index: [],
    kind: "answer",
    lead: "the fixture service sheds under load, not on slow requests",
    measurements: [],
  };
}

const REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "slack", verb: "post" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
};

describe("datadogCitationFindings", () => {
  it("finds nothing on an answer whose citations are all correctly frozen and scoped", () => {
    const findings = datadogCitationFindings({
      answer: answer({ urls: [LOGS_FROZEN, SCOPED_METRIC_FIXTURE, GITHUB_CITATION] }),
    });
    expect(findings).toEqual([]);
  });

  it("reports one finding per CITATION, not per violation, and names the label a reader has to fix", () => {
    const findings = datadogCitationFindings({ answer: answer({ urls: [LOGS_FROZEN, UNSCOPED_METRIC_FIXTURE] }) });
    expect(findings.length).toBe(1);
    expect(findings[0]!.code).toBe("ANSWER_CITATION_DOES_NOT_OPEN_ON_ITS_EVIDENCE");
    expect(findings[0]!.summary).toContain("citation [2]");
    expect(findings[0]!.summary).toContain("renders the metric blended across every reporting instance in the org");
    expect(findings[0]!.correction).toContain("exp_scope");
  });

  it("is a warn carrying the override token, so the refusal is always self-correctable at the door", () => {
    // Asserted as a whole object rather than field by field: `DoorFinding` is a union where `override`
    // exists only on the `warn` arm, so reading it through a narrowing branch would be a conditional in an
    // assertion. The literal is the exact contract and it fails if any part of it moves.
    expect(datadogCitationFindings({ answer: answer({ urls: [UNSCOPED_METRIC_FIXTURE] }) })).toEqual([
      {
        code: "ANSWER_CITATION_DOES_NOT_OPEN_ON_ITS_EVIDENCE",
        correction:
          "rebuild [1] over the window and scope the claim was actually computed over, then re-run" +
          " `turn review` — build a logs, traces or rum link with `ddConsoleLink` rather than pasting one out" +
          " of the console, and give a metric explorer link the `exp_scope` you measured or the `exp_group` you" +
          " read it by",
        override: DATADOG_CITATION_OVERRIDE,
        severity: "warn",
        summary:
          "citation [1] shows a reader something other than the claim's evidence: a metric explorer link with" +
          " neither exp_scope nor exp_group renders the metric blended across every reporting instance in the" +
          " org, so a claim about one" +
          " named system rests on a number that system never produced",
      },
    ]);
  });

  it("joins one citation's several violations into its single summary", () => {
    const findings = datadogCitationFindings({ answer: answer({ urls: [LEGACY_TRACE_FREEZE_FIXTURE] }) });
    expect(findings.length).toBe(1);
    expect(findings[0]!.summary).toContain("freezes with from_ts and to_ts");
    expect(findings[0]!.summary).toContain("pinned by live=false");
  });

  it("finds nothing on an answer that cites nothing at all", () => {
    expect(datadogCitationFindings({ answer: answer({ urls: [] }) })).toEqual([]);
  });
});

describe("datadogCitationGate at the door", () => {
  it("warns, and names the override that waives it", () => {
    const decision = admitDoor({
      env: {},
      gates: [datadogCitationGate({ answer: answer({ urls: [UNSCOPED_METRIC_FIXTURE] }) })],
      request: REQUEST,
    });
    expect(decision.status).toBe("warn");
    expect(decision.findings.length).toBe(1);
  });

  it("passes the answer whose every citation opens on its own evidence", () => {
    const decision = admitDoor({
      env: {},
      gates: [datadogCitationGate({ answer: answer({ urls: [LOGS_FROZEN, SCOPED_METRIC_FIXTURE] }) })],
      request: REQUEST,
    });
    expect(decision.status).toBe("pass");
  });
});

describe("the whole point: an answer whose claims review corrected still trips this gate", () => {
  /**
   * A reviewed answer the door would admit. Its metric citation is scoped; its traces citation is not, because
   * catching that one means clicking it and a reviewer re-derives every number through the API instead.
   */
  const REVIEWED_FIXTURE = answer({
    urls: [LEGACY_TRACE_FREEZE_FIXTURE, GITHUB_CITATION, LOGS_FROZEN, SCOPED_METRIC_FIXTURE],
  });

  it("reports the traces citation and nothing else, so claim review left one citation defect standing", () => {
    const findings = datadogCitationFindings({ answer: REVIEWED_FIXTURE });
    expect(findings.length).toBe(1);
    expect(findings[0]!.summary).toContain("citation [1]");
  });

  it("reports no metric finding on it, which the identical-but-unscoped link proves is a real discharge", () => {
    const summaries = datadogCitationFindings({ answer: REVIEWED_FIXTURE }).map((finding) => finding.summary);
    expect(summaries.filter((summary) => summary.includes("exp_scope"))).toEqual([]);
    expect(
      datadogCitationFindings({ answer: answer({ urls: [UNSCOPED_METRIC_FIXTURE] }) })
        .map((finding) => finding.summary)
        .filter((summary) => summary.includes("exp_scope")).length,
    ).toBe(1);
  });
});
