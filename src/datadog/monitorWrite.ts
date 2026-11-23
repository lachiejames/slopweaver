/**
 * The PURE half of `slopweaver datadog monitor`: what a monitor looks like on the wire, what a change to one
 * may say, the exact before/after a change produces, the two refusals every write passes, and the digests an
 * approval is bound to. No client, no clock, no network — `monitorApi.ts` is the edge.
 *
 * ## Why the core speaks Datadog's wire JSON rather than the SDK's models
 *
 * The SDK's models are camelCase (`renotifyInterval`); Datadog's API, its docs and its console's JSON editor
 * are snake_case (`renotify_interval`). A diff the owner says yes to has to read like the monitor the owner would
 * open, so the core works in wire JSON and the seam converts through the SDK's own serializer at the edge.
 *
 * ## What a PUT carries
 *
 * Only the top-level fields the change touches. A query-only change sends `{ query }` and nothing else, so no
 * live field — a deprecated option key above all — is ever echoed back to Datadog. `options` is the one nested
 * field: a change to it is merged over the LIVE options and the merged object is sent whole, because how
 * Datadog's PUT treats a partial `options` object is not measured here and a whole one leaves no question.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { err, ok, type Result } from "../lib/result.js";
import { stableStringify } from "../lib/stableStringify.js";
import { type DatadogMonitorWriteError, DatadogMonitorWriteErrors } from "./monitorWriteErrors.js";

/** How many hex characters of an approval digest are printed and compared — as `gmail send` uses. */
const DIGEST_WIDTH = 16;

/** One monitor as Datadog's API returns it, narrowed to what this verb reads, shows and writes. */
export const MonitorSnapshotSchema = z.object({
  creator: z
    .object({ email: z.string().nullish(), handle: z.string().nullish(), name: z.string().nullish() })
    .nullish(),
  id: z.number().int(),
  message: z.string(),
  modified: z.string(),
  name: z.string(),
  options: z.record(z.string(), z.unknown()),
  overall_state: z.string().nullish(),
  query: z.string(),
  tags: z.array(z.string()),
  type: z.string(),
});

/** One monitor as Datadog's API returns it. */
export type MonitorSnapshot = z.infer<typeof MonitorSnapshotSchema>;

/** The fields a change may set — nothing else on a monitor is this verb's to touch. */
const MonitorPatchSchema = z.strictObject({
  message: z.string().optional(),
  name: z.string().min(1).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  query: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
});

/** A requested change: each field present is the value it should end as (`options` keys merge over the live ones). */
export type MonitorPatch = z.infer<typeof MonitorPatchSchema>;

/** The exact body of the PUT: only the top-level fields that change. */
export type MonitorUpdateBody = Partial<Pick<MonitorSnapshot, "message" | "name" | "options" | "query" | "tags">>;

/** One line of the diff: a field (an option key reads `options.<key>`), what it is, and what it becomes. */
export interface MonitorFieldChange {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

/** Everything one update would do, computed before anything is sent. */
export interface MonitorUpdatePlan {
  readonly before: MonitorSnapshot;
  readonly body: MonitorUpdateBody;
  readonly changes: readonly MonitorFieldChange[];
}

/**
 * Validate a change document as the caller wrote it.
 *
 * @param value the parsed JSON, or the object the flags assembled
 * @returns the change, or why it is not one
 */
export function parseMonitorPatch({ value }: { value: unknown }): Result<MonitorPatch, DatadogMonitorWriteError> {
  const parsed = MonitorPatchSchema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => {
      const at = issue.path.length === 0 ? "(root)" : issue.path.map(String).join(".");
      return `${at}: ${issue.message}`;
    });
    return err(DatadogMonitorWriteErrors.patchInvalid({ detail: detail.join("; ") }));
  }
  if (Object.keys(parsed.data).length === 0) {
    return err(DatadogMonitorWriteErrors.patchInvalid({ detail: "it names no field to change" }));
  }
  return ok(parsed.data);
}

/** Whether two wire values carry the same data, regardless of key order. */
function sameValue({ left, right }: { left: unknown; right: unknown }): boolean {
  return stableStringify({ value: left }) === stableStringify({ value: right });
}

/** The option keys whose value the merge changes, in sorted order so the diff reads the same every time. */
function optionChanges({
  live,
  merged,
}: {
  live: Readonly<Record<string, unknown>>;
  merged: Readonly<Record<string, unknown>>;
}): readonly MonitorFieldChange[] {
  return Object.keys(merged)
    .toSorted()
    .filter((key) => !sameValue({ left: live[key], right: merged[key] }))
    .map((key) => ({ after: merged[key], before: live[key], field: `options.${key}` }));
}

/**
 * Apply a change to the live monitor, keeping only what actually moves.
 *
 * @param live the monitor as Datadog holds it now
 * @param patch the requested change
 * @returns the plan, or `NO_CHANGE` when the monitor already reads that way
 */
