/**
 * The policy DOCUMENT kind: this organisation's own policy files, fetched through the Manage API, stored
 * whole, and stored again as text so a local search can answer "which policy mentions contractors".
 *
 * ## The owner's rule this implements, in the owner's own words
 *
 * > "how could you expect to be able to do that search function over the information that's all available
 * > inside of Vanta if you don't even have the policies locally?"
 *
 * An atlas is all reachable information inside a SaaS platform, not a map of where that information would
 * be. So a policy's body is stored — the source file exactly as Vanta served it, and the extracted text
 * beside it — rather than pointed at.
 *
 * ## API first, and the browser is not needed here after all
 *
 * The predecessor of this module was a `not-fetched` exclusion saying the body was owed to the BROWSER
 * channel, because nine content-shaped routes under `/v1/policies/{id}` answer HTTP 404. All nine were
 * guessed. `GET /v1/knowledge-base/resources` is in Vanta's own published document, answers HTTP 200, and
 * serves every policy as a file — see `policyDocumentApiSchemas.ts` for the measurement. The browser leg
 * is still worth having for what the API abstracts away; it is not what holds the body.
 *
 * ## Three seams, so this is provable without a network or a disk
 *
 * The download, the text extraction and the artifact write are injected. Each is a plain function a test
 * supplies, never a mock, which is what lets every branch below — a file that will not download, bytes that
 * are not a PDF, a document with no text layer, an artifact that will not land — be settled by a unit test
 * rather than by luck in a live run.
 *
 * ## A knowledge base is allowed to hold something that is not a PDF
 *
 * That sentence above once named a not-a-PDF branch this module did not have, and the omission had teeth.
 * `extract` was `extractPdfText` directly, which answers `err` for bytes that do not begin with `%PDF-`;
 * `storeOneDocument` turned that into a `problem`; and `syncVantaPolicyDocuments` fails the WHOLE kind when
 * any problem stands. So one spreadsheet uploaded beside the policies stored no policy body at all — not
 * the spreadsheet's, everybody's. Nothing prevented it: `policyDocumentApiSchemas.ts`'s DTO carries no
 * mimetype, no filename and no extension, and `type` is only `FILE` or `URL`.
 *
 * The extraction seam is now `pdfAttachmentFrom`'s own signature (`../../pdf/attachment.ts`), so the three
 * decisions that module exists to make — the BYTES decide what this is, a glyphless document is not an
 * empty one, and a non-PDF is not read whole to find out — are made here exactly as they are at the Slack,
 * Linear and Notion doors. A non-PDF is STORED and RECORDED, never a problem: the owner's rule this module
 * quotes argues for keeping the file, and calling it `source.pdf` was the part that was wrong.
 */
import { createHash } from "node:crypto";

import type { Result } from "../../lib/result.js";
import { err, ok } from "../../lib/result.js";
import type { PdfAttachment } from "../../pdf/attachment.js";
import { PDF_BYTES_MAX } from "../../pdf/limits.js";
import { isPdf as bytesArePdf } from "../../pdf/text.js";
import type { AtlasArtifactWriter } from "../kit/artifactWriter.js";
import type { AtlasArtifactRef } from "../kit/contract.js";
import { vantaEntityId } from "./identity.js";
import type { VantaEntity, VantaKindFile, VantaSource } from "./model.js";
import { knowledgeBaseFileUrl, type VantaKnowledgeBaseResourceDto } from "./policyDocumentApiSchemas.js";
import type { VantaSurfaceError } from "./surfaceErrors.js";
import { VantaSyncErrors, vantaSyncErrorLines } from "./syncErrors.js";
import { attemptItems, attemptSurface, findCoverageCell, foldKindSync, type KindSyncResult } from "./syncKind.js";

/** The kind these entities are filed under.
 * @internal
 */
export const VANTA_POLICY_DOCUMENT_KIND = "policy-document";

/** The coverage surface this kind reports under, matching `inventory.ts`.
 * @internal
 */
export const VANTA_POLICY_DOCUMENT_SURFACE = "knowledge-base-resources";

/** The endpoint the surface reads, as `transport.ts` addresses it.
 * @internal
 */
export const VANTA_POLICY_DOCUMENT_ENDPOINT = "/knowledge-base/resources";

/** Fetch one presigned document's exact bytes. Injected so the walk is provable without a network. */
export type VantaDocumentDownload = (input: { url: string }) => Promise<Result<Uint8Array>>;

