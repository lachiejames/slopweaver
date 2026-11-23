/**
 * The words in one parked draft's attached document, for the queue card to show under its file card:
 * `/api/draft-media/<sha256>/text` answers the same verified blob `../route.ts` serves pictures from — the bytes the
 * send uploads — as UTF-8 text, or, for a PDF, as the text `slopweaver pdf read` extracts. Every check is
 * `../../../../../lib/draftMediaServe.ts`'s.
 *
 * The PDF is handed to the verb as a COPY of the verified bytes in a throwaway directory, never as the store's own
 * path, so the verb reads exactly what was hashed even if the store changed underneath between the two reads.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { draftMediaStoreDir, type PdfTextOf, serveDraftMediaText } from "../../../../../lib/draftMediaServe";
import { pdfReadAnswerOf } from "../../../../../lib/draftMediaText";
import { spawnVerb } from "../../../../../lib/spawnVerb";

/** Never prerendered: it reads the store every time. */
export const dynamic = "force-dynamic";

/** How long `pdf read` may take over one attachment before the card says it could not read it. */
const PDF_READ_TIMEOUT_MS = 30_000;

/**
 * Extract a PDF's text through `slopweaver pdf read`.
 *
 * @returns the extraction, or `undefined` when the verb could not read the document
 */
const pdfTextOf: PdfTextOf = async ({ bytes }) => {
  const dir = await mkdtemp(join(tmpdir(), "draft-pdf-"));
  try {
    const path = join(dir, "attachment.pdf");
    await writeFile(path, bytes, { mode: 0o600 });
    const ran = await spawnVerb({
      argv: ["pdf", "read", path, "--json"],
      timeoutMs: PDF_READ_TIMEOUT_MS,
      title: "slopweaver pdf read",
    });
    if (!ran.ok) {
      return undefined;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(ran.out);
    } catch {
      return undefined;
    }
    return pdfReadAnswerOf({ payload });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};

/**
 * Serve one stored attachment's words.
 *
 * @param _request unused: the hash is the whole question
 * @param context the dynamic segment: the blob's SHA-256
 * @returns the text as JSON, or a 404 naming the hash
 */
export async function GET(_request: Request, context: { params: Promise<{ sha256: string }> }): Promise<Response> {
  const { sha256 } = await context.params;
  return serveDraftMediaText({ pdfTextOf, sha256, storeDir: draftMediaStoreDir() });
}
