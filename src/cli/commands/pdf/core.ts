/**
 * Pure argument handling and rendering for the `pdf` noun — parsing and the two report shapes.
 *
 * The usage lines sit in `./usage.ts` rather than here, so `../../manifests/pdf.ts` can quote them without
 * pulling this file's reach into `../../../pdf/text.ts` onto every invocation — `.claude/rules/area-cli.md`
 * § "Metadata is eager, the run function is lazy".
 *
 * ## What this verb is NOT, which is the whole of its scope
 *
 * It takes a LOCAL PATH and never a provider reference. Getting an attachment's bytes is the provider
 * door's job — `slack read-file`, `linear attach fetch`, `notion read --attachments`, the Vanta atlas —
 * and reading them is this one's. A `pdf read <slack file id>` would be a second door into Slack's read,
 * which AGENTS.md rule 3 exists to prevent, and it would duplicate the hardening
 * `../../../live/slack/download.ts` already carries.
 *
 * Every door in this program already ends at bytes on disk, so the split costs a caller nothing: Slack
 * reports a `localPath`, Notion writes into its digest store, and the Vanta atlas keeps
 * `artifacts/policy-document/<id>/source.pdf` beside the text it extracted.
 *
 * Pure: no filesystem, no clock, no network. The shell in `./run.ts` reads the file and calls
 * `../../../pdf/text.ts`; nothing here does either.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { GLYPHLESS_LINE, PDF_BYTES_MAX, PDF_PAGES_DEFAULT } from "../../../pdf/limits.js";
import type { PdfExtraction } from "../../../pdf/text.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** `pdf read`'s boolean flags, named once so both the spec and the name list are built from them. */
const PDF_READ_BOOLEANS: readonly string[] = ["json"];

/** `pdf read`'s value-taking flags. */
const PDF_READ_STRINGS: readonly string[] = ["pages"];

/** Every flag `pdf read` accepts, as the parser's own spec. */
const PDF_READ_FLAGS: FlagSpec = { boolean: PDF_READ_BOOLEANS, string: PDF_READ_STRINGS };

/** Every flag NAME, built from the same two lists the spec is, so the two cannot drift. */
export const PDF_READ_FLAG_NAMES: readonly string[] = [...PDF_READ_BOOLEANS, ...PDF_READ_STRINGS]
  .map((name) => `--${name}`)
  .toSorted();

/** `pdf check`'s boolean flags. It takes no value-taking flag at all. */
const PDF_CHECK_BOOLEANS: readonly string[] = ["json"];

/** Every flag `pdf check` accepts. */
const PDF_CHECK_FLAGS: FlagSpec = { boolean: PDF_CHECK_BOOLEANS, string: [] };

/** Every `pdf check` flag NAME, built from the same list its spec is. */
export const PDF_CHECK_FLAG_NAMES: readonly string[] = PDF_CHECK_BOOLEANS.map((name) => `--${name}`).toSorted();

/** A parsed `pdf read` invocation. */
export interface PdfReadOptions {
  readonly path: string;
  readonly maxPages: number;
  readonly json: boolean;
}

/**
 * Whether a positional is a provider reference rather than a path this verb can open.
 *
 * Deliberately refused BY NAME instead of failing on `ENOENT`: a session that types a Slack file id here
 * has made a routing mistake, and "no such file or directory: <file-id>" tells it nothing about which verb
 * to reach for instead.
 *
 * @param candidate the positional exactly as typed
 * @returns the verb to use instead, or undefined when the candidate is an ordinary path
 */
export function providerReferenceRoute({ candidate }: { candidate: string }): string | undefined {
  if (/^https?:\/\//.test(candidate)) {
    return "a URL is not a local path — fetch it through its provider's own verb first (`slack read-file`, `linear attach fetch`, `notion read --attachments`)";
  }
  if (/^F[A-Z0-9]{6,}$/.test(candidate)) {
    return "that is a Slack file id — `slopweaver slack read-file <id>` fetches it and already prints its text";
  }
  return undefined;
}

/**
 * Parse `pdf read`'s argv tail.
 *
 * @param rest the argv after the verb
 * @returns the resolved options, or one sentence per refusal
 */
