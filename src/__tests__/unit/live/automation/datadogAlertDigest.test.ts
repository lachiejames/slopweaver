/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  DATADOG_ALERT_DIGEST_KIND,
  datadogAlertDigestPostArgv,
  datadogAlertDigestReadRest,
  planDatadogAlertDigest,
} from "../../../../live/automation/datadogAlertDigest.js";
import { parseRecipeDefinition, type RecipeDefinition } from "../../../../live/automation/definition.js";
import type { RecipeDefinitionRun } from "../../../../live/automation/definitionRunStore.js";
import { runShapeForDefinition, runShapeForKind } from "../../../../live/automation/definitionShape.js";
import { defaultIntro } from "../../../../live/automation/firstFiring.js";
import { findRecipeKind } from "../../../../live/automation/kinds.js";

/** A row that has delivered before, so its firing carries no day-one intro. */
const RAN: RecipeDefinitionRun = {
  exitCode: 0,
  lastRunAtIso: "2026-09-15T12:30:05Z",
  watermarkIso: "2026-09-15T12:30:00Z",
};

const PROBES = [
  {
    id: "sends",
    kind: "logs-count",
    query: "service:example-api status:error",
    severityWhenFiring: "orange",
    title: "send failures",
    why: "the outer send catch",
  },
];

/** A parsed row selecting this kind, overridable field by field. */
function row(over: Record<string, unknown> = {}): RecipeDefinition {
  return unwrap(
    parseRecipeDefinition({
      value: {
        cadence: "30 12 * * *",
        destination: { kind: "slack" },
        effect: "read-write",
        kind: DATADOG_ALERT_DIGEST_KIND,
        params: { channel: "C0ALERTS", label: "Knock", probes: PROBES, window: "24h" },
        recipeId: "knock-alerts-digest",
        schemaVersion: 1,
        ...over,
      },
    }),
  );
}

describe("the kind is registered and runs in this process", () => {
  it("is a registered read-write kind that is not briefing-only", () => {
    const kind = findRecipeKind({ kind: DATADOG_ALERT_DIGEST_KIND });
    expect(kind?.capability).toBe("read-write");
    expect(kind?.briefingOnly).toBe(false);
  });

  it("costs a command rather than a session", () => {
    expect(runShapeForKind({ kind: DATADOG_ALERT_DIGEST_KIND })).toBe("run-here");
  });
});

describe("planDatadogAlertDigest", () => {
  it("resolves a complete row", () => {
    const plan = unwrap(planDatadogAlertDigest({ definition: row() }));
    expect(plan.channel).toBe("C0ALERTS");
    expect(plan.label).toBe("Knock");
    expect(plan.window).toBe("24h");
    expect(plan.lead).toBeUndefined();
    expect(plan.probesDocument).toBe(JSON.stringify({ probes: PROBES }));
  });

  it("leaves an omitted window undefined, so the verb keeps the only copy of the default", () => {
    const plan = unwrap(
      planDatadogAlertDigest({ definition: row({ params: { channel: "C0X", label: "Knock", probes: PROBES } }) }),
    );
    expect(plan.window).toBeUndefined();
  });

  it("refuses a read-only row, which would post a card its own file says it cannot", () => {
    const failure = unwrapErr(planDatadogAlertDigest({ definition: row({ effect: "read" }) }));
    expect(failure.code).toBe("EFFECT_TOO_NARROW");
    expect(failure.message).toContain("POSTS the card it builds");
  });

  it("refuses a row naming no channel", () => {
    const failure = unwrapErr(
      planDatadogAlertDigest({ definition: row({ params: { label: "Knock", probes: PROBES } }) }),
    );
    expect(failure.code).toBe("PARAMS_INVALID");
    expect(failure.message).toContain("channel");
  });

  it("refuses a row naming no label, since the label prefixes the card's TL;DR", () => {
    const failure = unwrapErr(
      planDatadogAlertDigest({ definition: row({ params: { channel: "C0X", probes: PROBES } }) }),
    );
    expect(failure.code).toBe("PARAMS_INVALID");
    expect(failure.message).toContain("label");
  });

  it("refuses a row carrying no probes at all", () => {
    const failure = unwrapErr(
      planDatadogAlertDigest({ definition: row({ params: { channel: "C0X", label: "Knock" } }) }),
    );
    expect(failure.code).toBe("PARAMS_INVALID");
    expect(failure.message).toContain("probes");
  });

  it("refuses a params field nobody declared rather than ignoring it", () => {
    const failure = unwrapErr(
      planDatadogAlertDigest({
        definition: row({ params: { channel: "C0X", label: "Knock", postTo: "C0Y", probes: PROBES } }),
      }),
    );
    expect(failure.code).toBe("PARAMS_INVALID");
    expect(failure.message).toContain("postTo");
  });
});

