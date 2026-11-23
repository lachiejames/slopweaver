/**
 * `last.json` under the staging root — the record of the most recent backup attempt, and the file `store
 * backup --status` reads to answer whether this machine's store is backed up anywhere else.
 *
 * ## One record per destination
 *
 * A night writes to a LIST of destinations (owner ruling), so once a staging exists the record is the
 * `destinations` arm: one {@link DestinationAttempt} per destination, in list order — succeeded, its drive not
 * plugged in, or failed — so an unplugged SSD and a written Mac folder are both on record from the same night.
 * Even every destination failing is that arm: the staging exists, and `--sweep-only` can still send it.
 *
 * ## `succeeded` means the bytes reached a destination, and nothing else does
 *
 * The record used to carry `{ status: "succeeded", uploaded: false }` for a run that staged and stopped, which made
 * "a backup nobody notices is not happening" expressible in the verb's own record — MEASURED on this install, where
 * `2026-09-20T05-49-58-043Z` and `2026-09-20T14-24-14-429Z` held 1.98 GB of dump that never left the machine while
 * `store backup --status` exited zero. So a run that sent nothing on purpose records the `staged` arm, which has
 * to name WHY it sent nothing.
 *
 * ## The single-destination records are still read
 *
 * A file written before the list — `succeeded`, `drive-not-plugged-in` — is read into a one-destination
 * `destinations` arm, its id hashed from its root exactly as a listed destination's is, so an install upgraded
 * between two nights reads its last night without a migration.
 *
 * One file, every staging-producing invocation. A hand-typed `store backup --local-only` overwrites the nightly's
 * record, so "the last invocation did what it was asked" and "there is a fresh copy off this machine" are two
 * questions — each destination's newest receipt answers the second one. A `--sweep-only` run writes nothing here:
 * it updates receipts, and this file keeps describing the last staging that was taken.
 */
import { existsSync } from "node:fs";
import { basename, join, sep } from "node:path";

import { z } from "zod";

import { readJsonFile, writeJsonFile } from "#lib/jsonFile.js";

import { type DestinationId, destinationId } from "./destinationConfig.js";
import { ensureStagingRoot, stagingRoot } from "./staging.js";

/** The file recording the most recent attempt's outcome, under the staging root. */
const LAST_OUTCOME_FILE = "last.json";

/** Why a run that reached no destination did not, as `--local-only` records it. */
export const LOCAL_ONLY_WHY = "--local-only was passed, so nothing was sent to the destination";

/** What a destination off any external drive is called on a status line. */
const THIS_MAC_LABEL = "this Mac";

/** What became of one destination on the night recorded. */
export type DestinationAttempt =
  | {
      readonly status: "succeeded";
      readonly id: DestinationId;
      readonly root: string;
      readonly label: string;
      readonly prefix: string;
    }
  | {
      /** Its drive was out, so it was sent nothing; `--sweep-only` sends it once the drive is back. */
      readonly status: "drive-not-plugged-in";
      readonly id: DestinationId;
      readonly root: string;
      readonly label: string;
      readonly mountPoint: string;
      readonly volumeUuid: string;
    }
  | {
      readonly status: "failed";
      readonly id: DestinationId;
      readonly root: string;
      readonly label: string;
      readonly errors: readonly string[];
    };

/**
 * The most recent attempt, and what it did with the bytes.
 *
 * A `status` discriminator rather than an `ok: true` literal: the two-armed `ok` shape is a hand-rolled
 * `Result` and `.claude/rules/error-handling.md` bans one. This is a RECORD of an attempt written to disk
 * and read back, not a return value, so a real `Result` would be the wrong animal too. `failed` is a failure
 * BEFORE any staging existed.
 */
export type LastOutcome =
  | {
      readonly status: "destinations";
      readonly atIso: string;
      readonly directory: string;
      readonly destinations: readonly DestinationAttempt[];
    }
  | { readonly status: "staged"; readonly atIso: string; readonly directory: string; readonly why: string }
  | { readonly status: "failed"; readonly atIso: string; readonly errors: readonly string[] };

/**
 * What a read of `last.json` found: the record, no file at all, or a file that is not one.
 *
 * The two failures are kept apart because they are different statements about the install and used to be
 * rendered as the same sentence. "Nothing has ever run here" is a fresh machine; "there is a file there and
 * it is not a last-attempt record" is one that has been hand-edited, truncated or written by a shape this
 * code no longer knows, and it means the reader has NO idea when the last backup was.
 */
