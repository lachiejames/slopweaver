/**
 * What `talk verb` ACCEPTS: one `--request`, the voice's `{ noun, verb, args }` as hex-encoded JSON.
 *
 * Hex rather than base64url because Node's `parseArgs` will not take a value that begins with a hyphen, and
 * base64url's alphabet has one. Encoded at all because the console builds argv from a closed template: the
 * model's request crosses as ONE opaque token, so nothing it says can become a flag of this gateway.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { ModelReadRequest } from "../../../talk/modelReads.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, stringOf } from "./flagValues.js";

/** The flags `talk verb` accepts. */
const VERB_FLAGS = { boolean: ["json"], string: ["request"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_VERB_FLAG_NAMES: readonly string[] = flagNames({ spec: VERB_FLAGS });

/**
 * The longest `--request`, in hex characters: an 8 KiB request, the console's own body cap.
 *
 * @internal exported for the codec's own test
 */
export const MAX_REQUEST_HEX_CHARS = 16 * 1024;

/** A parsed `talk verb` invocation. */
export interface VerbArgs {
  readonly request: ModelReadRequest;
  readonly json: boolean;
}

/** Why a `--request` could not be taken. */
interface VerbRequestError {
  readonly code: "REQUEST_MISSING" | "REQUEST_TOO_LONG" | "REQUEST_NOT_HEX" | "REQUEST_NOT_JSON" | "REQUEST_MISSHAPEN";
  readonly message: string;
}

/** The {@link VerbRequestError} factory. */
const VerbRequestErrors = {
  misshapen: ({ why }: { why: string }): VerbRequestError => ({
    code: "REQUEST_MISSHAPEN",
    message: `talk verb --request ${why}`,
  }),
  missing: (): VerbRequestError => ({
    code: "REQUEST_MISSING",
    message: "talk verb needs --request <hex-encoded JSON {noun, verb, args}>",
  }),
  notHex: (): VerbRequestError => ({ code: "REQUEST_NOT_HEX", message: "talk verb --request is not lowercase hex" }),
  notJson: (): VerbRequestError => ({
    code: "REQUEST_NOT_JSON",
    message: "talk verb --request does not decode to JSON",
  }),
  tooLong: (): VerbRequestError => ({
    code: "REQUEST_TOO_LONG",
    message: `talk verb --request is at most ${String(MAX_REQUEST_HEX_CHARS)} hex characters`,
  }),
} as const;

/**
 * Parse a `talk verb` invocation.
 *
 * @param rest the argv after the verb
 * @returns the decoded request, or every usage problem found
 */
export function parseVerbArgs({ rest }: { rest: readonly string[] }): Result<VerbArgs> {
  const parsed = parseFlags({ args: rest, spec: VERB_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const request = decodeRequest({ encoded: stringOf({ value: values["request"] }) });
  if (request.isErr()) {
    return err([request.error.message]);
  }
  return ok({ json: values["json"] === true, request: request.value });
}

/**
 * Encode a request the way `--request` takes it — the console's half, kept here so both ends are one shape.
 *
 * @internal the console encodes in `site/lib/verbRequest.ts`; this is the gateway-side twin its tests use
 * @param request the noun, verb and arguments
 * @returns the hex token
 */
export function encodeRequest({ request }: { request: ModelReadRequest }): string {
  return Buffer.from(JSON.stringify(request), "utf8").toString("hex");
}

/** Decode and shape-check one `--request` token. */
function decodeRequest({ encoded }: { encoded: string | undefined }): Result<ModelReadRequest, VerbRequestError> {
  if (encoded === undefined) {
    return err(VerbRequestErrors.missing());
  }
  if (encoded.length > MAX_REQUEST_HEX_CHARS) {
    return err(VerbRequestErrors.tooLong());
  }
  if (!/^(?:[0-9a-f]{2})*$/u.test(encoded)) {
    return err(VerbRequestErrors.notHex());
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "hex").toString("utf8"));
  } catch {
    return err(VerbRequestErrors.notJson());
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return err(VerbRequestErrors.misshapen({ why: "is not an object" }));
  }
  const noun: unknown = Reflect.get(value, "noun");
  const verb: unknown = Reflect.get(value, "verb");
  const args: unknown = Reflect.get(value, "args");
  if (typeof noun !== "string" || typeof verb !== "string") {
    return err(VerbRequestErrors.misshapen({ why: "needs a string noun and verb" }));
  }
  if (args === undefined) {
    return ok({ args: [], noun, verb });
  }
  if (!Array.isArray(args) || !args.every((arg): arg is string => typeof arg === "string")) {
    return err(VerbRequestErrors.misshapen({ why: "args must be a list of strings" }));
  }
  return ok({ args, noun, verb });
}