/**
 * Turn a stored document's bytes into text. Injected for the same reason.
 *
 * This is `pdfAttachmentFrom`'s own signature rather than a shape of this module's choosing, so `syncRunners.ts`
 * passes that function straight in. An adapter re-flattening `PdfAttachment` back to `{ pages, text }`
 * would be a fourth place the shared module's decisions live, which is the thing it exists to prevent —
 * and flattening is exactly how the glyphless case gets lost, since `undefined` is the one answer that
 * carries it.
 */
export type VantaDocumentExtract = (input: { bytes: Uint8Array }) => Promise<Result<PdfAttachment | undefined>>;

/**
 * What this resource's own words turned out to be, or why there are none to search.
 * @internal
 */
export type VantaDocumentTextState =
  "extracted" | "no-text-layer" | "not-a-document" | "too-large" | "unreadable" | "not-fetched";

/**
 * Where one resource's two artifacts live beneath the atlas's own directory.
 *
 * The provider id is percent-encoded, so a resource whose id carries a separator cannot address a path
 * outside its own directory.
 *
 * The source's extension is decided by the BYTES, never by the resource record, because the record has
 * nothing to decide it with — no mimetype, no filename, no extension. Every stored file was named
 * `source.pdf` before that was checked, so a spreadsheet in the knowledge base landed on disk claiming to
 * be a PDF.
 *
 * @param providerId the knowledge-base resource's own id
 * @param isPdf whether the downloaded bytes actually begin with `%PDF-`
 * @returns the relative path of the source file and of the text extracted from it
 */
export function policyDocumentArtifactPaths({ providerId, isPdf }: { providerId: string; isPdf: boolean }): {
  readonly source: string;
  readonly text: string;
} {
  const safe = encodeURIComponent(providerId);
  const extension = isPdf ? "pdf" : "bin";
  return {
    source: `artifacts/policy-document/${safe}/source.${extension}`,
    text: `artifacts/policy-document/${safe}/body.md`,
  };
}

/** One resource after its bytes were chased: what landed, and what did not. */
interface StoredDocument {
  readonly artifacts: readonly AtlasArtifactRef[];
  /** Every reason a byte did not land, so a partial store is never reported as a whole one. */
  readonly problems: readonly string[];
  readonly text: string | null;
  /**
   * Why {@link StoredDocument.text} is `null`, when it is. A reader cannot tell a scan from a spreadsheet
   * from a document nobody could fetch out of a null, and those want three different next moves.
   */
  readonly textState: VantaDocumentTextState;
}

/** Write one artifact and return its reference, or the reason it did not land. */
function writeOne({
  bytes,
  kind,
  mediaType,
  relativePath,
  writeArtifact,
}: {
  bytes: Uint8Array;
  kind: AtlasArtifactRef["kind"];
  mediaType: string;
  relativePath: string;
  writeArtifact: AtlasArtifactWriter;
}): Result<AtlasArtifactRef> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const written = writeArtifact({ bytes, relativePath, sha256 });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({ byteLength: bytes.byteLength, kind, mediaType, relativePath, sha256 });
}

/**
 * What a resource with no URL to fetch yields.
 *
 * A `URL` resource has no bytes and is complete without any. A `FILE` one that arrived without a usable
 * `fileUrl` is a DIFFERENT thing, and used to reach the same silence — found by a Codex review pass, and it is exactly the shape this whole change exists to end: a document the atlas could not fetch,
 * published as a record with `text: null` and no artifacts, indistinguishable from one that legitimately
 * has none.
 */
function withoutBytes({ dto }: { dto: VantaKnowledgeBaseResourceDto }): StoredDocument {
  if (dto.type === "FILE") {
    return {
      artifacts: [],
      problems: [`${dto.id}: a FILE resource arrived with no usable fileUrl, so its bytes could not be fetched`],
      text: null,
      textState: "not-fetched",
    };
  }
  return { artifacts: [], problems: [], text: null, textState: "not-fetched" };
}

/** Write the source file under the name its own bytes earn, keeping whatever refused to land. */
function storeBytes({
  bytes,
  dto,
  isPdf,
  writeArtifact,
}: {
  bytes: Uint8Array;
  dto: VantaKnowledgeBaseResourceDto;
  isPdf: boolean;
  writeArtifact: AtlasArtifactWriter;
}): { readonly artifacts: readonly AtlasArtifactRef[]; readonly problems: readonly string[] } {
  const source = writeOne({
    bytes,
    kind: "binary",
    mediaType: isPdf ? "application/pdf" : "application/octet-stream",
    relativePath: policyDocumentArtifactPaths({ isPdf, providerId: dto.id }).source,
    writeArtifact,
  });
  if (source.isErr()) {
    return { artifacts: [], problems: [`${dto.id}: ${source.error.join("; ")}`] };
  }
  return { artifacts: [source.value], problems: [] };
}

