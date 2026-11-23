/**
 * Judging an answer's Datadog citations from the URL alone.
 *
 * Every URL in this file is a synthetic fixture in the shape a reviewed answer carries under
 * `$SLOPWEAVER_HOME/live/slack/reviews/<thread>/answer-reviewed-*.json`. The pairing is what matters for the
 * falsifiability of the `toEqual([])` cases below: the scoped metric citation asserting NO scope violation is
 * evidence only because the unscoped one, identical but for `exp_scope`, is in the same file asserting one.
 */
import { describe, expect, it } from "vitest";

import { citedViewOfPath, datadogCitationIssues } from "../../../datadog/answerCitations.js";

/** An unscoped database metric citation: the blended line a figure gets read off. No `exp_scope`. */
const UNSCOPED_METRIC_FIXTURE =
  "https://ap1.datadoghq.com/metric/explorer?exp_metric=gcp.cloudsql.database.cpu.utilization" +
  "&exp_agg=avg&start=1700000000000&end=1700003600000&paused=true";

/** The same citation scoped to the one database the claim is about. */
const SCOPED_METRIC_FIXTURE =
  "https://ap1.datadoghq.com/metric/explorer?exp_metric=gcp.cloudsql.database.cpu.utilization" +
  "&exp_agg=avg&exp_scope=database_id%3Aacme-fixture%3Aacme-fixture-postgres" +
  "&start=1700000000000&end=1700003600000&paused=true";

/**
 * A usage citation summed with `exp_group=service` and no `exp_scope`.
 *
 * It is here because it is the ONE false refusal a scope-only rule was measured producing: run over every
 * citation this install's reviewed answers carry, `exp_scope` alone reported a link of this shape beside an
 * unscoped database one, and only the second is a defect. A group-by renders one series per service, so the
 * named system's own line is exactly what the reader sees.
 */
const USAGE_GROUPED_NOT_SCOPED =
  "https://ap1.datadoghq.com/metric/explorer?exp_metric=datadog.estimated_usage.apm.ingested_bytes" +
  "&exp_group=service&exp_agg=sum&start=1700000000000&end=1700604800000&paused=true";

/** A sibling metric citation scoped from the first draft — the counterexample inside the same answer. */
const SCOPED_SIBLING_FIXTURE =
  "https://ap1.datadoghq.com/metric/explorer?exp_metric=gcp.run.container.instance_count&exp_agg=sum" +
  "&exp_scope=service_name%3Aproduction-acme-fixture-service&start=1700000000000&end=1700003600000&paused=true";

/** A traces citation frozen with the documented APM params, which `ddLink.ts` MEASURED clamping to 15 minutes. */
const LEGACY_TRACE_FREEZE_FIXTURE =
  "https://ap1.datadoghq.com/apm/traces?query=service%3Aacme-fixture-api%20env%3Aproduction%20%40http.status_code%3A503" +
  "&start=1700000000000&end=1700003600000&paused=true";

/** The same traces query frozen the way `ddConsoleLink` builds one — the shape the claim's window survives. */
const TRACES_CORRECTLY_FROZEN =
  "https://ap1.datadoghq.com/apm/traces?query=service%3Aacme-fixture-api%20env%3Aproduction%20%40http.status_code%3A503" +
  "&from_ts=1700000000000&to_ts=1700003600000&live=false";

/** A logs citation, correctly frozen — nothing in this class is ever wrong about it. */
const LOGS_FROZEN =
  "https://ap1.datadoghq.com/logs?query=env%3A%28prod%20OR%20production%29%20service%3Aacme-fixture-api" +
  "%20%40err.code%3AFIXTURE_SHED&agg_m=count&agg_t=count&agg_q=revision_name&viz=timeseries" +
  "&from_ts=1700000000000&to_ts=1700003600000&live=false";

/** An APM service citation — a real view this module deliberately knows no rules for. */
const APM_SERVICE =
  "https://ap1.datadoghq.com/apm/services/acme-fixture-api?env=production&start=1700000000000&end=1700003600000";

describe("citedViewOfPath", () => {
  it("names each view this module judges by its exact console path", () => {
    expect(citedViewOfPath({ pathname: "/logs" })).toBe("logs");
    expect(citedViewOfPath({ pathname: "/apm/traces" })).toBe("traces");
    expect(citedViewOfPath({ pathname: "/rum" })).toBe("rum");
    expect(citedViewOfPath({ pathname: "/metric/explorer" })).toBe("metrics");
  });

  it("claims no view for an APM path that merely starts like the traces one, so no prefix match decides it", () => {
    expect(citedViewOfPath({ pathname: "/apm/services/acme-fixture-api" })).toBeUndefined();
  });
});

