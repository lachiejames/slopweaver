/**
 * The registry's transitions — pure, so every rule `slopweaver protect` enforces is a unit test.
 *
 * - **Adding** a new path, or TIGHTENING one (`read-only` → `no-access`), narrows what a session may do, and needs
 *   nobody's leave.
 * - **Widening** one (`no-access` → `read-only`) and **removing** one hand a session access the owner took away, so
 *   both need the `protect-remove` hatch open (`../hatch/toolAdmissionHatches.ts`). A session that opens it is
 *   making the owner's call, which is what the hatch's exceptions say only the owner's own relayed word licenses.
 * - Re-adding a path with the SAME mode changes nothing and says so; its reason and instant are kept.
 *
 * A path is matched EXACTLY (folded), never by containment: removing a parent never removes a child entry, and
 * `remove` of a path the registry does not hold is an error rather than a silent success.
 */
import { resolve } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import type { ProtectedPath, ProtectedPathRegistry, ProtectionMode } from "./registry.js";

/** One change a caller asks of the registry. */
export type ProtectedPathEdit =
  | { readonly kind: "add"; readonly path: string; readonly mode: ProtectionMode; readonly why: string }
  | { readonly kind: "remove"; readonly path: string };

/** The add was a no-op, a new entry, a tightening, or a widening. */
export type ProtectedPathChange = "unchanged" | "added" | "tightened" | "widened" | "removed";

/** A widening or removal was asked with the hatch closed. */
interface WideningRefusedError {
  readonly code: "WIDENING_REFUSED";
  readonly message: string;
  readonly path: string;
}

/** A remove named a path the registry does not hold. */
interface NotProtectedError {
  readonly code: "NOT_PROTECTED";
  readonly message: string;
  readonly path: string;
}

/** Why an edit was not applied. */
export type ProtectedPathEditError = WideningRefusedError | NotProtectedError;

/** The factory for {@link ProtectedPathEditError}. */
const ProtectedPathEditErrors = {
  notProtected: ({ path }: { path: string }): NotProtectedError => ({
    code: "NOT_PROTECTED",
    message: `${path} is not in the protected-path registry — \`slopweaver protect list\` shows what is`,
    path,
  }),
  wideningRefused: ({ path, what }: { path: string; what: string }): WideningRefusedError => ({
    code: "WIDENING_REFUSED",
    message: `${what} ${path} would give sessions access the owner took away`,
    path,
  }),
} as const;

/** Whether two registry paths are the same path, folded as APFS folds them. */
function samePath({ a, b }: { a: string; b: string }): boolean {
  return resolve(a).normalize("NFC").toLowerCase() === resolve(b).normalize("NFC").toLowerCase();
}

/** Remove the entry a `remove` names — an error when none is held, or when the widening hatch is closed. */
function removeEntry({
  existing,
  others,
  path,
  wideningHatchOpen,
}: {
  existing: ProtectedPath | undefined;
  others: readonly ProtectedPath[];
  path: string;
  wideningHatchOpen: boolean;
}): Result<{ registry: ProtectedPathRegistry; change: ProtectedPathChange }, ProtectedPathEditError> {
  if (existing === undefined) {
    return err(ProtectedPathEditErrors.notProtected({ path }));
  }
  if (!wideningHatchOpen) {
    return err(ProtectedPathEditErrors.wideningRefused({ path: existing.path, what: "removing" }));
  }
  return ok({ change: "removed", registry: { paths: others, schemaVersion: 1 } });
}

/**
 * Apply one edit.
 *
 * @param registry the registry as read
 * @param edit what to change — a path already absolute and normalised
 * @param nowIso the instant a new entry is stamped with
 * @param wideningHatchOpen whether `protect-remove` is open, which a widening or a removal needs
 * @returns the new registry and what changed, or why it was refused
 */
export function editProtectedPaths({
  registry,
  edit,
  nowIso,
  wideningHatchOpen,
}: {
  registry: ProtectedPathRegistry;
  edit: ProtectedPathEdit;
  nowIso: string;
  wideningHatchOpen: boolean;
}): Result<{ registry: ProtectedPathRegistry; change: ProtectedPathChange }, ProtectedPathEditError> {
  const existing = registry.paths.find((entry) => samePath({ a: entry.path, b: edit.path }));
  const others = registry.paths.filter((entry) => entry !== existing);
  if (edit.kind === "remove") {
    return removeEntry({ existing, others, path: edit.path, wideningHatchOpen });
  }
  if (existing !== undefined && existing.mode === edit.mode) {
    return ok({ change: "unchanged", registry });
  }
  const widening = existing?.mode === "no-access" && edit.mode === "read-only";
  if (widening && !wideningHatchOpen) {
    return err(ProtectedPathEditErrors.wideningRefused({ path: existing.path, what: "making read-only" }));
  }
  const entry: ProtectedPath = { addedIso: nowIso, mode: edit.mode, path: edit.path, why: edit.why };
  let change: ProtectedPathChange = "added";
  if (existing !== undefined) {
    change = widening ? "widened" : "tightened";
  }
  return ok({ change, registry: { paths: [...others, entry], schemaVersion: 1 } });
}
