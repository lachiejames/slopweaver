/**
 * A step's settings, from the real workflow boundary to the report's words. The boundary input carries a canary under
 * every secret-bearing key a step declares beside its settings, and each case asserts both halves: the parsed input
 * carries the canary, and the held detail does not.
 */
import { describe, expect, it } from "vitest";

import { TRELICA_SECRET_BEARING_KEYS } from "../../../../atlas/trelica/browserReduction.js";
import { trelicaOffboardingWorkflowEvidence } from "../../../../atlas/trelica/offboardingWorkflows.js";
import { TRELICA_PROVIDER_TEXT_WITHHELD } from "../../../../atlas/trelica/providerText.js";
import {
  heldTrelicaLicence,
  heldTrelicaStepSettingsSchema,
  TRELICA_MEASURED_LICENCE_LABELS,
  TRELICA_MEASURED_LICENCE_PLAN_IDS,
  TRELICA_STEP_SETTING_KEYS,
  TRELICA_STEP_SETTING_SHAPES,
  trelicaStepSettingPhrases,
} from "../../../../atlas/trelica/stepSettings.js";
import { trelicaWorkflowsBoundary } from "../../../../atlas/trelica/workflowBoundaries.js";
import { trelicaWorkflowDetail } from "../../../../atlas/trelica/workflowProjection.js";
import { TRELICA_STEP_SECRET_KEYS } from "../../../../atlas/trelica/workflowStepSchemas.js";
import { unwrap } from "../../../../lib/result.js";
import { configuredStep, NO_STEP_SETTINGS, workflow } from "./offboardingFixtures.js";

const SECRET_CANARY = "canary-step-secret";
const RECIPIENT_EMAIL_CANARY = "canary-recipient@example.test";

/** The definition-level fields every workflow record carries, all invented. */
const DEFINITION = {
  activeItemCount: 0,
  archived: false,
  completedItemCount: 0,
  completedWithErrorsItemCount: 0,
  createdDtm: "2026-01-01T00:00:00Z",
  enabled: true,
  failedItemCount: 0,
  flowType: "Offboarding",
  id: { id: "w1", version: 0 },
  itemCount: 0,
  lastModifiedDtm: "2026-01-01T00:00:00Z",
  latestPublishedVersion: 4,
  name: "Leaver flow",
  needsInputItemCount: 0,
  terminatedItemCount: 0,
  trigger: { activityType: "PersonLeavesTrigger", name: "Person leaves" },
  waitingForUserItemCount: 0,
};

/** Three steps whose settings sit beside a secret-bearing key: a licence change, a wait, a message. */
const page = unwrap(
  trelicaWorkflowsBoundary.parse({
    value: {
      counts: {},
      items: [
        {
          ...DEFINITION,
          activities: [
            {
              activityCategory: "Action",
              activityType: "SetUserLicense",
              continueOnError: true,
              id: "s1",
              inputParameterValues: { token: SECRET_CANARY },
              licensesToAdd: [],
              licensesToRemove: [],
              name: "Set licence",
              selectedLicense: {
                customerIntegrationId: "i1",
                label: "(None)",
                licensePlanId: "0000000000_Google-Apps",
                multiSelect: false,
                providerId: "GSuite",
              },
              skipIfNoAccount: false,
            },
            {
              activityCategory: "Flow",
              activityType: "Delay",
              continueOnError: false,
              delayType: "DelayForHours",
              delayUnit: "Minutes",
              id: "s2",
              name: "Wait",
              timeoutInMinutes: 2,
            },
            {
              activityCategory: "Action",
              activityType: "SendMessage",
              continueOnError: false,
              credentials: SECRET_CANARY,
              id: "s3",
              messageBody: SECRET_CANARY,
              name: "Send Slack message",
              toChannel: { id: "C1", isPrivate: true, name: "leavers" },
              toPeople: [{ email: RECIPIENT_EMAIL_CANARY, id: "p1", name: "Ada Admin", personType: "User" }],
              toRecipientTypes: ["LineManager"],
            },
          ],
        },
      ],
      resultsTruncated: false,
      total: 1,
    },
  }),
);

describe("trelicaWorkflowDetail step settings", () => {
  const detail = trelicaWorkflowDetail({ record: page.items[0]!, tags: new Map() });

  it("holds each step's settings and none of the secret-bearing keys beside them", () => {
    expect(JSON.stringify(page)).toContain(SECRET_CANARY);
    expect(JSON.stringify(page)).toContain(RECIPIENT_EMAIL_CANARY);
    expect(detail.steps.map((step) => step.settings)).toEqual([
      {
        ...NO_STEP_SETTINGS,
        licence: { label: "(None)", planId: "0000000000_Google-Apps" },
        licencesToAdd: 0,
        licencesToRemove: 0,
        skipIfNoAccount: false,
      },
      { ...NO_STEP_SETTINGS, delayType: "DelayForHours", delayUnit: "Minutes", timeoutMinutes: 2 },
      { ...NO_STEP_SETTINGS, channel: "leavers", recipientTypes: ["LineManager"], recipients: ["Ada Admin"] },
    ]);
    expect(JSON.stringify(detail)).not.toContain(SECRET_CANARY);
    expect(JSON.stringify(detail)).not.toContain(RECIPIENT_EMAIL_CANARY);
  });

  it("puts each step's settings into words", () => {
    expect(detail.steps.map((step) => trelicaStepSettingPhrases({ settings: step.settings }))).toEqual([
      [
        'sets the licence to "(None)" (plan 0000000000_Google-Apps)',
        "licences listed to add: 0",
        "licences listed to remove: 0",
        "skips a person with no account: no",
      ],
      ["delay DelayForHours in Minutes", "timeout 2 minute(s)"],
      ["posts to #leavers", "messages Ada Admin", "messages each LineManager"],
    ]);
  });
});

