import { describe, expect, it } from "vitest";

import type { DetailBlock, InlineRun } from "../../../../outbound/artifact/types.js";
import {
  GRAPH_FINDING_MIN_IMAGES,
  graphFindingAssessment,
  graphFindingRefusal,
  isDatadogGraphUrl,
} from "../../../../outbound/assistant/graphFindings.js";
import type { FigureMeasurement } from "../../../../outbound/assistant/measuredFigures.js";

/** The three leads of a regression-hunt reply, each a link the answer offered. */
const LEAD_1 =
  "https://ap1.datadoghq.com/logs?query=env%3Aproduction%20status%3Aerror&from_ts=1789740000000&to_ts=1790431200000&live=false&viz=timeseries";
const LEAD_2 =
  "https://ap1.datadoghq.com/logs?query=env%3Aproduction%20source%3Agcp.cloud_run_revision&agg_q=status&live=false";
const LEAD_3 = "https://ap1.datadoghq.com/apm/traces?query=env%3Aproduction%20service%3Atome-api%20status%3Aerror";

const MEASURED: readonly FigureMeasurement[] = [
  { figures: ["123"], repro: "slopweaver datadog logs count", takenAtIso: "2026-09-26T14:30:00.000Z" },
];

function link({ url }: { url: string }): InlineRun {
  return { label: "[1]", type: "link", url };
}

/** The reply's shape: one bullet per lead, a sentence and its graph link. */
const HUNT_BODY: readonly DetailBlock[] = [
  {
    items: [
      [{ text: "nz booking: cal api key fetch denied, 1 to 123 errors ", type: "text" }, link({ url: LEAD_1 })],
      [{ text: "cloud run stderr now lands as error ", type: "text" }, link({ url: LEAD_2 })],
      [{ text: "tome-api gcs 404s up ", type: "text" }, link({ url: LEAD_3 })],
    ],
    type: "bullets",
  },
];

describe("isDatadogGraphUrl", () => {
  it.each([
    LEAD_1,
    LEAD_3,
    "https://app.datadoghq.com/metric/explorer?exp_metric=x",
    "https://app.datadoghq.eu/dashboard/abc-123/service-health",
    "https://us5.datadoghq.com/notebook/42",
    "https://app.ddog-gov.com/monitors/600102",
    "https://ap1.datadoghq.com/monitors/600102/edit",
    "https://ap1.datadoghq.com/apm/services/tome-api",
    "https://ap1.datadoghq.com/apm/services/tome-api/operations/http.request?env=production",
    "https://ap1.datadoghq.com/monitors/600102/history",
    "https://ap1.datadoghq.com/rum?query=%40type%3Aview&start=1790400000000&end=1790486400000&paused=true",
    "https://ap1.datadoghq.com/logs/",
    "http://ap1.datadoghq.com/logs",
    "HTTPS://ap1.datadoghq.com/logs?query=env%3Aproduction",
    "https://ap1.datadoghq.com/%6cogs?query=env%3Aproduction&from_ts=1&to_ts=2&live=false",
    "https://ap1.datadoghq.com/monitors/%38%38%39",
    "https://ap1.datadoghq.com/apm/services/team%2Fcheckout?env=production&start=1790467200000&end=1790553600000",
  ])("accepts the graph view %s", (url) => {
    expect(isDatadogGraphUrl({ url })).toBe(true);
  });

  it.each([
    "https://docs.datadoghq.com/logs",
    "https://api.ap1.datadoghq.com/logs",
    "https://app.ap1.datadoghq.com/logs",
    "https://ap1.datadoghq.com.evil.example/logs",
    "not a url",
    "https://ap1.datadoghq.com/logs%E0%A4%A",
    "https://ap1.datadoghq.com/logs/pipelines",
    "https://ap1.datadoghq.com/dashboard/lists",
    "https://ap1.datadoghq.com/dashboard/lists/preset/1",
    "https://ap1.datadoghq.com/monitors/manage",
    "https://ap1.datadoghq.com/organization-settings/users",
    "https://ap1.datadoghq.com/billing/usage",
    "https://github.com/acme/widget/pull/1",
  ])("refuses %s, which is not a console graph view", (url) => {
    expect(isDatadogGraphUrl({ url })).toBe(false);
  });
});

describe("graphFindingAssessment — a regression-hunt reply", () => {
  const base = { form: { body: HUNT_BODY }, measurements: MEASURED };

  it("owes three screenshots when the reply attached none", () => {
    expect(graphFindingAssessment({ ...base, images: [] })).toEqual({
      distinctImageCount: 0,
      graphUrls: [LEAD_1, LEAD_2, LEAD_3],
      kind: "missing-images",
    });
  });

  it.each([[["a.png"]], [["a.png", "b.png"]]])("still owes them with %j", (images) => {
    expect(graphFindingAssessment({ ...base, images }).kind).toBe("missing-images");
  });

  it("is clear with three distinct screenshots", () => {
    expect(graphFindingAssessment({ ...base, images: ["a.png", "b.png", "c.png"] })).toEqual({
      distinctImageCount: GRAPH_FINDING_MIN_IMAGES,
      graphUrls: [LEAD_1, LEAD_2, LEAD_3],
      kind: "clear",
    });
  });

  it("counts one screenshot listed three times as one", () => {
    expect(graphFindingAssessment({ ...base, images: ["a.png", "a.png", "a.png"] })).toEqual({
      distinctImageCount: 1,
      graphUrls: [LEAD_1, LEAD_2, LEAD_3],
      kind: "missing-images",
    });
  });

  it("is not a graph finding when the answer declares no measurement", () => {
    expect(graphFindingAssessment({ ...base, images: [], measurements: [] })).toEqual({ kind: "not-graph-finding" });
  });

  it("is not a graph finding when no link is a Datadog graph view", () => {
    const body: readonly DetailBlock[] = [
      {
        runs: [{ text: "123 open ", type: "text" }, link({ url: "https://github.com/acme/w/pull/1" })],
        type: "paragraph",
      },
    ];
    expect(graphFindingAssessment({ ...base, form: { body }, images: [] })).toEqual({ kind: "not-graph-finding" });
  });
});

