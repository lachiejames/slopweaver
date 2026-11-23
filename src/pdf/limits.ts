/**
 * The two ceilings a PDF read holds, and the line a reader prints for a document with no text layer.
 *
 * Held apart from `./text.ts` because that module imports `pdfjs-dist`, and the CLI manifests have to be
 * able to quote a usage line without dragging a PDF engine onto every `slopweaver --help`
 * (`.claude/rules/area-cli.md` § "Metadata is eager, the run function is lazy"). Nothing here imports
 * anything at all.
 */

/**
 * How large a document the reader will hold in memory.
 *
 * The same number `../atlas/vanta/documentDownload.ts` measured for the same subject rather than a second
 * one invented here: this organisation's largest stored policy is under 1 MiB, so the cap bounds a
 * pathological input without being a limit any real document approaches. Reproduce that measurement with
 * `slopweaver atlas vanta read --kind policy-document --json | jq '[.entities[].channels["manage-api"].source.artifacts[].byteLength] | max'`.
 */
export const PDF_BYTES_MAX = 64 * 1024 * 1024;

/**
 * How many pages one extraction reads before it stops.
 *
 * A whole 400-page document concatenated into one string is the data-sized payload
 * `.claude/rules/typescript-patterns.md` bans, and the fix is not extracting it rather than guarding the
 * serialisation afterwards. Past this, an extraction's `pagesRead` is below its `pages` and says so; a
 * caller that genuinely wants the rest raises it deliberately.
 */
export const PDF_PAGES_DEFAULT = 50;

/**
 * What a reader prints for a document whose pages carry no text layer at all.
 *
 * A scanned report, a signed policy photographed into a page, an invoice exported as an image — every one
 * is a valid PDF that extracts to `""`. Rendered as an empty body that is indistinguishable from a blank
 * page, so every renderer prints this INSTEAD. Nothing in this repository does OCR; it says it could not
 * read the pixels rather than guessing at them.
 */
export const GLYPHLESS_LINE =
  "no extractable text — this looks like a scanned or image-only PDF, and nothing here read the pixels";
