/**
 * One `owner-turn-*.txt` file as the rows `owner_turn` and `owner_turn_location` take. Pure: bytes and a path
 * in, rows or a named refusal out.
 *
 * The table header (`../schema/ownerTurn.ts`) says why a body is keyed by the sha-256 of its exact bytes and
 * a path is a row of its own. This module is where "exact" is enforced: the bytes are hashed as read, the
 * text stored is checked to encode back to those same bytes, and anything that would not survive the trip —
 * a NUL, which Postgres `text` refuses, or bytes that are not UTF-8 — is REFUSED with the file named rather
 * than cleaned into something the owner did not write.
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "#lib/result.js";
import type { NewOwnerTurnLocationRecord, NewOwnerTurnRecord } from "../schema/ownerTurn.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";
import { decodeExactly } from "./exactText.js";

/** The filename shape an owner-turn file carries in both families. */
export const OWNER_TURN_FILE = /^owner-turn-.*\.txt$/u;

/** Which root an owner-turn file sat under — the two values `owner_turn_location.family` admits. */
export type OwnerTurnFamily = "archive-turn" | "scratch-turn";

/** Both families, in the order the walk reads them. */
export const OWNER_TURN_FAMILIES: readonly OwnerTurnFamily[] = ["archive-turn", "scratch-turn"];

/**
 * Each family's root, relative to the state home and `/`-separated.
 *
 * Display and matching strings, never joined onto a home: `stateHomePaths()` owns the absolute paths
 * (`handoverArchive`, `supervisorScratch`), and `unit/store/fleet/ownerTurn.test.ts` holds these two equal to
 * what that contract resolves, so the two cannot drift apart.
 */
export const OWNER_TURN_ROOT_PREFIXES: Readonly<Record<OwnerTurnFamily, string>> = {
  "archive-turn": "handovers/archive",
  "scratch-turn": "supervisor-scratch",
};

/** A file projected into its body row and its location row. */
export interface ProjectedOwnerTurn {
  readonly body: NewOwnerTurnRecord;
  readonly location: NewOwnerTurnLocationRecord;
}

/** Every file's rows, bodies deduplicated. */
export interface FoldedOwnerTurns {
  readonly bodies: readonly NewOwnerTurnRecord[];
  readonly locations: readonly NewOwnerTurnLocationRecord[];
}

/**
 * The turn label a filename carries.
 *
 * @param fileName a bare filename, no directory
 * @returns the name minus `owner-turn-` and `.txt`, verbatim, or `undefined` when it is not an owner-turn file
 */
export function ownerTurnLabel({ fileName }: { fileName: string }): string | undefined {
  if (!OWNER_TURN_FILE.test(fileName)) {
    return undefined;
  }
  return fileName.slice("owner-turn-".length, -".txt".length);
}

/**
 * Which family a home-relative path belongs to.
 *
 * The same shape the walk reads (`./ownerTurnFiles.ts`): anywhere under a family root, at any depth.
 * Anywhere else, or a path with a `..` segment, is no family — a file the walk would never have found.
 *
 * @param relativePath the file's path under the home, `/`-separated
 * @returns the family, or `undefined` when the path is not where an owner-turn file lives
 */
export function ownerTurnFamily({ relativePath }: { relativePath: string }): OwnerTurnFamily | undefined {
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  const fileName = segments.at(-1)!;
  if (ownerTurnLabel({ fileName }) === undefined) {
    return undefined;
  }
  const directory = segments.slice(0, -1).join("/");
  for (const family of OWNER_TURN_FAMILIES) {
    const prefix = OWNER_TURN_ROOT_PREFIXES[family];
    if (directory === prefix || directory.startsWith(`${prefix}/`)) {
      return family;
    }
  }
  return undefined;
}

/**
 * Project one file's exact bytes into its two rows.
 *
 * @param bytes the file exactly as read — hashed as given, never trimmed
 * @param relativePath where it sat under the home, `/`-separated; names the file in any refusal
 * @param fileModifiedAt the file's mtime, recorded as when a seat last wrote it — never as when the owner spoke
 * @returns the body and location rows, or the reason the file cannot be stored verbatim
 */
export function projectOwnerTurnFile({
  bytes,
  relativePath,
  fileModifiedAt,
}: {
  bytes: Uint8Array;
  relativePath: string;
  fileModifiedAt: Date;
}): Result<ProjectedOwnerTurn, FleetImportError> {
  const family = ownerTurnFamily({ relativePath });
  if (family === undefined) {
    return err(
      FleetImportErrors.unstorableTurnFile({
        path: relativePath,
        reason: `not an owner-turn-*.txt file directly under ${OWNER_TURN_ROOT_PREFIXES["archive-turn"]}/ or ${OWNER_TURN_ROOT_PREFIXES["scratch-turn"]}/<handoff>/`,
      }),
    );
  }
  const text = decodeExactly({ bytes });
  if (text === undefined) {
    return err(
      FleetImportErrors.unstorableTurnFile({
        path: relativePath,
        reason: "its bytes are not UTF-8 that encodes back to itself",
      }),
    );
  }
  if (text.includes("\u0000")) {
    return err(
      FleetImportErrors.unstorableTurnFile({
        path: relativePath,
        reason: "it contains a NUL byte, which a Postgres text column cannot hold",
      }),
    );
  }
  const bodySha256 = createHash("sha256").update(bytes).digest("hex");
  const fileName = relativePath.split("/").at(-1)!;
  return ok({
    body: { body: text, bodySha256, byteLength: bytes.length },
    location: {
      bodySha256,
      family,
      fileModifiedAt,
      relativePath,
      turn: ownerTurnLabel({ fileName })!,
    },
  });
}

/**
 * Fold projected files into one insert set: each body once, every location kept.
 *
 * The first-seen body wins, which is harmless rather than a choice: two rows with one sha carry one text.
 *
 * Takes an ITERABLE so the import leg can hand it a generator that reads one file at a time. MEASURED,
 * the two roots hold 89,570,356 bytes of owner-turn files and only 747 distinct bodies (repro: `cd
 * ~/.slopweaver && find supervisor-scratch handovers/archive -maxdepth 2 -name 'owner-turn-*.txt' -type f
 * -print0 | xargs -0 stat -f %z | awk '{s+=$1} END {print s}'`), so holding every file's text at once would
 * keep ~89 MB resident to write a few MB of distinct bodies.
 *
 * @param projected every file's rows, in walk order
 * @returns the distinct bodies and every location
 */
export function foldOwnerTurns({ projected }: { projected: Iterable<ProjectedOwnerTurn> }): FoldedOwnerTurns {
  const bodies = new Map<string, NewOwnerTurnRecord>();
  const locations: NewOwnerTurnLocationRecord[] = [];
  for (const turn of projected) {
    if (!bodies.has(turn.body.bodySha256)) {
      bodies.set(turn.body.bodySha256, turn.body);
    }
    locations.push(turn.location);
  }
  return { bodies: [...bodies.values()], locations };
}
