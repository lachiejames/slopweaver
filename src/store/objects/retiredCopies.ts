/**
 * Removing the retired copies of the Storage address and key a home may still hold from before the key was
 * read off the running stack (the rule: read the stack, store nothing).
 *
 * Removal loses nothing: each file held a copy of a value the running stack supplies, and nothing reads it.
 * `storeUrlSelection` (`../config.ts`) runs it, so every path that selects the store does. The names are DERIVED from the credential register's retired
 * rows for the local store's gateway rather than restated, so the register stays their one declaration.
 */
import { rmSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";

import { CREDENTIALS } from "../../secrets/registry.js";
import { secretFilePath } from "../../stateHome.js";

import { ObjectStoreErrors, type ObjectsRetiredCopyUnremovedError } from "./errors.js";

/** The register's platform for the local store's API gateway, which the retired Storage rows carry. */
const STORE_GATEWAY_PLATFORM = "Supabase (the local store's API gateway)";

/**
 * The retired secret names that held a copy of the Storage address or key.
 *
 * @returns the names, in register order
 */
export function retiredStorageSecretNames(): readonly string[] {
  return CREDENTIALS.flatMap((entry) =>
    entry.lifecycle === "retired" && entry.platform === STORE_GATEWAY_PLATFORM ? [entry.name] : [],
  );
}

/**
 * Remove every retired Storage copy under one home. An absent file is not an error.
 *
 * @param home the Slopweaver home the store was selected under; the ambient one when the caller named none,
 *   exactly as the store's own selection resolves it
 * @returns nothing on success, or the first copy that could not be removed
 */
export function removeRetiredStorageCopies({
  home,
}: {
  home?: string;
} = {}): Result<void, ObjectsRetiredCopyUnremovedError> {
  for (const name of retiredStorageSecretNames()) {
    const path = home === undefined ? secretFilePath({ name }) : secretFilePath({ home, name });
    try {
      rmSync(path, { force: true });
    } catch {
      return err(ObjectStoreErrors.retiredCopyUnremoved({ path }));
    }
  }
  return ok(undefined);
}
