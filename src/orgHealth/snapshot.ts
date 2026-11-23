/**
 * The incident snapshot's codec: what `org-health read` writes and the `org-health` monitor reads back.
 *
 * Strict on purpose. The monitor's whole value is telling "nothing is wrong" apart from "the read broke", so a file
 * whose shape drifted decodes to an error the monitor reports `unmeasurable`, never to an empty incident list.
 *
 * Pure: no I/O.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import type { IncidentSightings } from "./sightings.js";
import type { IncidentSnapshot } from "./types.js";

/** One update, as the snapshot keeps it. */
const updateSchema = z.strictObject({
  author: z.string(),
  iso: z.iso.datetime(),
  status: z.string().min(1),
  text: z.string(),
});

/**
 * One loud moment (`./types.ts` `LoudMoment`). No `schemaVersion` bump for it: no build that wrote the file without
 * it ever shipped, so there is no older file to read.
 */
const loudSchema = z.discriminatedUnion("kind", [
  z.strictObject({ iso: z.iso.datetime(), kind: z.enum(["new", "reopened"]) }),
  z.strictObject({ fromSeverity: z.string().min(1), iso: z.iso.datetime(), kind: z.literal("severity-changed") }),
]);

/** One incident, as the snapshot keeps it. */
const incidentSchema = z.strictObject({
  channelId: z.string().min(1).optional(),
  declaredIso: z.iso.datetime(),
  homepageUrl: z.url(),
  lastUpdate: updateSchema.optional(),
  lead: z.string().min(1).optional(),
  loud: loudSchema.optional(),
  phase: z.enum(["investigating", "identified", "monitoring", "resolved"]),
  phaseChangedIso: z.iso.datetime(),
  phaseProvenance: z.enum(["update", "declared", "inferred", "sighted"]),
  ref: z.string().regex(/^INC-\d+$/u),
  severity: z.string().min(1),
  status: z.string().min(1),
  title: z.string(),
});

/** The whole file. */
const snapshotSchema = z.discriminatedUnion("state", [
  z.strictObject({
    announcementCount: z.number().int().nonnegative(),
    channelId: z.string().min(1),
    incidents: z.array(incidentSchema),
    readIso: z.iso.datetime(),
    schemaVersion: z.literal(1),
    state: z.literal("measured"),
  }),
  z.strictObject({
    attemptedIso: z.iso.datetime(),
    because: z.string().min(1),
    schemaVersion: z.literal(1),
    state: z.literal("unmeasurable"),
  }),
]);

/** The sightings file (`./sightings.ts`). */
const sightingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sightings: z.record(
    z.string().regex(/^INC-\d+$/u),
    z.strictObject({
      loud: loudSchema.optional(),
      phase: z.enum(["investigating", "identified", "monitoring", "resolved"]),
      severity: z.string().min(1),
      sinceIso: z.iso.datetime(),
    }),
  ),
});

/**
 * Decode an already-parsed sightings file.
 *
 * @param value the parsed JSON
 * @returns the sightings by ref, or every way the file does not match
 */
export function decodeIncidentSightings({ value }: { value: unknown }): Result<IncidentSightings> {
  const parsed = sightingsSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  return ok(parsed.data.sightings satisfies IncidentSightings);
}

/**
 * Decode an already-parsed snapshot file.
 *
 * @param value the parsed JSON
 * @returns the snapshot, or every way it does not match
 */
export function decodeIncidentSnapshot({ value }: { value: unknown }): Result<IncidentSnapshot> {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  return ok(parsed.data satisfies IncidentSnapshot);
}
