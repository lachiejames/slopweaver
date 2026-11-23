/**
 * The connector-secret NAME allowlist — the parse door `secrets set` validates against.
 *
 * A secret is written to `$SLOPWEAVER_HOME/secrets/<name>`, so the name is a filename fragment an
 * attacker-shaped input must never smuggle a path traversal through. Anything not on the allowlist (an
 * unknown name, a `../` escape, a name with a slash) is a hard parse error, never a write.
 *
 * **The list itself is DERIVED, not written here.** {@link SecretName} and {@link SECRET_NAMES} come from
 * `src/secrets/registry.ts`, the register that also says what each credential is, what it reaches, whether
 * it was minted read-only, when it expires and which verb reads it. Restating the names here would be a
 * second hand-kept list, and two hand-kept lists agreeing with each other is not the same as either
 * agreeing with the store — which is exactly the state this file was in when the store grew five files
 * `secrets set` would have refused to rewrite.
 *
 * Pure: no I/O.
 */
import { isOneOf } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { type SecretsError, SecretsErrors } from "./errors.js";
import { SECRET_NAMES, type SecretName } from "./registry.js";

export { SECRET_NAMES, type SecretName };

/**
 * Validate a raw name against the allowlist. Rejects unknown names AND any traversal shape (a `/`, a `\`,
 * or a `.` segment) even if it somehow matched — defence in depth so the resolved path can only ever be a
 * direct child of `secrets/`. Pure.
 *
 * @param value the raw `<name>` argument
 * @returns the typed secret name, or an error listing the accepted names
 */
export function parseSecretName({ value }: { value: string }): Result<SecretName, SecretsError> {
  const trimmed = value.trim();
  if (/[/\\]/.test(trimmed) || trimmed.includes("..")) {
    return err(SecretsErrors.secretNameInvalid({ value }));
  }
  if (!isOneOf(trimmed, SECRET_NAMES)) {
    return err(SecretsErrors.secretNameUnknown({ expected: SECRET_NAMES, value }));
  }
  return ok(trimmed);
}
