/**
 * Lazy manifest for the `pdf` noun — the reader every door's attachment ends at.
 *
 * ## Why the verb takes a path and not a provider reference
 *
 * Getting an attachment's bytes is the provider door's job; reading them is this noun's. Every door in
 * this program already ends at bytes on disk — `slack read-file`'s `localPath`, `linear attach fetch`'s
 * `--out`, `notion read --attachments`, the Vanta atlas's `artifacts/policy-document/<id>/source.pdf` —
 * so a `pdf read <slack file id>` would be a SECOND door into Slack's read (AGENTS.md rule 3) that
 * re-implemented the hardening `live/slack/download.ts` already carries. `../commands/pdf/core.ts` refuses
 * a URL and a Slack file id BY NAME, routing the caller to the verb that fetches.
 *
 * `check` exists because the `attachments` capability row wants a cheap ZERO-ARGUMENT scope command — the
 * pattern `drive`, `gmail` and `telemetry` already follow — and `read` takes a path, so a question
 * substituted into it would fail and read as absence.
 */
import { PDF_CHECK_USAGE, PDF_READ_USAGE } from "../commands/pdf/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The `pdf` noun's verbs as lazy manifest entries. */
export const pdfManifest: Readonly<Record<string, VerbManifestEntry>> = {
  check: lazy({
    load: () => import("../commands/pdf/run.js").then((m) => m.pdfCheckCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver pdf check --json",
      parseRejectIsIoFree: true,
      summary: "Whether this host can build and read a PDF at all, and the two ceilings the reader holds",
      usage: PDF_CHECK_USAGE,
    },
  }),
  read: lazy({
    load: () => import("../commands/pdf/run.js").then((m) => m.pdfReadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver pdf read ~/.slopweaver/live/slack/file-reads/F09ABCDEF/report.pdf",
      parseRejectIsIoFree: true,
      summary:
        "Extract one local PDF's text and page count — the reader a provider's door hands its bytes to. " +
        "Not OCR: a scanned document is reported as having no text layer, never guessed at",
      usage: PDF_READ_USAGE,
    },
  }),
};