/** Write the extracted words beside the source, so a local query can reach them. */
function storeText({
  artifacts,
  dto,
  problems,
  text,
  writeArtifact,
}: {
  artifacts: readonly AtlasArtifactRef[];
  dto: VantaKnowledgeBaseResourceDto;
  problems: readonly string[];
  text: string;
  writeArtifact: AtlasArtifactWriter;
}): StoredDocument {
  const written = writeOne({
    bytes: new TextEncoder().encode(text),
    kind: "page-text",
    mediaType: "text/markdown",
    relativePath: policyDocumentArtifactPaths({ isPdf: true, providerId: dto.id }).text,
    writeArtifact,
  });
  if (written.isErr()) {
    return {
      artifacts,
      problems: [...problems, `${dto.id}: ${written.error.join("; ")}`],
      text,
      textState: "extracted",
    };
  }
  return { artifacts: [...artifacts, written.value], problems, text, textState: "extracted" };
}

/**
 * Store one resource's source bytes and its extracted text, reporting whatever could not be stored.
 *
 * The extraction runs BEFORE the source is written, which is the opposite of the order this had, because
 * the extraction is what decides the source file's own name. The bytes are already in hand either way, so
 * nothing is fetched twice.
 *
 * Two of the six outcomes are problems and four are not. A resource whose bytes are not a PDF at all, one
 * whose pages carry no glyph, and one too large for this machine to hold in memory are all FACTS about that
 * resource: they are stored, recorded and searchable as a state. Only bytes that could not be fetched, and
 * a PDF that claims to be one and will not parse, say the atlas failed to hold what Vanta served.
 *
 * **The ceiling is checked HERE, before the seam, and that is the point.** `extractPdfText` refuses a
 * document past `PDF_BYTES_MAX` by returning `err` — the same shape a corrupt document returns — so a lane
 * that only asked the seam turned a 70 MiB policy into a `problem`, and one problem fails the whole kind.
 * That is the exact failure this module was changed to close, reproduced on a different input; an r1 review
 * pass found it in the diff that closed the first half. A size the machine cannot read is not a document
 * that will not parse, so it is recorded and every other policy keeps its body.
 *
 * **KIND is asked before SIZE**, which r2 found the other way round. A 500 MB screen recording is both, and
 * a `too-large` on it says a document was too big to hold and invites somebody to raise the ceiling — when
 * no ceiling would ever make it a document. Size only means anything once the bytes are a PDF.
 */
async function storeOneDocument({
  dto,
  download,
  extract,
  writeArtifact,
}: {
  dto: VantaKnowledgeBaseResourceDto;
  download: VantaDocumentDownload;
  extract: VantaDocumentExtract;
  writeArtifact: AtlasArtifactWriter;
}): Promise<StoredDocument> {
  const url = knowledgeBaseFileUrl({ dto });
  if (url === null) {
    return withoutBytes({ dto });
  }
  const fetched = await download({ url });
  if (fetched.isErr()) {
    return {
      artifacts: [],
      problems: [`${dto.id}: ${fetched.error.join("; ")}`],
      text: null,
      textState: "not-fetched",
    };
  }
  const bytes = fetched.value;
  /*
   * KIND before SIZE, and the order is the finding. `isPdf` is also asked here rather than inferred from
   * the seam's error arm — an `err` from `pdfAttachmentFrom` does prove the bytes were a PDF, but that is
   * that module's invariant to keep, not this one's to assume, so a future error path there cannot quietly
   * start filing spreadsheets as `source.pdf`.
   */
  const stored = storeBytes({ bytes, dto, isPdf: bytesArePdf({ bytes }), writeArtifact });
  if (!bytesArePdf({ bytes })) {
    return { artifacts: stored.artifacts, problems: stored.problems, text: null, textState: "not-a-document" };
  }
  if (bytes.byteLength > PDF_BYTES_MAX) {
    return { artifacts: stored.artifacts, problems: stored.problems, text: null, textState: "too-large" };
  }
  const extracted = await extract({ bytes });
  const document = extracted.isErr() ? undefined : extracted.value;
  if (extracted.isErr()) {
    return {
      artifacts: stored.artifacts,
      problems: [...stored.problems, `${dto.id}: ${extracted.error.join("; ")}`],
      text: null,
      textState: "unreadable",
    };
  }
  if (document === undefined) {
    return { artifacts: stored.artifacts, problems: stored.problems, text: null, textState: "not-a-document" };
  }
  if (document.text === undefined) {
    return { artifacts: stored.artifacts, problems: stored.problems, text: null, textState: "no-text-layer" };
  }
  return storeText({ artifacts: stored.artifacts, dto, problems: stored.problems, text: document.text, writeArtifact });
}

