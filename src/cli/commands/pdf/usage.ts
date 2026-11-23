/**
 * The `pdf` noun's usage lines — a LEAF, so the manifest can quote them without loading a PDF engine.
 *
 * `.claude/rules/area-cli.md` § "Metadata is eager, the run function is lazy": a manifest is imported on
 * every `slopweaver` invocation, and `./core.ts` reaches `../../../pdf/text.ts`, which imports
 * `pdfjs-dist`. Importing the usage strings from there would put a PDF engine on the load path of
 * `slopweaver --help`. This file imports only `../../../pdf/limits.ts`, which imports nothing.
 */
import { PDF_PAGES_DEFAULT } from "../../../pdf/limits.js";

/** The usage line for `pdf read`, shared by `--help` and the manifest so the two cannot drift. */
export const PDF_READ_USAGE =
  "usage: slopweaver pdf read <path> [--pages <n>] [--json]\n" +
  "  <path>          a local PDF — the one a provider's door already put on disk. A provider\n" +
  "                  reference is REFUSED: fetch the bytes through that provider's own verb first\n" +
  `  --pages <n>     read at most n pages (default ${String(PDF_PAGES_DEFAULT)})\n` +
  "  --json          emit one machine-readable document on stdout\n" +
  "  This is not OCR. A scanned or image-only PDF has no text layer, and this says so rather than\n" +
  "  answering an empty document.";

/** The usage line for `pdf check`. */
export const PDF_CHECK_USAGE =
  "usage: slopweaver pdf check [--json]\n" +
  "  --json          emit one machine-readable document on stdout\n" +
  "  Whether this host can build and read a PDF at all, and the two ceilings the reader holds. The\n" +
  "  cheap scope command the `attachments` capability row names; `pdf read` is the reading act.";

/** The `pdf` noun's verbs, in the order `--help` lists them. */
const PDF_VERBS: readonly string[] = ["read", "check"];

/** The noun's own usage, printed when no verb is named. */
export const PDF_USAGE = `usage: slopweaver pdf <${PDF_VERBS.join(" | ")}>`;
