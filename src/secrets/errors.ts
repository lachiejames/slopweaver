/**
 * The typed failures `src/secrets` authors itself — a secret name that is not one, a captured value that
 * cannot be written as a single-line token or does not match its row's declared shape, a write that did not land, a store directory that could not be
 * listed, and a Google grant file that is corrupt or could not be written or deleted.
 *
 * A union of its own per `.claude/rules/error-handling.md`. Every variant is one sentence, so a caller
 * displays `message` and branches on `code`; a caller whose contract is `readonly string[]` maps
 * `[error.message]` once at its boundary. No variant ever carries a secret VALUE — a name, a path and a
 * cause are all a refusal needs.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "../lib/errorMessage.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure about one door's Google grant, named as that door names itself. */
interface GrantFailure<C extends string> extends Plain<C> {
  readonly productName: string;
}

/** Every failure `src/secrets` authors. */
export type SecretsError =
  | Plain<"EMPTY_VALUE">
  | Plain<"MULTILINE_VALUE">
  | (Plain<"VALUE_SHAPE_MISMATCH"> & { readonly name: string })
  | (Plain<"SECRET_WRITE_FAILED"> & { readonly name: string; readonly cause: unknown })
  | (Plain<"SECRET_EXISTS"> & { readonly name: string; readonly path: string })
  | (Plain<"SECRET_NAME_INVALID"> & { readonly value: string })
  | (Plain<"SECRET_NAME_UNKNOWN"> & { readonly value: string; readonly expected: readonly string[] })
  | (Plain<"SECRETS_STORE_UNREADABLE"> & { readonly path: string; readonly cause: unknown })
  | (GrantFailure<"GRANT_JSON_INVALID"> & { readonly cause: unknown })
  | (GrantFailure<"GRANT_SHAPE_INVALID"> & { readonly connectVerb: string })
  | (GrantFailure<"GRANT_FILE_FAILED"> & { readonly action: string; readonly path: string; readonly cause: unknown });

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const SecretsErrors = {
  emptyValue: (): SecretsError => ({ code: "EMPTY_VALUE", message: "empty secret value — nothing to write" }),
  grantFileFailed: ({
    action,
    cause,
    path,
    productName,
  }: {
    action: string;
    cause: unknown;
    path: string;
    productName: string;
  }): SecretsError => ({
    action,
    cause,
    code: "GRANT_FILE_FAILED",
    message: `could not ${action} the ${productName} grant at ${path}: ${errorMessage({ error: cause })}`,
    path,
    productName,
  }),
  // The parser's own message is kept on `cause` and never put in `message`: V8 quotes the input it choked
  // on (`Unexpected token 'r', "refresh_to"... is not valid JSON`), and the input here is a credential file.
  // Repro: node -e 'try{JSON.parse("refresh_token_value")}catch(e){console.log(e.message)}'
  grantJsonInvalid: ({ cause, productName }: { cause: unknown; productName: string }): SecretsError => ({
    cause,
    code: "GRANT_JSON_INVALID",
    message: `the stored ${productName} grant is not valid JSON (the parser's detail is withheld: it quotes the file)`,
    productName,
  }),
  grantShapeInvalid: ({ connectVerb, productName }: { connectVerb: string; productName: string }): SecretsError => ({
    code: "GRANT_SHAPE_INVALID",
    connectVerb,
    message: `the stored ${productName} grant is missing account, scopes or refreshToken, or holds a field of the wrong shape — re-run \`${connectVerb}\``,
    productName,
  }),
  multilineValue: (): SecretsError => ({
    code: "MULTILINE_VALUE",
    message: "secret value spans multiple lines — expected a single-line token",
  }),
  secretNameInvalid: ({ value }: { value: string }): SecretsError => ({
    code: "SECRET_NAME_INVALID",
    message: `invalid secret name (no path separators): ${value}`,
    value,
  }),
  secretNameUnknown: ({ expected, value }: { expected: readonly string[]; value: string }): SecretsError => ({
    code: "SECRET_NAME_UNKNOWN",
    expected,
    message: `unknown secret name: ${value} (expected ${expected.join(" | ")})`,
    value,
  }),
  storeUnreadable: ({ cause, path }: { cause: unknown; path: string }): SecretsError => ({
    cause,
    code: "SECRETS_STORE_UNREADABLE",
    message: `could not list the secrets store at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  secretExists: ({ name, path }: { name: string; path: string }): SecretsError => ({
    code: "SECRET_EXISTS",
    message: `secret ${name} already exists at ${path}, and creating it never replaces one`,
    name,
    path,
  }),
  secretWriteFailed: ({ cause, name }: { cause: unknown; name: string }): SecretsError => ({
    cause,
    code: "SECRET_WRITE_FAILED",
    message: `could not write secret ${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
    name,
  }),
  valueShapeMismatch: ({ name, describe }: { name: string; describe: string }): SecretsError => ({
    code: "VALUE_SHAPE_MISMATCH",
    message:
      `${name} must be ${describe}, and the value given is not — a link pasted from a browser or chat often ` +
      "arrives wrapped as `http://…/`; paste the bare value",
    name,
  }),
} as const;
