/**
 * `planAlertSummary` and its two argv builders — the `alert-summary` kind's executor, which the kind registry
 * declares and which has to run in Slopweaver itself.
 *
 * The whole module is pure, so the real schema and the real defaults are the fixture. What has to be
 * falsifiable here is the refusal that keeps a read-only row from posting, and the exact argv each leg gets
 * — a card is only "exactly what the channel would see" if the dry run and the real run build the same one.
 *
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  alertSummaryPostArgv,
  alertSummaryReadRest,
  planAlertSummary,
} from "../../../../live/automation/alertSummary.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../live/automation/definition.js";
import type { RecipeDefinitionRun } from "../../../../live/automation/definitionRunStore.js";
import { defaultIntro } from "../../../../live/automation/firstFiring.js";

/** A row that has delivered before, so its firing carries no day-one intro. */
const RAN: RecipeDefinitionRun = {
  exitCode: 0,
  lastRunAtIso: "2026-09-15T12:30:05Z",
  watermarkIso: "2026-09-15T12:30:00Z",
};

/** An `alert-summary` row reading and posting to one conversation, overridable field by field. */
function row(over: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    cadence: "30 12 * * *",
    destination: { kind: "slack" },
    effect: "read-write",
    enabled: true,
    kind: "alert-summary",
    onMissed: "skip",
    params: { channel: "C0ALERTS", label: "Knock alerts", window: "24h" },
    recipeId: "knock-alerts",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

describe("planAlertSummary", () => {
  it("plans a row that names a channel, and leaves postTo unset so the tick resolves the owner's DM", () => {
    const plan = unwrap(planAlertSummary({ definition: row() }));
    expect(plan.recipeId).toBe("knock-alerts");
    expect(plan.channel).toBe("C0ALERTS");
    // 291-8x: the read channel is NOT echoed into `postTo`. A row that names nowhere to post names nowhere,
    // and `cli/commands/automation/postTargetLeg.ts` answers `slackBot.promptChannel` for it.
    expect(plan.postTo).toBe(undefined);
    expect(plan.window).toBe("24h");
    expect(plan.label).toBe("Knock alerts");
    expect(plan.lead).toBe(undefined);
  });

  it("leaves an omitted window and label undefined, so the read verb stays the one authority on its defaults", () => {
    const plan = unwrap(planAlertSummary({ definition: row({ params: { channel: "C0ALERTS" } }) }));
    expect(plan.window).toBe(undefined);
    expect(plan.label).toBe(undefined);
  });

  it("posts to the conversation the row named when it names a separate one", () => {
    const plan = unwrap(planAlertSummary({ definition: row({ params: { channel: "C0ALERTS", postTo: "D0PROOF" } }) }));
    expect(plan.channel).toBe("C0ALERTS");
    expect(plan.postTo).toBe("D0PROOF");
  });

  it("keeps the row's own lead sentence, which the read leg validates against the counts", () => {
    const plan = unwrap(
      planAlertSummary({ definition: row({ params: { channel: "C0ALERTS", lead: "Two monitors carried it." } }) }),
    );
    expect(plan.lead).toBe("Two monitors carried it.");
  });

  it("refuses a row declaring read, because every alert-summary run posts its card", () => {
    const error = unwrapErr(planAlertSummary({ definition: row({ effect: "read" }) }));
    expect(error.code).toBe("EFFECT_TOO_NARROW");
    expect(error.message).toContain("POSTS the card it builds");
  });

  it("accepts a row declaring write, which covers the post exactly", () => {
    const plan = unwrap(planAlertSummary({ definition: row({ effect: "write" }) }));
    expect(plan.channel).toBe("C0ALERTS");
  });

  it("refuses params that name no channel", () => {
    const error = unwrapErr(planAlertSummary({ definition: row({ params: { window: "24h" } }) }));
    expect(error.code).toBe("PARAMS_INVALID");
    expect(error.message).toContain("channel");
  });

  it("refuses an empty channel rather than reading the whole workspace", () => {
    const error = unwrapErr(planAlertSummary({ definition: row({ params: { channel: "" } }) }));
    expect(error.code).toBe("PARAMS_INVALID");
  });

  it("refuses a key the kind does not know, so a typo is never silently ignored", () => {
    const error = unwrapErr(planAlertSummary({ definition: row({ params: { channel: "C0ALERTS", windows: "24h" } }) }));
    expect(error.code).toBe("PARAMS_INVALID");
    expect(error.message).toContain("windows");
  });
});

describe("alertSummaryReadRest", () => {
  it("asks the read verb for the form alone, over the row's channel and window", () => {
    const plan = unwrap(planAlertSummary({ definition: row() }));
    expect(alertSummaryReadRest({ home: "/h", plan, priorRun: RAN })).toEqual([
      "--channel",
      "C0ALERTS",
      "--window",
      "24h",
      "--label",
      "Knock alerts",
      "--home",
      "/h",
      "--form",
    ]);
  });

  it("adds no flag a row did not configure, so the verb's own defaults still apply", () => {
    const plan = unwrap(planAlertSummary({ definition: row({ params: { channel: "C1" } }) }));

    expect(alertSummaryReadRest({ home: "/h", plan, priorRun: RAN })).toEqual([
      "--channel",
      "C1",
      "--home",
      "/h",
      "--form",
    ]);
  });

  it("passes a lead sentence through for validation, and omits the flag when there is none", () => {
    const withLead = unwrap(planAlertSummary({ definition: row({ params: { channel: "C1", lead: "Quiet week." } }) }));
    expect(alertSummaryReadRest({ home: "/h", plan: withLead, priorRun: RAN })).toEqual([
      "--channel",
      "C1",
      "--lead",
      "Quiet week.",
      "--home",
      "/h",
      "--form",
    ]);
    expect(
      alertSummaryReadRest({ home: "/h", plan: unwrap(planAlertSummary({ definition: row() })), priorRun: RAN }),
    ).not.toContain("--lead");
  });
});

describe("alertSummaryReadRest — a row's first firing", () => {
  it("adds the derived day-one intro when no firing of the row has ever settled", () => {
    const plan = unwrap(planAlertSummary({ definition: row({ params: { channel: "C1", label: "alerts-dx" } }) }));

    expect(alertSummaryReadRest({ home: "/h", plan, priorRun: undefined })).toEqual([
      "--channel",
      "C1",
      "--label",
      "alerts-dx",
      "--intro",
      JSON.stringify(defaultIntro({ cadence: "30 12 * * *" })),
      "--home",
      "/h",
      "--form",
    ]);
  });

  it("uses the row's own intro lines when it wrote them", () => {
    const plan = unwrap(
      planAlertSummary({ definition: row({ params: { channel: "C1", intro: ["trying this out for a week."] } }) }),
    );

    expect(alertSummaryReadRest({ home: "/h", plan, priorRun: undefined })).toEqual([
      "--channel",
      "C1",
      "--intro",
      JSON.stringify(["trying this out for a week."]),
      "--home",
      "/h",
      "--form",
    ]);
  });

  it("REFUSES a row whose intro is not one to four lines", () => {
    const refused = unwrapErr(planAlertSummary({ definition: row({ params: { channel: "C1", intro: [] } }) }));

    expect(refused.code).toBe("PARAMS_INVALID");
  });
});

describe("alertSummaryPostArgv", () => {
  it("posts to the conversation it is HANDED, never one it reads off the plan", () => {
    expect(
      alertSummaryPostArgv({
        dryRun: false,
        idempotencyKey: "recipe-slot:deadbeef",
        form: '{"kind":"alert-summary"}',
        home: "/h",
        postTo: "D0SYNOWNERDM",
      }),
    ).toEqual([
      "node",
      "slopweaver",
      "slack",
      "post",
      "--as",
      "bot",
      "--channel",
      "D0SYNOWNERDM",
      "--form",
      '{"kind":"alert-summary"}',
      "--home",
      "/h",
      "--idempotency-key",
      "recipe-slot:deadbeef",
      "--dm-purpose",
      "investigation-finding",
    ]);
  });

  it("appends --dry-run and changes nothing else, so a dry run renders the card a real run would send", () => {
    const real = alertSummaryPostArgv({
      dryRun: false,
      idempotencyKey: "recipe-slot:deadbeef",
      form: "{}",
      home: "/h",
      postTo: "D0SYNOWNERDM",
    });
    const dry = alertSummaryPostArgv({
      dryRun: true,
      idempotencyKey: "recipe-slot:deadbeef",
      form: "{}",
      home: "/h",
      postTo: "D0SYNOWNERDM",
    });
    expect(dry).toEqual([...real, "--dry-run"]);
  });
});

describe("the recommendations lane a row turns on", () => {
  /** One authored recommendation, as a row's `params.recommendations` carries it. */
  const RECOMMENDATION = {
    act: "tune-monitor",
    change: "renotify 60 to 0 so a stuck group stops re-posting hourly",
    clears: "Payments — no successful Stripe payment (AU) in 2h",
    evidenceUrl: "https://ap1.datadoghq.com/monitors/700002",
  } as const;

  it("passes the set to the read leg as ONE argv word, after the intro and before --home", () => {
    const plan = unwrap(
      planAlertSummary({
        definition: row({ params: { channel: "C0ALERTS", label: "Knock alerts", recommendations: [RECOMMENDATION] } }),
      }),
    );

    const rest = alertSummaryReadRest({ home: "/h", plan, priorRun: RAN });

    expect(rest.filter((word) => word !== rest[5])).toEqual([
      "--channel",
      "C0ALERTS",
      "--label",
      "Knock alerts",
      "--recommendations",
      "--home",
      "/h",
      "--form",
    ]);
    expect(JSON.parse(rest[5]!)).toEqual({ recommendations: [RECOMMENDATION] });
  });

  it("leaves a row that never turned the lane on with exactly the argv it always had", () => {
    const plan = unwrap(planAlertSummary({ definition: row() }));

    expect(alertSummaryReadRest({ home: "/h", plan, priorRun: RAN })).not.toContain("--recommendations");
  });

  it("turns the LANE off and says so on the plan when a row's set is malformed — the card still posts", () => {
    const definition = row({ params: { channel: "C0ALERTS", recommendations: [{ act: "raise-pr" }] } });
    const plan = planAlertSummary({ definition });

    expect(plan.isOk()).toBe(true);
    expect(unwrap(plan).recommendationsDocument).toBeUndefined();
    expect(unwrap(plan).recommendationsProblem).toContain("recommendations lane OFF");
    expect(alertSummaryReadRest({ home: "/h", plan: unwrap(plan), priorRun: RAN })).not.toContain("--recommendations");
  });
});
