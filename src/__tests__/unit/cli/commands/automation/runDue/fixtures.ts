/*
 * The pure fixtures every `automation run-due` test file shares: the definition rows a store is seeded with, the
 * documents the recording read and post legs answer with, the firing a cadence covers, and the verb's argv.
 */
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../../../live/automation/definition.js";
import { latestFiringAtOrBefore } from "../../../../../../live/automation/definitionDue.js";

/**
 * The install's configured private prompt conversation — where an `investigate` row's question is asked.
 *
 * A `D`-prefixed id because the surface `turn brief` is handed is DERIVED from it, so a channel-shaped
 * placeholder would silently assert the wrong branch of that derivation.
 */
export const PROMPT_CHANNEL = "D0PROMPT";

/** The form document the recording read leg answers with, so a test can assert what the post carried. */
export const READ_FORM = '{"kind":"alert-summary","label":"Knock alerts","rows":[],"skipped":0,"window":"24h"}';

/** The digest form the recording digest read leg answers with. */
export const DIGEST_FORM =
  '{"items":[{"count":3,"severity":"orange","title":"send failures"}],"kind":"digest","label":"Knock","window":"24h"}';

/** The `--json` document a real `slack post` answers a confirmed send with, trimmed to what is read back. */
export const POST_REPORT = JSON.stringify({
  preview: ["what regressed in staging overnight?"],
  sent: { ts: "1789.0001" },
});

/**
 * One `verb-run` row selecting `atlas freshness`, overridable field by field.
 *
 * @returns the row as a definition file holds it
 */
export function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cadence: "0 * * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    kind: "verb-run",
    params: { argv: ["atlas", "freshness", "--behind-only"] },
    recipeId: "atlas-rolling-window",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/**
 * One `alert-summary` row reading and posting to the same conversation, overridable field by field.
 *
 * @returns the row as a definition file holds it
 */
export function alertRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cadence: "0 * * * *",
    destination: { kind: "slack" },
    effect: "read-write",
    kind: "alert-summary",
    params: { channel: "C0ALERTS", label: "Knock alerts", window: "24h" },
    recipeId: "knock-alerts",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/**
 * One `datadog-alert-digest` row, overridable field by field.
 *
 * Its `params.channel` is `PROMPT_CHANNEL` — the owner's own DM — because a digest reads probes rather than a
 * conversation, so that field is purely where the card is ASKED to land, and the standing rule makes the owner's DM
 * what an unremarkable row names. A row aiming at a team channel is a case of its own in
 * `datadogAlertDigest.test.ts`.
 *
 * @returns the row as a definition file holds it
 */
export function digestRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cadence: "30 12 * * *",
    destination: { kind: "slack" },
    effect: "read-write",
    kind: "datadog-alert-digest",
    params: {
      channel: PROMPT_CHANNEL,
      label: "Knock",
      probes: [
        {
          id: "sends",
          kind: "logs-count",
          query: "service:example-api status:error",
          severityWhenFiring: "orange",
          title: "send failures",
          why: "the outer send catch",
        },
      ],
      window: "24h",
    },
    recipeId: "knock-alerts-digest",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/**
 * One `investigate` row — the briefing-only kind, which asks its question and joins the ask lane.
 *
 * Hourly rather than daily on purpose: an hourly slot is the same instant in every whole-hour zone, so the
 * watermark these cases assert does not move when the lane runs in UTC rather than the author own zone.
 *
 * @returns the row as a definition file holds it
 */
export function investigateRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cadence: "0 * * * *",
    destination: { kind: "slack" },
    effect: "read",
    kind: "investigate",
    params: { askedBy: "U0OWNER", channel: PROMPT_CHANNEL, question: "what regressed in staging overnight?" },
    recipeId: "overnight-staging",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/**
 * The firing a cadence covers at an instant, as a plain string.
 *
 * `latestFiringAtOrBefore` answers `string | { error }`, and a test that stringified the union would print
 * `[object Object]` into an expectation and pass on a cadence that never parsed. Asking the cadence rather
 * than writing an instant out is deliberate: cron is evaluated in the machine's LOCAL time, so a literal
 * here would pass in one timezone and assert the wrong firing in another.
 *
 * @returns the firing's ISO instant; throws when the cadence resolves none
 */
export function firingAt({ cadence, nowIso }: { readonly cadence: string; readonly nowIso: string }): string {
  const firing = latestFiringAtOrBefore({ cadence, nowIso });
  if (typeof firing !== "string") {
    throw new Error(`cadence \`${cadence}\` did not resolve a firing: ${firing.error}`);
  }
  return firing;
}

/**
 * The full argv one invocation of this verb receives.
 *
 * @param tail the flags after `--home`, none by default
 * @returns the argv `runDueUnderFake` is handed
 */
export function argvFor({ home, tail = [] }: { home: string; tail?: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "recipe", "run-due", "--home", home, ...tail];
}
