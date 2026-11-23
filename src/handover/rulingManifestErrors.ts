/**
 * The ways `./rulingManifest.ts` refuses a manifest, each rejecting the WHOLE file rather than one entry.
 *
 * Its own small union per `.claude/rules/error-handling.md`, scoped to the manifest parser: text that is not
 * JSON, a key written twice (which `JSON.parse` would have resolved silently), a shape the schema refuses,
 * and two entries naming the same source answer. Every variant carries `issues`, one line per problem,
 * because the audit that reads the manifest reports each one — a manifest can be wrong in several places at
 * once and the reviewer fixing it wants all of them.
 *
 * Pure: every factory takes what it names.
 */

/** The text is not JSON; `detail` is the JSON reader's own reason. */
export interface RulingManifestNotJsonError {
  readonly code: "NOT_JSON";
  readonly message: string;
  readonly detail: string;
  readonly issues: readonly string[];
}

/** A key appears twice in one object, so `JSON.parse` kept one value and dropped the other unannounced. */
export interface RulingManifestKeysRepeatedError {
  readonly code: "KEYS_REPEATED";
  readonly message: string;
  readonly keys: readonly string[];
  readonly issues: readonly string[];
}

/** The JSON is not the manifest shape; `issues` is one line per schema problem, pathed. */
export interface RulingManifestSchemaInvalidError {
  readonly code: "SCHEMA_INVALID";
  readonly message: string;
  readonly issues: readonly string[];
}

/** Two entries name the same recorded answer; `issues` names each collision. */
export interface RulingManifestSourcesDuplicatedError {
  readonly code: "SOURCES_DUPLICATED";
  readonly message: string;
  readonly issues: readonly string[];
}

/** Every way a manifest is refused. */
export type RulingManifestError =
  | RulingManifestNotJsonError
  | RulingManifestKeysRepeatedError
  | RulingManifestSchemaInvalidError
  | RulingManifestSourcesDuplicatedError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const RulingManifestErrors = {
  keysRepeated: ({ keys }: { keys: readonly string[] }): RulingManifestKeysRepeatedError => {
    const issues = keys.map((key) => `the key "${key}" appears twice in one object, so one of its values is lost`);
    return { code: "KEYS_REPEATED", issues, keys, message: issues.join("; ") };
  },
  notJson: ({ detail }: { detail: string }): RulingManifestNotJsonError => {
    const message = `not JSON: ${detail}`;
    return { code: "NOT_JSON", detail, issues: [message], message };
  },
  schemaInvalid: ({ issues }: { issues: readonly string[] }): RulingManifestSchemaInvalidError => ({
    code: "SCHEMA_INVALID",
    issues,
    message: issues.join("; "),
  }),
  sourcesDuplicated: ({ issues }: { issues: readonly string[] }): RulingManifestSourcesDuplicatedError => ({
    code: "SOURCES_DUPLICATED",
    issues,
    message: issues.join("; "),
  }),
} as const;

/**
 * The lines a refused manifest reports, one per problem — the list the audit has always printed, never the
 * joined `message`.
 *
 * @param error the refusal
 * @returns one line per problem, byte for byte
 */
export function rulingManifestErrorLines({ error }: { error: RulingManifestError }): readonly string[] {
  return error.issues;
}