export type LastOutcomeRead = LastOutcome | "absent" | "unreadable";

/** One destination's attempt, as validated on the way back in. */
const attemptSchema = z.discriminatedUnion("status", [
  z
    .object({
      id: z.string().min(1),
      label: z.string().min(1),
      prefix: z.string().min(1),
      root: z.string().min(1),
      status: z.literal("succeeded"),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      label: z.string().min(1),
      mountPoint: z.string().min(1),
      root: z.string().min(1),
      status: z.literal("drive-not-plugged-in"),
      volumeUuid: z.string().min(1),
    })
    .strict(),
  z
    .object({
      errors: z.array(z.string()),
      id: z.string().min(1),
      label: z.string().min(1),
      root: z.string().min(1),
      status: z.literal("failed"),
    })
    .strict(),
]);

/** The shape `last.json` is validated against on the way back in, so a hand-edited file is refused rather than trusted. */
const lastOutcomeSchema = z.union([
  z
    .object({
      atIso: z.iso.datetime(),
      destinations: z.array(attemptSchema),
      directory: z.string(),
      status: z.literal("destinations"),
    })
    .strict(),
  z
    .object({ atIso: z.iso.datetime(), directory: z.string(), status: z.literal("staged"), why: z.string().min(1) })
    .strict(),
  z.object({ atIso: z.iso.datetime(), errors: z.array(z.string()), status: z.literal("failed") }).strict(),
]);

/** The two single-destination arms a record names one destination by: written, or its drive out. */
const singleDestinationSchema = z.union([
  z
    .object({
      atIso: z.iso.datetime(),
      destination: z.string().min(1),
      directory: z.string(),
      prefix: z.string().min(1),
      status: z.literal("succeeded"),
    })
    .strict(),
  z
    .object({
      atIso: z.iso.datetime(),
      destination: z.string().min(1),
      directory: z.string(),
      mountPoint: z.string().min(1),
      status: z.literal("drive-not-plugged-in"),
      volumeUuid: z.string().min(1),
    })
    .strict(),
]);

/**
 * What a destination root is called on a status line when no pin names its volume: the `/Volumes/<name>` it sits on,
 * else this Mac.
 *
 * @param root the destination root
 * @returns the label
 */
export function rootLabel({ root }: { root: string }): string {
  const parts = root.split(sep);
  if (parts[1] === "Volumes" && parts[2] !== undefined && parts[2] !== "") {
    return parts[2];
  }
  return THIS_MAC_LABEL;
}

/**
 * Record the most recent attempt's outcome.
 *
 * @param home the Slopweaver home
 * @param outcome what happened
 */
export function recordLastOutcome({ home, outcome }: { home: string; outcome: LastOutcome }): void {
  writeJsonFile({ path: join(ensureStagingRoot({ home }), LAST_OUTCOME_FILE), value: outcome });
}

/**
 * Read the most recent attempt's outcome, or say which way the read failed. A single-destination record is read
 * into the `destinations` arm.
 *
 * @param home the Slopweaver home
 * @returns the outcome, `"absent"` when nothing has ever run here, `"unreadable"` when the file is not a record
 */
export function readLastOutcome({ home }: { home: string }): LastOutcomeRead {
  const path = join(stagingRoot({ home }), LAST_OUTCOME_FILE);
  if (!existsSync(path)) {
    return "absent";
  }
  const value: unknown = readJsonFile({ path });
  const parsed = lastOutcomeSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  const single = singleDestinationSchema.safeParse(value);
  if (!single.success) {
    return "unreadable";
  }
  const { atIso, destination: root, directory } = single.data;
  const id = destinationId({ root });
  if (single.data.status === "succeeded") {
    const attempt = { id, label: rootLabel({ root }), prefix: single.data.prefix, root, status: "succeeded" as const };
    return { atIso, destinations: [attempt], directory, status: "destinations" };
  }
  const { mountPoint, volumeUuid } = single.data;
  const label = basename(mountPoint);
  return {
    atIso,
    destinations: [{ id, label, mountPoint, root, status: "drive-not-plugged-in", volumeUuid }],
    directory,
    status: "destinations",
  };
}
