/**
 * A store export's manifest: what it promises about each part, checked before a byte of any part is believed.
 *
 * Strict in every direction on purpose. Every part kind appears exactly once and at exactly the file name the
 * registry fixes, so a manifest cannot point a reader at a nested path, a sibling directory or a second copy
 * of a part: a path is never resolved, only compared with the one name it is allowed to be. Pure.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { type StoreTransferError, StoreTransferErrors } from "./errors.js";
import {
  STORE_EXPORT_KIND,
  STORE_EXPORT_MANIFEST_VERSION,
  STORE_EXPORT_PARTS,
  type StoreExportPartKind,
} from "./parts.js";

/** What one part measured as, written into the manifest and compared on read. */
export interface StoreExportPartEntry {
  readonly kind: StoreExportPartKind;
  readonly path: string;
  readonly mediaType: "application/json" | "application/x-ndjson";
  readonly schemaVersion: number;
  readonly rows: number;
  readonly bytes: number;
  readonly sha256: string;
}

/** A whole manifest. */
export interface StoreExportManifest {
  readonly schemaVersion: typeof STORE_EXPORT_MANIFEST_VERSION;
  readonly kind: typeof STORE_EXPORT_KIND;
  readonly createdAtIso: string;
  readonly producer: { readonly name: "slopweaver"; readonly version: string };
  readonly parts: readonly StoreExportPartEntry[];
}

const PART_KINDS = STORE_EXPORT_PARTS.map((spec) => spec.kind);

const partSchema = z.strictObject({
  bytes: z.number().int().nonnegative(),
  kind: z.string().refine((kind) => PART_KINDS.some((known) => known === kind), { message: "not a part kind" }),
  mediaType: z.enum(["application/json", "application/x-ndjson"]),
  path: z.string().min(1),
  rows: z.number().int().nonnegative(),
  schemaVersion: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

const manifestSchema = z.strictObject({
  createdAtIso: z.iso.datetime({ offset: true }),
  kind: z.literal(STORE_EXPORT_KIND),
  parts: z.array(partSchema),
  producer: z.strictObject({ name: z.literal("slopweaver"), version: z.string().min(1) }),
  schemaVersion: z.literal(STORE_EXPORT_MANIFEST_VERSION),
});

/**
 * Whether the parts listed are exactly the registry's, each once, each at its own name, media type and version.
 *
 * @param parts the entries a manifest lists
 * @returns the entries in registry order, or the first way the list departs from the registry
 */
function partsMatchRegistry({
  parts,
}: {
  parts: readonly z.infer<typeof partSchema>[];
}): Result<readonly StoreExportPartEntry[], StoreTransferError> {
  const ordered: StoreExportPartEntry[] = [];
  for (const spec of STORE_EXPORT_PARTS) {
    const matching = parts.filter((part) => part.kind === spec.kind);
    if (matching.length !== 1) {
      const why = `part ${spec.kind} is listed ${String(matching.length)} times, not once`;
      return err(StoreTransferErrors.manifestInvalid({ why }));
    }
    const part = matching[0]!;
    if (part.path !== spec.file) {
      const why = `part ${spec.kind} names ${JSON.stringify(part.path)}; it is only ever ${spec.file}`;
      return err(StoreTransferErrors.manifestInvalid({ why }));
    }
    if (part.mediaType !== spec.mediaType || !spec.readableSchemaVersions.includes(part.schemaVersion)) {
      const readable = spec.readableSchemaVersions.map((version) => `v${String(version)}`).join(" or ");
      const why = `part ${spec.kind} is ${part.mediaType} v${String(part.schemaVersion)}; this build reads ${spec.mediaType} ${readable}`;
      return err(StoreTransferErrors.manifestInvalid({ why }));
    }
    ordered.push({ ...part, kind: spec.kind });
  }
  if (parts.length !== STORE_EXPORT_PARTS.length) {
    const why = `${String(parts.length)} parts listed; a store export carries ${String(STORE_EXPORT_PARTS.length)}`;
    return err(StoreTransferErrors.manifestInvalid({ why }));
  }
  return ok(ordered);
}

/**
 * Read a parsed `manifest.json` as a store export manifest, its parts in registry order.
 *
 * @param value the manifest's parsed JSON
 * @returns the manifest, or why it is not one this build reads
 */
export function parseStoreExportManifest({
  value,
}: {
  value: unknown;
}): Result<StoreExportManifest, StoreTransferError> {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) {
    const why = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    return err(StoreTransferErrors.manifestInvalid({ why }));
  }
  return partsMatchRegistry({ parts: parsed.data.parts }).map((parts): StoreExportManifest => ({
    createdAtIso: parsed.data.createdAtIso,
    kind: parsed.data.kind,
    parts,
    producer: parsed.data.producer,
    schemaVersion: parsed.data.schemaVersion,
  }));
}

/**
 * Compare what a part measured as on read with what its manifest entry promised.
 *
 * @param entry the manifest's promise
 * @param measured what reading the file found
 * @returns `true`, or the first field that differs — bytes before the hash, so a truncation names itself
 */
export function checkPartAgainstEntry({
  entry,
  measured,
}: {
  entry: StoreExportPartEntry;
  measured: { readonly bytes: number; readonly sha256: string; readonly rows: number };
}): Result<true, StoreTransferError> {
  if (measured.bytes !== entry.bytes) {
    const [expected, actual] = [String(entry.bytes), String(measured.bytes)];
    return err(StoreTransferErrors.partMismatch({ actual, expected, field: "bytes", part: entry.kind }));
  }
  if (measured.sha256 !== entry.sha256) {
    return err(
      StoreTransferErrors.partMismatch({
        actual: measured.sha256,
        expected: entry.sha256,
        field: "sha256",
        part: entry.kind,
      }),
    );
  }
  if (measured.rows !== entry.rows) {
    const [expected, actual] = [String(entry.rows), String(measured.rows)];
    return err(StoreTransferErrors.partMismatch({ actual, expected, field: "rows", part: entry.kind }));
  }
  return ok(true);
}