describe("datadogCitationIssues — an unscoped metric citation", () => {
  it("names the absent exp_scope on the citation a figure was read off", () => {
    const issues = datadogCitationIssues({ url: UNSCOPED_METRIC_FIXTURE });
    expect(issues).toEqual([
      "a metric explorer link with neither exp_scope nor exp_group renders the metric blended across every reporting instance in the org, so a claim about one named system rests on a number that system never produced",
    ]);
  });

  it("clears the same citation once it is scoped to the one database", () => {
    expect(datadogCitationIssues({ url: SCOPED_METRIC_FIXTURE })).toEqual([]);
  });

  it("clears the sibling citation beside it, which carried a scope from the first draft", () => {
    expect(datadogCitationIssues({ url: SCOPED_SIBLING_FIXTURE })).toEqual([]);
  });

  it("clears a link broken out by exp_group with no scope, the one false refusal a scope-only rule produced", () => {
    // Falsifiable against the first case: this URL and UNSCOPED_METRIC_FIXTURE are both unscoped metric links
    // over a frozen window, and the only difference is the group-by — so this `toEqual([])` fails the moment the
    // discharge is dropped, rather than passing because the whole check went quiet.
    expect(datadogCitationIssues({ url: USAGE_GROUPED_NOT_SCOPED })).toEqual([]);
  });

  it("names an absent exp_metric separately, so a link missing both reports both in one pass", () => {
    const issues = datadogCitationIssues({
      url: "https://ap1.datadoghq.com/metric/explorer?exp_agg=avg&start=1700000000000&end=1700003600000&paused=true",
    });
    expect(issues).toEqual([
      "a metric explorer link names its metric in exp_metric, and this one names none",
      "a metric explorer link with neither exp_scope nor exp_group renders the metric blended across every reporting instance in the org, so a claim about one named system rests on a number that system never produced",
    ]);
  });
});

describe("datadogCitationIssues — a traces freeze review never catches", () => {
  it("refuses the APM freeze params on a traces link, which the console clamps to 15 minutes", () => {
    expect(datadogCitationIssues({ url: LEGACY_TRACE_FREEZE_FIXTURE })).toEqual([
      "the traces view freezes with from_ts and to_ts in epoch milliseconds and this link carries neither, so it opens live at 'now' and the reader sees a different window from the one the claim was computed over",
      "the traces view is pinned by live=false, and this link carries (absent)",
    ]);
  });

  it("accepts the same query frozen the way the builder builds it", () => {
    expect(datadogCitationIssues({ url: TRACES_CORRECTLY_FROZEN })).toEqual([]);
  });

  it("accepts a logs citation from the same answer, so the two domains are judged by their own params", () => {
    expect(datadogCitationIssues({ url: LOGS_FROZEN })).toEqual([]);
  });

  it("names an inverted window rather than accepting it as frozen", () => {
    expect(
      datadogCitationIssues({
        url: "https://ap1.datadoghq.com/logs?query=service%3Aapi&from_ts=1700003600000&to_ts=1700000000000&live=false",
      }),
    ).toEqual(["the window is inverted — from_ts 1700003600000 is not before to_ts 1700000000000"]);
  });

  it("treats a window param that is not a clean positive integer as absent, never as epoch 0", () => {
    expect(
      datadogCitationIssues({
        url: "https://ap1.datadoghq.com/logs?query=service%3Aapi&from_ts=8x&to_ts=1700003600000&live=false",
      })[0],
    ).toContain("freezes with from_ts and to_ts in epoch milliseconds");
  });
});

describe("datadogCitationIssues — what is deliberately outside the criterion", () => {
  it("says nothing about the APM service view, whose freeze behaviour nobody here has measured", () => {
    expect(datadogCitationIssues({ url: APM_SERVICE })).toEqual([]);
  });

  it("says nothing about a GitHub citation, so a non-Datadog link is never judged by Datadog rules", () => {
    expect(
      datadogCitationIssues({
        url: "https://github.com/acme/acme-admin/blob/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678/services/api/src/server/start.ts#L44-L50",
      }),
    ).toEqual([]);
  });

  it("says nothing about a string that is not a URL at all, rather than throwing on it", () => {
    expect(datadogCitationIssues({ url: "not a url" })).toEqual([]);
  });

  it("recognises the EU console and a bare apex host, so the vendor test is not one site's spelling", () => {
    const unscopedOn = ({ host }: { host: string }): readonly string[] =>
      datadogCitationIssues({
        url: `https://${host}/metric/explorer?exp_metric=gcp.cloudsql.database.cpu.utilization&start=1700000000000&end=1700003600000&paused=true`,
      });
    expect(unscopedOn({ host: "app.datadoghq.eu" })).toEqual([
      "a metric explorer link with neither exp_scope nor exp_group renders the metric blended across every reporting instance in the org, so a claim about one named system rests on a number that system never produced",
    ]);
    expect(unscopedOn({ host: "datadoghq.com" })).toEqual([
      "a metric explorer link with neither exp_scope nor exp_group renders the metric blended across every reporting instance in the org, so a claim about one named system rests on a number that system never produced",
    ]);
  });

  it("says nothing about a host that merely ends in a lookalike domain", () => {
    expect(
      datadogCitationIssues({
        url: "https://notdatadoghq.com.example.net/metric/explorer?exp_metric=x&start=1&end=2&paused=true",
      }),
    ).toEqual([]);
  });

  it("leaves a quoted free-text query alone, because nothing in a URL says a phrase match was undeclared", () => {
    expect(
      datadogCitationIssues({
        url: "https://ap1.datadoghq.com/logs?query=%22pool%20exhausted%22&from_ts=1700000000000&to_ts=1700003600000&live=false",
      }),
    ).toEqual([]);
  });
});
