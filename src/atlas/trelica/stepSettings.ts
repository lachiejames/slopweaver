/**
 * The settings that say what a workflow step is configured to DO: which integration pipeline it runs, how long it
 * waits, which licence it sets, where it posts, whether it asks first.
 *
 * Read so a definition's behaviour is held and not only its step inventory: two definitions with the same step ids,
 * order and version that differ in a Wait's timeout or a licence selection behave differently. MEASURED
 * over every workflow and step the tenant answered with a one-off read that printed each key's TYPE shape and no value. No activity
 * type carries every key, so each one is optional. Re-measure with `slopweaver atlas trelica sync`: a drifted shape is
 * refused by name at the boundary.
 *
 * What is never read stays in `workflowStepSchemas.ts`'s unread list: a step's credentials, headers, URL, method,
 * body, message body, fixed password and integration input values. A message step's RECIPIENTS are read and its
 * body is not, and a recipient's email and id are declared and unread, so only a name is held. A licence list
 * (`licensesToAdd`, `licensesToRemove`) has never been seen non-empty, so its entry is `z.never()`: the first one
 * refuses the sync by name rather than being held under a guessed shape.
 */
import { z } from "zod";

import { unsetFieldAsNull } from "#lib/absent.js";

import { unreadTrelicaKeys } from "./boundaryShapes.js";
import { TRELICA_PROVIDER_TEXT_WITHHELD } from "./providerText.js";

/** The setting keys, spread into the current step schema and declared unread on a historical version's. */
export const TRELICA_STEP_SETTING_KEYS = [
  "delayType",
  "delayUnit",
  "dueDateOffset",
  "forceGroupRemoval",
  "licensesToAdd",
  "licensesToRemove",
  "notifyUser",
  "pipelineName",
  "requestApproval",
  "selectedLicense",
  "skipIfNoAccount",
  "timeoutInHours",
  "timeoutInMinutes",
  "timeoutInWorkingDays",
  "toChannel",
  "toPeople",
  "toRecipientTypes",
  "transitionImmediately",
] as const;

/** The typed read of every setting key, in {@link TRELICA_STEP_SETTING_KEYS}'s order. */
export const TRELICA_STEP_SETTING_SHAPES = {
  delayType: z.string().optional(),
  delayUnit: z.string().optional(),
  dueDateOffset: z.number().optional(),
  forceGroupRemoval: z.boolean().optional(),
  licensesToAdd: z.array(z.never()).optional(),
  licensesToRemove: z.array(z.never()).optional(),
  notifyUser: z.boolean().optional(),
  pipelineName: z.string().optional(),
  requestApproval: z.boolean().optional(),
  selectedLicense: z
    .strictObject({
      label: z.string(),
      licensePlanId: z.string(),
      ...unreadTrelicaKeys({ keys: ["customerIntegrationId", "multiSelect", "providerId"] }),
    })
    .optional(),
  skipIfNoAccount: z.boolean().optional(),
  timeoutInHours: z.number().optional(),
  timeoutInMinutes: z.number().optional(),
  timeoutInWorkingDays: z.number().optional(),
  toChannel: z.strictObject({ name: z.string(), ...unreadTrelicaKeys({ keys: ["id", "isPrivate"] }) }).optional(),
  toPeople: z
    .array(z.strictObject({ name: z.string(), ...unreadTrelicaKeys({ keys: ["email", "id", "personType"] }) }))
    .optional(),
  toRecipientTypes: z.array(z.string()).optional(),
  transitionImmediately: z.boolean().optional(),
} satisfies Record<(typeof TRELICA_STEP_SETTING_KEYS)[number], z.ZodType>;

/** A step as the boundary admits its settings. */
type TrelicaStepSettingFields = z.infer<z.ZodObject<typeof TRELICA_STEP_SETTING_SHAPES>>;

/** What one step is configured to do; a setting its activity type does not carry is `null`. */
export interface TrelicaStepSettings {
  /** The integration pipeline a custom integration action runs, e.g. `transferResources`. */
  readonly pipeline: string | null;
  readonly delayType: string | null;
  readonly delayUnit: string | null;
  readonly timeoutMinutes: number | null;
  readonly timeoutHours: number | null;
  readonly timeoutWorkingDays: number | null;
  /** `dueDateOffset` as Trelica sets it, on a step that raises a task for someone else. */
  readonly dueDateOffset: number | null;
  readonly transitionImmediately: boolean | null;
  /** The licence a licence step sets, closed by {@link heldTrelicaLicence}. */
  readonly licence: { readonly planId: string; readonly label: string } | null;
  readonly licencesToAdd: number | null;
  readonly licencesToRemove: number | null;
  readonly skipIfNoAccount: boolean | null;
  readonly forceGroupRemoval: boolean | null;
  readonly notifyUser: boolean | null;
  readonly requestApproval: boolean | null;
  /** The channel a message step posts to, by name. */
  readonly channel: string | null;
  /** The people a message step sends to, by name. */
  readonly recipients: readonly string[] | null;
  /** The recipient roles a message step resolves at run time, as Trelica names them. */
  readonly recipientTypes: readonly string[] | null;
}

