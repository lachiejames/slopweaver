/**
 * Generate `claude-accounts/accounts.json` from the register, and notice when what is on disk — that file or
 * the `plans.json` projection — disagrees.
 *
 * ## Why a generated copy exists at all
 *
 * The store's `plan_register` row is the SOURCE. The Claude accounts file stays behind it as a projection so
 * that a seat running an older checkout — a worktree that has not pulled this change — keeps reading a file
 * in exactly the shape it already parses. The projection is therefore a bare ARRAY of Claude rows with the
 * `provider` discriminator removed: wrapping it in a metadata object, or adding a generated-by comment,
 * would break the compatibility it exists to buy. The DO-NOT-HAND-EDIT declaration lives here and in canon
 * instead, because JSON cannot carry it.
 *
 * ## Divergence is reported, never silently healed
 *
 * An older checkout's writer can still edit the projection, and it never touches the store row, so its change is
 * DIVERGENCE rather than a source update. A read says so ({@link projectionDivergence}); only the named
 * `slopweaver plans validate --repair-projection` regenerates. Healing on read would silently discard a
 * pause somebody genuinely recorded, and healing on every write would make the disagreement unfindable.
 *
 * Pure: rows in, rows out. The file edge is `store.ts`.
 */
import { stableStringify } from "#lib/stableStringify.js";

import type { PlanDiagnostic, PlanRegisterDocument } from "./types.js";

/**
 * The Claude accounts file the register currently implies.
 *
 * Row order and every unrelated raw field are preserved; only the `provider` discriminator is dropped,
 * because the legacy shape has no such key and an older parser would report it as unknown configuration.
 *
 * @param document the register document, raw rows and all
 * @returns the bare array an older `parseClaudeAccounts` accepts
 */
export function projectClaudeRows({
  document,
}: {
  document: PlanRegisterDocument;
}): readonly Readonly<Record<string, unknown>>[] {
  return document.rows
    .filter((row) => row["provider"] === "claude")
    .map((row) => Object.fromEntries(Object.entries(row).filter(([name]) => name !== "provider")));
}

/**
 * Whether what is on disk at the projection path is still what the register implies.
 *
 * The comparison is over the SERIALISED rows rather than a typed reading, because the thing a divergence
 * check has to catch is exactly the field a typed reading drops. It serialises with sorted keys, because
 * Postgres `jsonb` stores an object's keys in its own order: a file written before the import, or by hand
 * with the same content, must not read as diverged from a row whose keys only came back reordered.
 *
 * @param document the register document the projection should have been generated from
 * @param onDisk the decoded contents of the projection file, as read
 * @returns a `PROJECTION_DIVERGED` diagnostic, or undefined when the two agree
 */
export function projectionDivergence({
  document,
  onDisk,
}: {
  document: PlanRegisterDocument;
  onDisk: unknown;
}): PlanDiagnostic | undefined {
  const expected = stableStringify({ value: projectClaudeRows({ document }) });
  if (stableStringify({ value: onDisk }) === expected) {
    return undefined;
  }
  return {
    code: "PROJECTION_DIVERGED",
    message:
      `the generated Claude accounts file no longer matches the plan register — an older checkout's writer ` +
      `edits that file directly, and its change is divergence rather than a register update. The register ` +
      `is authoritative; \`slopweaver plans validate --repair-projection\` regenerates the copy`,
  };
}

/**
 * Whether the `plans.json` projection on disk is still the store row's document, whole.
 *
 * Compared serialised, for the reason {@link projectionDivergence} gives. A mismatch is an older checkout's
 * writer editing the file it still believes is the register, or a regeneration that failed after a commit;
 * either way the ROW is authoritative and the file is never imported back over it.
 *
 * @param document the register document the store holds
 * @param onDisk the decoded contents of `plans.json`, as read; undefined when it could not be read
 * @returns a `PROJECTION_DIVERGED` diagnostic, or undefined when the two agree
 */
export function registerProjectionDivergence({
  document,
  onDisk,
}: {
  document: PlanRegisterDocument;
  onDisk: unknown;
}): PlanDiagnostic | undefined {
  if (stableStringify({ value: onDisk }) === stableStringify({ value: document })) {
    return undefined;
  }
  return {
    code: "PROJECTION_DIVERGED",
    message:
      `\`plans.json\` no longer matches the plan register the store holds — an older checkout's writer edits ` +
      `that file directly, or a regeneration failed after a commit. The store row is authoritative and the ` +
      `file is never read back over it; \`slopweaver plans validate --repair-projection\` regenerates the copy`,
  };
}