/**
 * Project one stored resource into an entity.
 *
 * The extracted text goes into `detail` as well as into its own artifact, and that is deliberate rather
 * than a duplicate: `kit/read.ts`'s plain-text query walks an entity's `detail` string leaves, so text that
 * lives only in a file beside the record is text `slopweaver atlas vanta read --query contractor` cannot
 * find. The artifact is the reviewable document; the field is what makes it searchable.
 *
 * `textState` rides beside it rather than inside it for that same reason. Writing "this document has no
 * text layer" into `text` would make those words a `--query` hit on a document that does not contain them,
 * and every scanned policy would answer the same searches. A discriminant is queryable as a field and can
 * never be mistaken for the document's own words.
 *
 * @param dto the resource as the Manage API returned it
 * @param stored what actually landed on disk for it
 * @param at this run's instant
 * @returns the entity, with its `manage-api` channel populated and no browser channel
 * @internal
 */
export function projectVantaPolicyDocument({
  dto,
  stored,
  at,
}: {
  dto: VantaKnowledgeBaseResourceDto;
  stored: StoredDocument;
  at: string;
}): VantaEntity {
  const source: VantaSource = {
    artifacts: [...stored.artifacts],
    channel: "manage-api",
    deepLink: null,
    // The provider hands back a presigned URL that expires in an hour, so there is no durable link to cite.
    deepLinkStatus: "unavailable",
    endpoint: VANTA_POLICY_DOCUMENT_ENDPOINT,
    observedAt: at,
  };
  return {
    channels: {
      browser: null,
      "manage-api": {
        channel: "manage-api",
        detail: { ...dto, fileUrl: null, text: stored.text, textState: stored.textState },
        firstSeenAt: at,
        lastSeenAt: at,
        source,
        state: "observed",
      },
    },
    financialDetail: null,
    id: vantaEntityId({ components: { id: dto.id }, kind: VANTA_POLICY_DOCUMENT_KIND }),
    kind: VANTA_POLICY_DOCUMENT_KIND,
    providerId: dto.id,
    sensitivity: null,
  };
}

/**
 * Sync every policy document: list the resources, fetch each file, store its bytes and its text.
 *
 * A resource whose bytes could not be stored makes the whole kind INCOMPLETE, so a run that held the list
 * and none of the documents can never publish as a synced policy-document surface — which is the exact
 * failure this kind exists to end.
 *
 * @param stored the kind's file as the previous generation left it
 * @param list reads the resource collection
 * @param download fetches one presigned file's bytes
 * @param extract turns a document's bytes into text
 * @param writeArtifact stores one artifact and proves the bytes landed
 * @param at this run's instant
 * @returns the kind's updated file and whether this run read it completely, or why the fold was refused
 */
export async function syncVantaPolicyDocuments({
  stored,
  list,
  download,
  extract,
  writeArtifact,
  at,
}: {
  stored: VantaKindFile;
  list: () => Promise<Result<readonly VantaKnowledgeBaseResourceDto[], VantaSurfaceError>>;
  download: VantaDocumentDownload;
  extract: VantaDocumentExtract;
  writeArtifact: AtlasArtifactWriter;
  at: string;
}): Promise<Result<KindSyncResult>> {
  const attempted = await attemptSurface<VantaKnowledgeBaseResourceDto>({
    at,
    fetch: list,
    kind: VANTA_POLICY_DOCUMENT_KIND,
    previousCoverage: findCoverageCell({ coverage: stored.coverage, surface: VANTA_POLICY_DOCUMENT_SURFACE }),
    surface: VANTA_POLICY_DOCUMENT_SURFACE,
  });
  if (attempted.isErr()) {
    return err(attempted.error);
  }
  const attempt = attempted.value;
  const entities: VantaEntity[] = [];
  const problems: string[] = [];
  for (const dto of attemptItems({ attempt })) {
    const document = await storeOneDocument({ download, dto, extract, writeArtifact });
    problems.push(...document.problems);
    entities.push(projectVantaPolicyDocument({ at, dto, stored: document }));
  }
  if (problems.length > 0) {
    return err(
      vantaSyncErrorLines({
        error: VantaSyncErrors.policyDocumentsUnstored({ documentCount: entities.length, problems }),
      }),
    );
  }
  return foldKindSync({
    at,
    attempts: [attempt],
    kind: VANTA_POLICY_DOCUMENT_KIND,
    observedEntities: entities,
    stored,
  });
}