describe("trelicaOffboardingWorkflowEvidence configured behaviour", () => {
  it("tells two definitions apart that share step ids, order and version and differ only in a setting", () => {
    const waitFor = ({ minutes }: { minutes: number }) =>
      workflow({
        id: "w1",
        name: "Leaver flow",
        steps: [configuredStep({ activityType: "Delay", name: "Wait", settings: { timeoutMinutes: minutes } })],
      });
    const short = trelicaOffboardingWorkflowEvidence({ runs: [], workflow: waitFor({ minutes: 2 }) });
    const long = trelicaOffboardingWorkflowEvidence({ runs: [], workflow: waitFor({ minutes: 2880 }) });
    expect(short.steps.map((step) => step.id)).toEqual(long.steps.map((step) => step.id));
    expect(short.latestPublishedVersion).toBe(long.latestPublishedVersion);
    expect(short.steps[0]!.configured).toEqual(["timeout 2 minute(s)"]);
    expect(long.steps[0]!.configured).toEqual(["timeout 2880 minute(s)"]);
  });

  it("says nothing for a step that carries no setting", () => {
    expect(trelicaStepSettingPhrases({ settings: NO_STEP_SETTINGS })).toEqual([]);
  });
});

describe("heldTrelicaLicence", () => {
  it("holds a measured label and an id-shaped plan as written", () => {
    expect(TRELICA_MEASURED_LICENCE_LABELS.has("(None)")).toBe(true);
    expect(heldTrelicaLicence({ label: "(None)", planId: "0000000000_Google-Apps" })).toEqual({
      label: "(None)",
      planId: "0000000000_Google-Apps",
    });
  });

  it("withholds a label and a plan id outside the measured sets, even one shaped like an id", () => {
    expect(TRELICA_MEASURED_LICENCE_PLAN_IDS.has("1010020026")).toBe(true);
    expect(heldTrelicaLicence({ label: SECRET_CANARY, planId: "hunter2" })).toEqual({
      label: TRELICA_PROVIDER_TEXT_WITHHELD,
      planId: TRELICA_PROVIDER_TEXT_WITHHELD,
    });
  });

  it("closes the label from the boundary to the held read and the report's words", () => {
    const leaked = unwrap(
      trelicaWorkflowsBoundary.parse({
        value: {
          counts: {},
          items: [
            {
              ...DEFINITION,
              activities: [
                {
                  activityCategory: "Action",
                  activityType: "SetUserLicense",
                  continueOnError: false,
                  id: "s1",
                  selectedLicense: { label: SECRET_CANARY, licensePlanId: "1010020026" },
                },
              ],
            },
          ],
          resultsTruncated: false,
          total: 1,
        },
      }),
    );
    const held = trelicaWorkflowDetail({ record: leaked.items[0]!, tags: new Map() }).steps[0]!.settings;
    const reread = heldTrelicaStepSettingsSchema.parse({
      ...NO_STEP_SETTINGS,
      licence: { label: SECRET_CANARY, planId: "1010020026" },
    });

    expect(JSON.stringify(leaked)).toContain(SECRET_CANARY);
    expect(held.licence).toEqual({ label: TRELICA_PROVIDER_TEXT_WITHHELD, planId: "1010020026" });
    expect(reread.licence).toEqual({ label: TRELICA_PROVIDER_TEXT_WITHHELD, planId: "1010020026" });
    expect(trelicaStepSettingPhrases({ settings: reread })).toEqual([
      `sets the licence to "${TRELICA_PROVIDER_TEXT_WITHHELD}" (plan 1010020026)`,
    ]);
  });
});

describe("TRELICA_STEP_SECRET_KEYS", () => {
  it("is pruned wherever a reused record is written, and none of it is a setting", () => {
    expect(TRELICA_STEP_SECRET_KEYS.length).toBeGreaterThan(0);
    expect(TRELICA_STEP_SECRET_KEYS.filter((key) => !TRELICA_SECRET_BEARING_KEYS.has(key))).toEqual([]);
    expect(TRELICA_STEP_SECRET_KEYS.filter((key) => Object.hasOwn(TRELICA_STEP_SETTING_SHAPES, key))).toEqual([]);
  });
});

describe("TRELICA_STEP_SETTING_KEYS", () => {
  it("names exactly the keys the typed read declares", () => {
    expect(TRELICA_STEP_SETTING_KEYS.length).toBeGreaterThan(0);
    expect([...TRELICA_STEP_SETTING_KEYS]).toEqual(Object.keys(TRELICA_STEP_SETTING_SHAPES));
  });
});
