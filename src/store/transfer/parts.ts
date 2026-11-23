/**
 * The parts a Slopweaver store export carries, in the one order every reader, writer and report uses.
 *
 * An export is the installation's OWNED typed state — what nothing upstream can hand back — and nothing else:
 * the knowledge register and its recall ledger, the owner's profile and voice register, and the three
 * judgement registers that shape how the fleet works for the owner. Content a provider can be asked for again,
 * handovers, published pages and the derived session-start cache are deliberately not parts: the first is
 * re-ingested, the cache is rebuilt from the store after a restore, and the rest have their own owners.
 *
 * Each part keeps its own `schemaVersion`, so one part's representation can change without forcing every
 * other part, or the manifest, to a new version.
 */
import { STEER_MEASUREMENT_EXPORT_VERSION } from "../../profile/steerMeasurementTransfer.js";

/** Every part an export carries. */
export type StoreExportPartKind =
  | "memories"
  | "memory-recalls"
  | "owner-profile"
  | "owner-voice"
  | "owner-directives"
  | "standing-asks"
  | "steer-verdicts";

/** How a part's bytes are laid out. */
type StoreExportMediaType = "application/json" | "application/x-ndjson";

/** One part as the registry fixes it: where it lives in the export and how it is read. */
export interface StoreExportPartSpec {
  readonly kind: StoreExportPartKind;
  /** A root-level basename: no part ever lives in a subdirectory, so a nested path is always a forgery. */
  readonly file: string;
  readonly mediaType: StoreExportMediaType;
  /** The version this build writes. */
  readonly exportSchemaVersion: number;
  /** Every version this build reads, the one it writes among them, so an older export stays importable. */
  readonly readableSchemaVersions: readonly number[];
}

/**
 * The registry, in report order.
 *
 * The memory pair keeps the `knowledge export` file names, so a pair written by that verb and a pair inside a
 * store export are the same bytes and `knowledge restore --file` reads either. The three judgement registers
 * keep the names their journals carry under the home, which is also what an unmanifested export made by
 * copying them holds.
 */
export const STORE_EXPORT_PARTS: readonly StoreExportPartSpec[] = [
  {
    exportSchemaVersion: 1,
    file: "memories.jsonl",
    kind: "memories",
    mediaType: "application/x-ndjson",
    readableSchemaVersions: [1],
  },
  {
    exportSchemaVersion: 1,
    file: "memories.jsonl.recalls.jsonl",
    kind: "memory-recalls",
    mediaType: "application/x-ndjson",
    readableSchemaVersions: [1],
  },
  {
    exportSchemaVersion: 1,
    file: "owner-profile.json",
    kind: "owner-profile",
    mediaType: "application/json",
    readableSchemaVersions: [1],
  },
  {
    exportSchemaVersion: 1,
    file: "owner-voice.jsonl",
    kind: "owner-voice",
    mediaType: "application/x-ndjson",
    readableSchemaVersions: [1],
  },
  {
    exportSchemaVersion: 2,
    file: "owner-directives.json",
    kind: "owner-directives",
    mediaType: "application/json",
    readableSchemaVersions: [2],
  },
  {
    exportSchemaVersion: 1,
    file: "standing-asks.jsonl",
    kind: "standing-asks",
    mediaType: "application/x-ndjson",
    readableSchemaVersions: [1],
  },
  // v1 is the journal's own lines; v2 is one envelope per stored measurement (`../../profile/steerMeasurementTransfer.ts`).
  {
    exportSchemaVersion: STEER_MEASUREMENT_EXPORT_VERSION,
    file: "steer-kinds.jsonl",
    kind: "steer-verdicts",
    mediaType: "application/x-ndjson",
    readableSchemaVersions: [1, STEER_MEASUREMENT_EXPORT_VERSION],
  },
];

/**
 * Whether a part's store is append-only: a row there is never rewritten, so an imported row that differs from the
 * live one under the same identity can never take its place. Its difference is reported and asked about as an
 * alignment, and the live row stands. Every other part keeps one current row per identity, which an answered
 * conflict may replace. Exhaustive, so a new part must say which it is.
 *
 * @returns true for the knowledge register, its recall ledger and the steer measurements
 */
export function isAppendOnlyImportPart({ part }: { part: StoreExportPartKind }): boolean {
  switch (part) {
    case "memories":
    case "memory-recalls":
    case "steer-verdicts": {
      return true;
    }
    case "owner-profile":
    case "owner-voice":
    case "owner-directives":
    case "standing-asks": {
      return false;
    }
    default: {
      const unhandled: never = part;
      return unhandled;
    }
  }
}

/** The manifest's own file name, written last so a half-written export never carries one. */
export const STORE_EXPORT_MANIFEST_FILE = "manifest.json";

/** What the manifest's `kind` field says, so a stray `manifest.json` from anything else is refused. */
export const STORE_EXPORT_KIND = "slopweaver-store-export";

/** The manifest's own version. */
export const STORE_EXPORT_MANIFEST_VERSION = 1;
