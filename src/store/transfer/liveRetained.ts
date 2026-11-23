/**
 * The live store's side of an import's comparison: the contents an export of it WOULD hold, decoded by the
 * very decoders that read the export, so both sides are kept and fingerprinted by one code path and "the
 * same row" cannot mean two things. Pure.
 */
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import type { StoreExportContents } from "./bundlePublish.js";
import { partDecoder } from "./decode.js";
import { type StoreTransferError, StoreTransferErrors } from "./errors.js";
import { STORE_EXPORT_PARTS, type StoreExportPartKind } from "./parts.js";
import type { RetainedEntry } from "./retained.js";

/** The lines a part's file would hold for these contents, exactly as an export writes them. */
function partLines({
  contents,
  kind,
}: {
  contents: StoreExportContents;
  kind: StoreExportPartKind;
}): readonly string[] {
  switch (kind) {
    case "memories":
      return contents.memoryLines;
    case "memory-recalls":
      return contents.recallLines;
    case "owner-profile":
      return [safeJsonStringify({ label: "live owner profile", value: contents.owner })];
    case "owner-voice":
      return contents.voiceLines;
    case "owner-directives":
      return [safeJsonStringify({ label: "live owner directives", value: contents.directives })];
    case "standing-asks":
      return contents.standingAskLines;
    case "steer-verdicts":
      return contents.steerMeasurementLines;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/**
 * Every part of the live store as the entries an import compares against.
 *
 * @param contents the live store read at one moment, shaped as an export of it would be
 * @returns each part's entries, or the first part the live store holds that its own decoder refuses
 */
export function liveRetained({
  contents,
}: {
  contents: StoreExportContents;
}): Result<ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]>, StoreTransferError> {
  const retained = new Map<StoreExportPartKind, readonly RetainedEntry[]>();
  for (const spec of STORE_EXPORT_PARTS) {
    const decoder = partDecoder({ kind: spec.kind, schemaVersion: spec.exportSchemaVersion });
    const lines = partLines({ contents, kind: spec.kind });
    for (const [at, text] of lines.entries()) {
      const fed = decoder.line({ number: at + 1, text });
      if (fed.isErr()) {
        return err(StoreTransferErrors.sourceUnreadable({ cause: fed.error.message, what: `the live ${spec.kind}` }));
      }
    }
    const finished = decoder.finish();
    if (finished.isErr()) {
      return err(
        StoreTransferErrors.sourceUnreadable({ cause: finished.error.message, what: `the live ${spec.kind}` }),
      );
    }
    retained.set(spec.kind, finished.value.retained);
  }
  return ok(retained);
}