describe("the two legs' argv", () => {
  it("adds the day-one intro to the read tail on the row's first firing", () => {
    const plan = unwrap(
      planDatadogAlertDigest({ definition: row({ params: { channel: "C0X", label: "Knock", probes: PROBES } }) }),
    );
    const rest = datadogAlertDigestReadRest({ plan, priorRun: undefined });

    expect(rest.slice(0, 4)).toEqual(["--probes", JSON.stringify({ probes: PROBES }), "--label", "Knock"]);
    expect(rest[4]).toBe("--intro");
    expect(JSON.parse(rest[5]!)).toEqual(defaultIntro({ cadence: row().cadence }));
    expect(rest.at(-1)).toBe("--form");
  });

  it("builds a read tail that asks for the form and omits what the row did not set", () => {
    const plan = unwrap(
      planDatadogAlertDigest({ definition: row({ params: { channel: "C0X", label: "Knock", probes: PROBES } }) }),
    );
    expect(datadogAlertDigestReadRest({ plan, priorRun: RAN })).toEqual([
      "--probes",
      JSON.stringify({ probes: PROBES }),
      "--label",
      "Knock",
      "--form",
    ]);
  });

  it("carries the row's window and lead into the read tail when it set them", () => {
    const plan = unwrap(
      planDatadogAlertDigest({
        definition: row({
          params: { channel: "C0X", label: "Knock", lead: "quiet week.", probes: PROBES, window: "7d" },
        }),
      }),
    );
    expect(datadogAlertDigestReadRest({ plan, priorRun: RAN })).toEqual([
      "--probes",
      JSON.stringify({ probes: PROBES }),
      "--label",
      "Knock",
      "--window",
      "7d",
      "--lead",
      "quiet week.",
      "--form",
    ]);
  });

  it("posts to the conversation it is HANDED, never one it reads off the plan", () => {
    const argv = datadogAlertDigestPostArgv({
      dryRun: false,
      idempotencyKey: "recipe-slot:deadbeef",
      form: "{}",
      home: "/tmp/h",
      media: [],
      postTo: "D0SYNOWNERDM",
    });
    expect(argv[2]).toBe("slack");
    expect(argv[3]).toBe("post");
    expect(argv).toEqual([
      "node",
      "slopweaver",
      "slack",
      "post",
      "--as",
      "bot",
      "--channel",
      "D0SYNOWNERDM",
      "--form",
      "{}",
      "--home",
      "/tmp/h",
      "--idempotency-key",
      "recipe-slot:deadbeef",
      "--dm-purpose",
      "investigation-finding",
    ]);
  });

  it("appends --dry-run only on a dry run", () => {
    expect(
      datadogAlertDigestPostArgv({
        dryRun: true,
        idempotencyKey: "recipe-slot:deadbeef",
        form: "{}",
        home: "/tmp/h",
        media: [],
        postTo: "D0SYNOWNERDM",
      }).at(-1),
    ).toBe("--dry-run");
  });

  it("attaches every graded capture as one comma-separated --media value", () => {
    const argv = datadogAlertDigestPostArgv({
      dryRun: false,
      form: "{}",
      home: "/tmp/h",
      idempotencyKey: "recipe-slot:deadbeef",
      media: ["/tmp/h/datadog-shots/a.png", "/tmp/h/datadog-shots/b.png"],
      postTo: "D0SYNOWNERDM",
    });
    expect(argv.at(-2)).toBe("--media");
    expect(argv.at(-1)).toBe("/tmp/h/datadog-shots/a.png,/tmp/h/datadog-shots/b.png");
  });

  it("reads params.shots off the row, and defaults it to false", () => {
    expect(unwrap(planDatadogAlertDigest({ definition: row() })).shots).toBe(false);
    const withShots = row();
    const shotsRow = { ...withShots, params: { ...(withShots.params as Record<string, unknown>), shots: true } };
    expect(unwrap(planDatadogAlertDigest({ definition: shotsRow })).shots).toBe(true);
  });

  it("refuses a shots value that is not the literal true", () => {
    const base = row();
    const bad = { ...base, params: { ...(base.params as Record<string, unknown>), shots: false } };
    const refused = unwrapErr(planDatadogAlertDigest({ definition: bad }));
    expect(refused.code).toBe("PARAMS_INVALID");
    expect(refused.message).toContain("shots");
  });
});

