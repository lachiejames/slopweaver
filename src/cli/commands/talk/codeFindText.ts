/**
 * `talk code find`'s literal, read from whichever of its two spellings carried it. Split from `./args.ts`, which sits
 * at its size ceiling.
 */
import { err, ok, type Result } from "../../../lib/result.js";

/** Why `talk code find`'s two text flags cannot be read as one literal. */
export type CodeFindTextError =
  | { readonly code: "TEXT_FLAGS_BOTH"; readonly message: string }
  | { readonly code: "TEXT_HEX_MALFORMED"; readonly message: string }
  | { readonly code: "TEXT_HEX_NOT_UTF8"; readonly message: string };

/** The one way each {@link CodeFindTextError} is built. */
export const CodeFindTextErrors = {
  both: (): CodeFindTextError => ({
    code: "TEXT_FLAGS_BOTH",
    message: "talk code find takes --text or --text-hex, not both",
  }),
  malformed: (): CodeFindTextError => ({
    code: "TEXT_HEX_MALFORMED",
    message: "--text-hex is not lowercase hex bytes",
  }),
  notUtf8: (): CodeFindTextError => ({ code: "TEXT_HEX_NOT_UTF8", message: "--text-hex does not decode as UTF-8" }),
} as const;

/**
 * Read `talk code find`'s literal from whichever of its two spellings carried it.
 *
 * `--text-hex` is the console voice's spelling (`site/lib/slots.ts`, shape `hexText`): ONE hex argv element no
 * parser can read as a flag, so the voice may search for `--json` or `-n` itself. Measured: two `code_find` asks on one call were refused for starting with a hyphen while the owner waited.
 *
 * @param plain the `--text` value
 * @param hex the `--text-hex` value, UTF-8 bytes as lowercase hex
 * @returns the literal, `undefined` when neither was given, or why the pair is unusable
 */
export function codeFindText({
  plain,
  hex,
}: {
  plain: string | undefined;
  hex: string | undefined;
}): Result<string | undefined, CodeFindTextError> {
  if (hex === undefined) {
    return ok(plain);
  }
  if (plain !== undefined) {
    return err(CodeFindTextErrors.both());
  }
  if (hex.length === 0 || !/^(?:[0-9a-f]{2})+$/u.test(hex)) {
    return err(CodeFindTextErrors.malformed());
  }
  const bytes = Buffer.from(hex, "hex");
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    return err(CodeFindTextErrors.notUtf8());
  }
  return ok(text);
}
