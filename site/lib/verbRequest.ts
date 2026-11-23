/**
 * The `verb` tool's one argument, turned into the one argv element `slopweaver talk verb --request` takes.
 *
 * The model names a noun, a verb and literal arguments. None of them may reach the gateway's own argv as a
 * token, because an argument such as `--home` would then be the GATEWAY's flag rather than the target verb's.
 * So the request travels as ONE hex-encoded JSON value: nothing inside it can look like a flag to the gateway,
 * and the gateway decodes it and checks it against its closed list (`src/talk/modelReads.ts`) before anything
 * runs. This file only checks the shape, so a malformed call is refused in words the model can read.
 */

/** The most one encoded request weighs, in hex characters — the gateway's own ceiling. */
export const VERB_REQUEST_MAX_HEX = 16 * 1024;

/** The request encoded, or why it is not one. */
export type EncodedVerbRequest =
  { readonly kind: "hex"; readonly hex: string } | { readonly kind: "refused"; readonly why: string };

/**
 * Encode the model's `request` as the gateway takes it.
 *
 * @param value the `request` field exactly as the model sent it
 * @returns the lowercase hex of its JSON, or the refusal
 */
export function encodeVerbRequest({ value }: { value: unknown }): EncodedVerbRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "refused", why: "request must be an object with noun, verb and args" };
  }
  const fields = Object.fromEntries(Object.entries(value));
  const { noun, verb, args } = fields;
  if (typeof noun !== "string" || typeof verb !== "string") {
    return { kind: "refused", why: "request needs noun and verb as strings, e.g. github and read" };
  }
  if (!Array.isArray(args) || !args.every((arg): arg is string => typeof arg === "string")) {
    return { kind: "refused", why: "request.args must be a list of strings, empty when the verb takes none" };
  }
  const bytes = new TextEncoder().encode(JSON.stringify({ args, noun, verb }));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hex.length > VERB_REQUEST_MAX_HEX) {
    return { kind: "refused", why: `request is over ${String(VERB_REQUEST_MAX_HEX / 2)} bytes; ask for less` };
  }
  return { hex, kind: "hex" };
}