/**
 * The licence labels a licence step is held with as written. A label is the integration's own plan-list text, so it
 * is provider-written: anything outside this measured set is the withheld marker. MEASURED over every
 * licence step of every held workflow; reproduce with `jq -r '.. | objects | select(has("licence")) | .licence |
 * select(. != null) | .label' ~/.slopweaver/atlas/trelica/workflows.jsonl | sort -u`.
 *
 * @internal
 */
export const TRELICA_MEASURED_LICENCE_LABELS: ReadonlySet<string> = new Set([
  "(None)",
  "Google Workspace Enterprise Standard",
]);

/**
 * The plan ids a licence step is held with as written, measured the same way with `.planId` in place of `.label`. A
 * plan id is the integration's own key, and an id's shape cannot tell a key from a short secret, so it is closed
 * against what was seen rather than against a pattern.
 *
 * @internal
 */
export const TRELICA_MEASURED_LICENCE_PLAN_IDS: ReadonlySet<string> = new Set(["0000000000_Google-Apps", "1010020026"]);

/**
 * A licence selection as the atlas may hold it: a measured label and a measured plan id as written, each otherwise
 * the withheld marker.
 *
 * @param label the label the integration's plan list gives it
 * @param planId the plan's key
 * @returns the closed selection
 * @internal
 */
export function heldTrelicaLicence({ label, planId }: { label: string; planId: string }): {
  label: string;
  planId: string;
} {
  return {
    label: TRELICA_MEASURED_LICENCE_LABELS.has(label) ? label : TRELICA_PROVIDER_TEXT_WITHHELD,
    planId: TRELICA_MEASURED_LICENCE_PLAN_IDS.has(planId) ? planId : TRELICA_PROVIDER_TEXT_WITHHELD,
  };
}

/** A list's length, or `null` for a list the step does not carry. */
function lengthOf({ list }: { list: readonly unknown[] | undefined }): number | null {
  return list === undefined ? null : list.length;
}

/**
 * One step's settings.
 *
 * @param step the step as the boundary admitted it
 * @returns the settings held for it
 */
export function trelicaStepSettings({ step }: { step: TrelicaStepSettingFields }): TrelicaStepSettings {
  const { selectedLicense, toChannel, toPeople } = step;
  return {
    channel: toChannel === undefined ? null : toChannel.name,
    delayType: unsetFieldAsNull({ key: "delayType", record: step }),
    delayUnit: unsetFieldAsNull({ key: "delayUnit", record: step }),
    dueDateOffset: unsetFieldAsNull({ key: "dueDateOffset", record: step }),
    forceGroupRemoval: unsetFieldAsNull({ key: "forceGroupRemoval", record: step }),
    licence:
      selectedLicense === undefined
        ? null
        : heldTrelicaLicence({ label: selectedLicense.label, planId: selectedLicense.licensePlanId }),
    licencesToAdd: lengthOf({ list: step.licensesToAdd }),
    licencesToRemove: lengthOf({ list: step.licensesToRemove }),
    notifyUser: unsetFieldAsNull({ key: "notifyUser", record: step }),
    pipeline: unsetFieldAsNull({ key: "pipelineName", record: step }),
    recipientTypes: step.toRecipientTypes === undefined ? null : [...step.toRecipientTypes],
    recipients: toPeople === undefined ? null : toPeople.map((recipient) => recipient.name),
    requestApproval: unsetFieldAsNull({ key: "requestApproval", record: step }),
    skipIfNoAccount: unsetFieldAsNull({ key: "skipIfNoAccount", record: step }),
    timeoutHours: unsetFieldAsNull({ key: "timeoutInHours", record: step }),
    timeoutMinutes: unsetFieldAsNull({ key: "timeoutInMinutes", record: step }),
    timeoutWorkingDays: unsetFieldAsNull({ key: "timeoutInWorkingDays", record: step }),
    transitionImmediately: unsetFieldAsNull({ key: "transitionImmediately", record: step }),
  };
}