export function planMonitorUpdate({
  live,
  patch,
}: {
  live: MonitorSnapshot;
  patch: MonitorPatch;
}): Result<MonitorUpdatePlan, DatadogMonitorWriteError> {
  const body: MonitorUpdateBody = {};
  const changes: MonitorFieldChange[] = [];
  for (const field of ["name", "query", "message", "tags"] as const) {
    const after = patch[field];
    if (after !== undefined && !sameValue({ left: live[field], right: after })) {
      Object.assign(body, { [field]: after });
      changes.push({ after, before: live[field], field });
    }
  }
  if (patch.options !== undefined) {
    const merged = { ...live.options, ...patch.options };
    const moved = optionChanges({ live: live.options, merged });
    if (moved.length > 0) {
      body.options = merged;
      changes.push(...moved);
    }
  }
  if (changes.length === 0) {
    return err(DatadogMonitorWriteErrors.noChange({ id: live.id }));
  }
  return ok({ before: live, body, changes });
}

/**
 * The changed fields the monitor Datadog answered with does NOT carry as planned. The answer is what the write
 * did, so a field that reads otherwise afterwards is a write that did not take, whatever the status said.
 *
 * @param plan the update that was sent
 * @param after the monitor Datadog answered with
 * @returns each field that reads otherwise, empty when every change took
 */
export function readBackMismatches({
  plan,
  after,
}: {
  plan: MonitorUpdatePlan;
  after: MonitorSnapshot;
}): readonly string[] {
  return plan.changes
    .filter((change) => !sameValue({ left: fieldValue({ field: change.field, monitor: after }), right: change.after }))
    .map((change) => change.field);
}

/** A diff field's value on a monitor: `options.<key>` reads inside the options, anything else is top-level. */
function fieldValue({ monitor, field }: { monitor: MonitorSnapshot; field: string }): unknown {
  const optionPrefix = "options.";
  if (field.startsWith(optionPrefix)) {
    return monitor.options[field.slice(optionPrefix.length)];
  }
  const topLevel: Readonly<Record<string, unknown>> = monitor;
  return topLevel[field];
}

/**
 * Every recovery block Datadog's template language opens: `{{#is_recovery}}` and every `is_<state>_recovery`
 * variant (alert, warning, no data), matched by its suffix so a variant this list never named is still caught.
 */
const RECOVERY_BLOCK = /\{\{\s*#\s*is_(?:\w+_)?recovery\s*\}\}/gu;

/** Whether a `renotify_interval` value means "never renotify": Datadog reads absent, null and 0 alike. */
function neverRenotifies({ value }: { value: unknown }): boolean {
  return value === undefined || value === null || value === 0;
}

/** How many recovery blocks a message opens. */
function recoveryBlocks({ message }: { message: string }): number {
  return [...message.matchAll(RECOVERY_BLOCK)].length;
}

/**
 * What in this change would break the alert-only rule: a message that opens more recovery blocks than the live
 * one, or a renotify interval the change sets to anything but "never" — a string like `"60"` included, since
 * Datadog may coerce it. What the live monitor already carries is not this change's doing, so it is not
 * refused here.
 *
 * @param plan the planned update
 * @returns each violation, worded to follow "this change", empty when there is none
 */
export function alertOnlyViolations({ plan }: { plan: MonitorUpdatePlan }): readonly string[] {
  const violations: string[] = [];
  const { message } = plan.body;
  if (message !== undefined && recoveryBlocks({ message }) > recoveryBlocks({ message: plan.before.message })) {
    violations.push("adds a {{#is_recovery}} block to the message");
  }
  const renotify = plan.body.options?.["renotify_interval"];
  if (
    !neverRenotifies({ value: renotify }) &&
    !sameValue({ left: plan.before.options["renotify_interval"], right: renotify })
  ) {
    violations.push(`sets renotify_interval to ${JSON.stringify(renotify)}`);
  }
  return violations;
}

/**
 * Whether infrastructure-as-code owns this monitor — whether it carries one of the ownership tags the install
 * configured (`profile.json` `datadog.iacManagedTags`). An empty list leaves the guard inert.
 *
 * @param monitor the live monitor
 * @param iacManagedTags the configured ownership tags, matched exactly
 * @returns true when at least one configured tag is on the monitor
 */
export function isIacManaged({
  monitor,
  iacManagedTags,
}: {
  readonly monitor: MonitorSnapshot;
  readonly iacManagedTags: readonly string[];
}): boolean {
  return iacManagedTags.some((tag) => monitor.tags.includes(tag));
}

/** The leading hex characters of the SHA-256 over a canonical value. */
function digestOf({ value }: { value: unknown }): string {
  return createHash("sha256").update(stableStringify({ value }), "utf8").digest("hex").slice(0, DIGEST_WIDTH);
}

/**
 * The digest an update approval is bound to: the monitor as it was read, `modified` included, and the exact
 * body that would be sent. A monitor edited since the preview, or a change worded differently, stops matching.
 *
 * @param plan the planned update
 * @returns the digest
 */
export function monitorUpdateDigest({ plan }: { plan: MonitorUpdatePlan }): string {
  return digestOf({ value: { action: "update", before: plan.before, body: plan.body } });
}

/**
 * The digest a delete approval is bound to: every monitor as it was read, in the order given.
 *
 * @param monitors the monitors that would be deleted
 * @returns the digest
 */
export function monitorDeleteDigest({ monitors }: { monitors: readonly MonitorSnapshot[] }): string {
  return digestOf({ value: { action: "delete", monitors } });
}