export function parsePdfReadArgs({ rest }: { rest: readonly string[] }): Result<PdfReadOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: PDF_READ_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  if (positionals.length === 0) {
    return err(["a path to a local PDF is required"]);
  }
  if (positionals.length > 1) {
    return err([`expected one path, got ${String(positionals.length)}: ${positionals.join(" ")}`]);
  }
  const path = positionals[0]!;
  const route = providerReferenceRoute({ candidate: path });
  if (route !== undefined) {
    return err([route]);
  }
  const pages = values["pages"];
  if (pages === undefined) {
    return ok({ json: values["json"] === true, maxPages: PDF_PAGES_DEFAULT, path });
  }
  if (typeof pages !== "string") {
    return err(["--pages takes a number"]);
  }
  const parsedPages = Number(pages);
  if (!Number.isInteger(parsedPages) || parsedPages < 1) {
    return err([`--pages must be a whole number of at least 1, got ${pages}`]);
  }
  return ok({ json: values["json"] === true, maxPages: parsedPages, path });
}

/**
 * Parse `pdf check`'s argv tail.
 *
 * It takes one flag, and parsing it rather than scanning `rest` for the string is what makes a typo
 * (`--jsonn`) a refusal instead of a silently-ignored argument.
 *
 * @param rest the argv after the verb
 * @returns whether one JSON document was asked for, or one sentence per refusal
 */
export function parsePdfCheckArgs({ rest }: { rest: readonly string[] }): Result<{ readonly json: boolean }> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: PDF_CHECK_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ json: parsed.value.values["json"] === true });
}

/** What `pdf check` reports about this host. */
export interface PdfCheckReport {
  /** Whether the extractor loaded and read a document this process built for the purpose. */
  readonly extractorLoads: boolean;
  /** The in-memory byte ceiling one document may reach. */
  readonly bytesMax: number;
  /** How many pages one extraction reads before it stops. */
  readonly pagesDefault: number;
  /** What stopped the extractor loading, when it did not. */
  readonly problem: string | undefined;
}

/**
 * Render `pdf check` for a terminal.
 *
 * @param report what the check observed
 * @returns the lines to print, newline-joined
 */
export function renderPdfCheck({ report }: { report: PdfCheckReport }): string {
  const lines: string[] = [];
  if (report.extractorLoads) {
    lines.push("pdf check: the text extractor loads and reads a document on this host");
  } else {
    lines.push(`pdf check: the text extractor DID NOT load — ${String(report.problem)}`);
  }
  lines.push(`  ceiling:  ${String(report.bytesMax)} bytes per document`);
  lines.push(`  pages:    ${String(report.pagesDefault)} per extraction by default, raised with --pages`);
  lines.push("  not OCR:  a scanned document has no text layer and is reported as such, never guessed at");
  return lines.join("\n");
}

/** One `pdf read` result, as the terminal renders it and `--json` serialises it. */
export interface PdfReadReport {
  readonly path: string;
  readonly pages: number;
  readonly pagesRead: number;
  readonly glyphless: boolean;
  readonly text: string;
}

/**
 * The report one extraction produces.
 *
 * @param extraction what the extractor returned
 * @param path the file it was read from
 * @returns the report both renderers read
 */
export function pdfReadReport({ extraction, path }: { extraction: PdfExtraction; path: string }): PdfReadReport {
  return {
    glyphless: extraction.glyphless,
    pages: extraction.pages,
    pagesRead: extraction.pagesRead,
    path,
    text: extraction.text,
  };
}

/**
 * Render one extraction for a terminal — the header, then the document's own words.
 *
 * The glyphless arm prints `GLYPHLESS_LINE` (`../../../pdf/limits.ts`) INSTEAD of the body. An empty body under a page count
 * reads as a blank document, which is the one wrong answer this verb must never give.
 *
 * @param report the extraction's report
 * @returns the lines to print, newline-joined
 */
export function renderPdfRead({ report }: { report: PdfReadReport }): string {
  const header = pdfReadHeader({ report });
  if (report.glyphless) {
    return `${header}\n${GLYPHLESS_LINE}`;
  }
  return `${header}\n\n${report.text}`;
}

/**
 * The one-line summary above an extraction's body.
 *
 * @param report the extraction's report
 * @returns the header line
 */
export function pdfReadHeader({ report }: { report: PdfReadReport }): string {
  const pages = `${String(report.pages)} page(s)`;
  if (report.pagesRead < report.pages) {
    return `${report.path} — ${pages}, ${String(report.pagesRead)} read (raise with --pages)`;
  }
  return `${report.path} — ${pages}`;
}

/** The ceilings `pdf check` reports, so its shell states no number of its own. */
export const PDF_CHECK_CEILINGS = { bytesMax: PDF_BYTES_MAX, pagesDefault: PDF_PAGES_DEFAULT } as const;