describe("a shots row is seated rather than run in the tick", () => {
  it("answers spawn for a row whose params carry shots", () => {
    const base = row();
    const shotsRow = { ...base, params: { ...(base.params as Record<string, unknown>), shots: true } };
    expect(runShapeForDefinition({ definition: shotsRow })).toBe("spawn");
  });

  it("answers run-here for the same row without them", () => {
    expect(runShapeForDefinition({ definition: row() })).toBe("run-here");
  });

  it("leaves a row whose params do not parse to its kind's own answer", () => {
    const base = row();
    const broken = { ...base, params: { ...(base.params as Record<string, unknown>), channel: "" } };
    expect(runShapeForDefinition({ definition: broken })).toBe("run-here");
  });
});

describe("the recommendations lane a row turns on", () => {
  /** One authored recommendation, whose `clears` names a probe id the row declares. */
  const RECOMMENDATION = {
    act: "raise-pr",
    change: "exclude TaskTransitionError, which is one stuck draft plan rather than a defect",
    clears: "webhook-failures",
    evidenceUrl: "https://ap1.datadoghq.com/monitors/100001",
  } as const;

  it("passes the set to the read leg as ONE argv word, directly before --form", () => {
    const plan = unwrap(
      planDatadogAlertDigest({
        definition: row({
          params: { channel: "C0ALERTS", label: "Knock", probes: PROBES, recommendations: [RECOMMENDATION] },
        }),
      }),
    );
    const rest = datadogAlertDigestReadRest({ plan, priorRun: RAN });

    expect(rest.at(-3)).toBe("--recommendations");
    expect(JSON.parse(rest.at(-2)!)).toEqual({ recommendations: [RECOMMENDATION] });
    expect(rest.at(-1)).toBe("--form");
  });

  it("leaves a row that never turned the lane on with exactly the argv it always had", () => {
    const plan = unwrap(planDatadogAlertDigest({ definition: row() }));

    expect(datadogAlertDigestReadRest({ plan, priorRun: RAN })).not.toContain("--recommendations");
  });

  it("turns the LANE off and says so on the plan when a row's set is malformed — the card still posts", () => {
    const definition = row({
      params: { channel: "C0ALERTS", label: "Knock", probes: PROBES, recommendations: [{ act: "raise-pr" }] },
    });
    const plan = planDatadogAlertDigest({ definition });

    expect(plan.isOk()).toBe(true);
    expect(unwrap(plan).recommendationsDocument).toBeUndefined();
    expect(unwrap(plan).recommendationsProblem).toContain("recommendations lane OFF");
    expect(datadogAlertDigestReadRest({ plan: unwrap(plan), priorRun: RAN })).not.toContain("--recommendations");
  });
});