/** The held settings, read back out of a kind file. */
export const heldTrelicaStepSettingsSchema = z.object({
  channel: z.string().nullable(),
  delayType: z.string().nullable(),
  delayUnit: z.string().nullable(),
  dueDateOffset: z.number().nullable(),
  forceGroupRemoval: z.boolean().nullable(),
  // Closed again on the way out, so a record an older, looser rule wrote never reaches a report as written.
  licence: z
    .object({ label: z.string(), planId: z.string() })
    .transform((licence) => heldTrelicaLicence(licence))
    .nullable(),
  licencesToAdd: z.number().nullable(),
  licencesToRemove: z.number().nullable(),
  notifyUser: z.boolean().nullable(),
  pipeline: z.string().nullable(),
  recipientTypes: z.array(z.string()).nullable(),
  recipients: z.array(z.string()).nullable(),
  requestApproval: z.boolean().nullable(),
  skipIfNoAccount: z.boolean().nullable(),
  timeoutHours: z.number().nullable(),
  timeoutMinutes: z.number().nullable(),
  timeoutWorkingDays: z.number().nullable(),
  transitionImmediately: z.boolean().nullable(),
}) satisfies z.ZodType<TrelicaStepSettings>;

/** `yes` or `no`. */
function yesNo({ value }: { value: boolean }): string {
  return value ? "yes" : "no";
}

/** One phrase per yes/no setting the step carries. */
function flagPhrases({ settings }: { settings: TrelicaStepSettings }): string[] {
  const flags: [string, boolean | null][] = [
    ["moves on immediately", settings.transitionImmediately],
    ["skips a person with no account", settings.skipIfNoAccount],
    ["forces group removal", settings.forceGroupRemoval],
    ["notifies the user", settings.notifyUser],
    ["asks for approval first", settings.requestApproval],
  ];
  return flags.flatMap(([label, value]) => (value === null ? [] : [`${label}: ${yesNo({ value })}`]));
}

/** One phrase per timing setting the step carries. */
function timingPhrases({ settings }: { settings: TrelicaStepSettings }): string[] {
  const phrases: string[] = [];
  if (settings.delayType !== null || settings.delayUnit !== null) {
    phrases.push(`delay ${[settings.delayType, settings.delayUnit].filter((part) => part !== null).join(" in ")}`);
  }
  const timeouts: [number | null, string][] = [
    [settings.timeoutMinutes, "minute(s)"],
    [settings.timeoutHours, "hour(s)"],
    [settings.timeoutWorkingDays, "working day(s)"],
  ];
  for (const [amount, unit] of timeouts) {
    if (amount !== null) {
      phrases.push(`timeout ${String(amount)} ${unit}`);
    }
  }
  if (settings.dueDateOffset !== null) {
    phrases.push(`due-date offset ${String(settings.dueDateOffset)}`);
  }
  return phrases;
}

/** One phrase per licence or message setting the step carries. */
function targetPhrases({ settings }: { settings: TrelicaStepSettings }): string[] {
  const phrases: string[] = [];
  if (settings.pipeline !== null) {
    phrases.push(`runs ${settings.pipeline}`);
  }
  if (settings.licence !== null) {
    phrases.push(`sets the licence to "${settings.licence.label}" (plan ${settings.licence.planId})`);
  }
  if (settings.licencesToAdd !== null) {
    phrases.push(`licences listed to add: ${String(settings.licencesToAdd)}`);
  }
  if (settings.licencesToRemove !== null) {
    phrases.push(`licences listed to remove: ${String(settings.licencesToRemove)}`);
  }
  if (settings.channel !== null) {
    phrases.push(`posts to #${settings.channel}`);
  }
  if (settings.recipients !== null && settings.recipients.length > 0) {
    phrases.push(`messages ${settings.recipients.join(", ")}`);
  }
  if (settings.recipientTypes !== null && settings.recipientTypes.length > 0) {
    phrases.push(`messages each ${settings.recipientTypes.join(", ")}`);
  }
  return phrases;
}

/**
 * What a step is configured to do, one short phrase per setting it carries, in a fixed order.
 *
 * @returns the phrases; empty for a step that carries none of these settings
 */
export function trelicaStepSettingPhrases({ settings }: { settings: TrelicaStepSettings }): string[] {
  return [...targetPhrases({ settings }), ...timingPhrases({ settings }), ...flagPhrases({ settings })];
}
