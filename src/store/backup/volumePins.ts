/**
 * The recorded pins: one per destination on the list that sits on an external drive, in
 * `backups/store/destination-pin.json` beside `last.json`.
 *
 * Schema 2 holds a LIST, because a night writes to a list of destinations (owner ruling) and two of them may
 * each be on their own drive. A schema-1 file — the single pin `--set-destination` wrote before — is read as a
 * one-pin list, so an install pinned before needs no migration step; the next write records schema 2. A file that
 * names one root twice is refused, never silently de-duplicated: which of the two is the drive is not knowable.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { readJsonFile, writeJsonFile } from "#lib/jsonFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { ensureStagingRoot, stagingRoot } from "./staging.js";
import type { VolumePin } from "./volumePin.js";
import { type VolumePinError, VolumePinErrors } from "./volumePinErrors.js";

/** The file the pins are recorded in, under the staging root beside `last.json`. */
const PIN_FILE = "destination-pin.json";

/** One pin as it is validated on the way back in. */
const pinShape = {
  mountPoint: z.string().min(1),
  root: z.string().min(1),
  volumeName: z.string(),
  volumeUuid: z.string().min(1),
};

/** The schema-1 record: one pin, flat. */
const pinRecordV1Schema = z.object({ ...pinShape, schemaVersion: z.literal(1) }).strict();

/** The schema-2 record: every pin, by root. */
const pinRecordV2Schema = z
  .object({ pins: z.array(z.object(pinShape).strict()), schemaVersion: z.literal(2) })
  .strict();

/**
 * Where the pins are recorded.
 *
 * @param home the Slopweaver home
 * @returns the pin file's path
 */
export function volumePinPath({ home }: { home: string }): string {
  return join(stagingRoot({ home }), PIN_FILE);
}

/**
 * Read the recorded pins.
 *
 * @param home the Slopweaver home
 * @returns every pin, empty when none was ever recorded, or why the file on disk is not a pin record
 */
export function readVolumePins({ home }: { home: string }): Result<readonly VolumePin[], VolumePinError> {
  const path = volumePinPath({ home });
  if (!existsSync(path)) {
    return ok([]);
  }
  const value: unknown = readJsonFile({ path });
  const v1 = pinRecordV1Schema.safeParse(value);
  if (v1.success) {
    const { mountPoint, root, volumeName, volumeUuid } = v1.data;
    return ok([{ mountPoint, root, volumeName, volumeUuid }]);
  }
  const v2 = pinRecordV2Schema.safeParse(value);
  if (!v2.success) {
    return err(VolumePinErrors.pinMalformed({ path, why: v2.error.issues.map((issue) => issue.message).join("; ") }));
  }
  const repeated = repeatedRoot({ pins: v2.data.pins });
  if (repeated !== null) {
    return err(VolumePinErrors.pinMalformed({ path, why: `it pins ${repeated} twice` }));
  }
  return ok(
    v2.data.pins.map(({ mountPoint, root, volumeName, volumeUuid }) => ({ mountPoint, root, volumeName, volumeUuid })),
  );
}

/**
 * Record every pin, replacing the file. An empty list removes nothing: it records that no destination is pinned.
 *
 * @param home the Slopweaver home
 * @param pins every pin to keep, one per root
 * @returns the path written, or why it could not be
 */
export function writeVolumePins({
  home,
  pins,
}: {
  home: string;
  pins: readonly VolumePin[];
}): Result<string, VolumePinError> {
  const path = volumePinPath({ home });
  const repeated = repeatedRoot({ pins });
  if (repeated !== null) {
    return err(VolumePinErrors.pinMalformed({ path, why: `it would pin ${repeated} twice` }));
  }
  try {
    ensureStagingRoot({ home });
    writeJsonFile({ path, value: { pins, schemaVersion: 2 } });
    return ok(path);
  } catch (cause: unknown) {
    return err(VolumePinErrors.pinWriteFailed({ cause, path }));
  }
}

/**
 * The pin recorded for exactly this root on exactly this mount point. A pin for the same root under another mount
 * point is not it: the UUID is read where the write lands, never where the file says.
 *
 * @param pins every recorded pin
 * @param root the physical root a write lands on
 * @param mountPoint the mount point derived from where it lands
 * @returns the pin, or `null` when this root carries none
 */
export function pinForRoot({
  pins,
  root,
  mountPoint,
}: {
  pins: readonly VolumePin[];
  root: string;
  mountPoint: string;
}): VolumePin | null {
  const pin = pins.find((candidate) => candidate.root === root && candidate.mountPoint === mountPoint);
  if (pin === undefined) {
    return null;
  }
  return pin;
}

/**
 * The pins with one root's pin put in or replaced, every other kept in order.
 *
 * @param pins the pins recorded now
 * @param pin the pin to put in
 * @returns the new list
 */
export function withPin({ pins, pin }: { pins: readonly VolumePin[]; pin: VolumePin }): readonly VolumePin[] {
  const at = pins.findIndex((existing) => existing.root === pin.root);
  if (at === -1) {
    return [...pins, pin];
  }
  return pins.map((existing, index) => (index === at ? pin : existing));
}

/**
 * The first root named twice in a pin list.
 *
 * @param pins the list
 * @returns the root, or `null` when every root is named once
 */
function repeatedRoot({ pins }: { pins: readonly { readonly root: string }[] }): string | null {
  const seen = new Set<string>();
  for (const { root } of pins) {
    if (seen.has(root)) {
      return root;
    }
    seen.add(root);
  }
  return null;
}