describe("graphFindingAssessment — where a graph link can sit", () => {
  const none = { images: [], measurements: MEASURED };

  it("reads a citation's url", () => {
    const citations = [{ id: "1", label: "[1]", url: LEAD_1 }];
    expect(graphFindingAssessment({ ...none, form: { citations } })).toEqual({
      distinctImageCount: 0,
      graphUrls: [LEAD_1],
      kind: "missing-images",
    });
  });

  it("reads the answering permalink, which renders as the card's primary link", () => {
    const form = { answering: { permalink: LEAD_1, quote: "the graph" } };
    expect(graphFindingAssessment({ ...none, form })).toEqual({
      distinctImageCount: 0,
      graphUrls: [LEAD_1],
      kind: "missing-images",
    });
  });

  it("reads an index line's link", () => {
    expect(graphFindingAssessment({ ...none, form: { index: [[link({ url: LEAD_2 })]] } })).toEqual({
      distinctImageCount: 0,
      graphUrls: [LEAD_2],
      kind: "missing-images",
    });
  });

  it("reads a table cell's link, and names a url linked twice once", () => {
    const body: readonly DetailBlock[] = [
      { columns: ["a", "b"], rows: [[[link({ url: LEAD_3 })], [link({ url: LEAD_3 })]]], type: "table" },
    ];
    expect(graphFindingAssessment({ ...none, form: { body } })).toEqual({
      distinctImageCount: 0,
      graphUrls: [LEAD_3],
      kind: "missing-images",
    });
  });

  it("reads the grounding evidence trail, a field no earlier walk named", () => {
    const form = { grounding: { evidence: { read: [{ label: "Datadog logs graph", url: LEAD_1 }] } } };
    expect(graphFindingAssessment({ ...none, form })).toEqual({
      distinctImageCount: 0,
      graphUrls: [LEAD_1],
      kind: "missing-images",
    });
  });

  it("reads a URL in prose and drops the full stop that ends its sentence", () => {
    const form = { body: [{ runs: [{ text: `see ${LEAD_3}.`, type: "text" }], type: "paragraph" }] };
    expect(graphFindingAssessment({ ...none, form })).toEqual({
      distinctImageCount: 0,
      graphUrls: [LEAD_3],
      kind: "missing-images",
    });
  });

  it("finds a link whose scheme is written in capitals", () => {
    const form = { body: [{ runs: [link({ url: LEAD_1.replace("https://", "HTTPS://") })], type: "paragraph" }] };
    expect(graphFindingAssessment({ ...none, form }).kind).toBe("missing-images");
  });

  it.each([
    ["back slashes", "https:\\\\ap1.datadoghq.com\\logs"],
    ["no slashes", "https:ap1.datadoghq.com/logs"],
    ["a newline inside the scheme", "htt\nps://ap1.datadoghq.com/logs"],
    ["an apostrophe in its userinfo", "https://foo'bar@ap1.datadoghq.com/logs"],
    ["Slack link markup around it", "<https://ap1.datadoghq.com/logs|the logs>"],
  ])("finds a link spelled with %s, as the URL parser reads it", (_spelling, url) => {
    const form = { grounding: { reason: `see ${url}` } };
    expect(graphFindingAssessment({ ...none, form }).kind).toBe("missing-images");
  });

  it("never reads the images field as a link", () => {
    const form = { images: [LEAD_1] };
    expect(graphFindingAssessment({ ...none, form })).toEqual({ kind: "not-graph-finding" });
  });
});

describe("graphFindingRefusal", () => {
  it("names the count, the floor, the graphs, the capture verbs and the journalled hatch", () => {
    const line = graphFindingRefusal({
      assessment: {
        distinctImageCount: 1,
        graphUrls: [LEAD_1, LEAD_2, LEAD_3, LEAD_1.replace("live=false", "x=1")],
        kind: "missing-images",
      },
    });
    expect(line).toContain("attaches 1 distinct screenshot(s)");
    expect(line).toContain("at least 3");
    expect(line).toContain(`(${LEAD_1}, ${LEAD_2}, ${LEAD_3} and 1 more)`);
    expect(line).toContain("slopweaver datadog shot explorer --url <link>");
    expect(line).toContain("`noPictureBecause` does not answer this");
    expect(line).toContain('slopweaver hatch open unshown-graphs --reason "<why>"');
    expect(line).not.toContain("SLOPWEAVER_ALLOW_UNSHOWN_GRAPHS");
  });
});
