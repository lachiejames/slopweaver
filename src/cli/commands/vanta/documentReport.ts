/**
 * The human lines the three document write verbs print: the dry run's exact request, and what the provider
 * answered once a live write landed.
 *
 * Split from {@link ./documentCore} because a report is decided by the RESPONSE and a parse is decided by the
 * argv — the two halves share no input and no failure mode, and the response shapes this file has to know
 * about have nothing to say to flag parsing.
 */
import { vantaDocumentDtoSchema } from "../../../atlas/vanta/apiSchemas.js";
import { vantaUploadedFileDtoSchema } from "../../../atlas/vanta/writeApiSchemas.js";
import type { VantaResolvedWriteRequest } from "../../../atlas/vanta/writePreview.js";

/**
 * The human lines a document dry run prints: the exact request, and the digest that approves it.
 *
 * @param verb which document write this is
 * @param request the request as `resolveVantaWriteRequest` resolved it
 * @param digest the approval digest covering exactly that request
 * @returns the report lines, in display order
 */
export function renderVantaDocumentDryRun({
  verb,
  request,
  digest,
}: {
  verb: string;
  request: VantaResolvedWriteRequest;
  digest: string;
}): readonly string[] {
  return [
    `write vanta ${verb} --dry-run: this request would be sent, nothing was`,
    "",
    `${request.method} ${request.path}`,
    ...Object.entries(request.headers).map(([key, value]) => `  ${key}: ${value}`),
    ...(request.body.kind === "json" ? ["", request.body.json] : []),
    ...(request.body.kind === "multipart" ? ["", ...request.body.fields.map((field) => `  ${field}`)] : []),
    "",
    `to send exactly this request: --approve ${digest}`,
    "  the digest covers the method, the path and every byte of the body above; change any of them and it stops matching",
    ...(request.body.kind === "multipart"
      ? ["  the file's sha256 above binds its exact bytes, so a different file under the same name stops matching"]
      : []),
  ];
}

/**
 * The human lines a document write prints after the provider has answered.
 *
 * `sent` on its own was the whole report, and it is the reason a landed upload could not be told apart from
 * one that never arrived. MEASURED: a session uploaded the pen-test renewal, the door recorded
 * an `external-write` pass, and the only way anyone could confirm the file was on the document was a full
 * `atlas vanta sync` — a walk of every Manage collection, which took over twenty minutes and had last
 * refreshed the uploads sub-collection three hours before the write. In that gap the upload read as missing
 * and a second one was very nearly sent. Vanta's own response already carries the id, the stored filename
 * and the URL; parsing it and throwing it away was the defect.
 *
 * Only these two response shapes carry a token. `submit-document` answers with nothing at all, and a shape
 * neither schema accepts is not a shape this renderer can name, so both print `sent` alone rather than
 * reaching for whatever fields an object happens to carry.
 *
 * Repro: `slopweaver write vanta upload-evidence --document <id> --file <pdf> --approve <digest>`.
 *
 * @param verb which document write this is
 * @param result what the write client already parsed, widened back to `unknown` at this boundary because
 *   only the verb knows which of the three response shapes its own call produces
 * @returns the report lines, in display order
 */
export function renderVantaWriteResult({ verb, result }: { verb: string; result: unknown }): readonly string[] {
  const sent = `write vanta ${verb}: sent`;
  const upload = vantaUploadedFileDtoSchema.safeParse(result);
  if (upload.success) {
    return [
      sent,
      `  upload ${upload.data.id} — ${upload.data.title} (${upload.data.mimeType})`,
      `  ${upload.data.url}`,
      "  confirm it independently with `slopweaver atlas vanta sync`, then read the document-upload of that id",
    ];
  }
  const document = vantaDocumentDtoSchema.safeParse(result);
  if (document.success) {
    return [sent, `  document ${document.data.id} — ${document.data.title}`];
  }
  return [sent];
}
