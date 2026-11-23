import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AtlasArtifactWriter } from "../../../../atlas/kit/artifactWriter.js";
import { VantaHttpErrors } from "../../../../atlas/vanta/httpErrors.js";
import { emptyVantaKindFile } from "../../../../atlas/vanta/model.js";
import {
  knowledgeBaseFileUrl,
  type VantaKnowledgeBaseResourceDto,
} from "../../../../atlas/vanta/policyDocumentApiSchemas.js";
import {
  policyDocumentArtifactPaths,
  syncVantaPolicyDocuments,
  type VantaDocumentDownload,
  type VantaDocumentExtract,
} from "../../../../atlas/vanta/policyDocuments.js";
import { VantaSurfaceErrors } from "../../../../atlas/vanta/surfaceErrors.js";
import { err, ok, unwrap } from "../../../../lib/result.js";
import { pdfAttachmentFrom } from "../../../../pdf/attachment.js";
import { PDF_BYTES_MAX } from "../../../../pdf/limits.js";

const AT = "2026-09-09T05:03:21.428Z";

/** A list call Vanta refused with a 403, graded as the client grades it. */
const refused403 = VantaSurfaceErrors.fromTransportFailure({
  failure: VantaHttpErrors.httpStatus({ safePath: "/v1/resources/knowledge-base", status: 403 }),
  reasons: ["HTTP 403"],
});

type FileResource = Extract<VantaKnowledgeBaseResourceDto, { type: "FILE" }>;
type UrlResource = Extract<VantaKnowledgeBaseResourceDto, { type: "URL" }>;

/** The fields both arms share, as one of this account's real resources carries them. */
const shared = (): Omit<FileResource, "downloadPermission" | "fileUrl" | "type"> => ({
  categoryId: null,
  customerVisibility: "PRIVATE",
  description: null,
  expirationDate: null,
  expirationStatus: "CURRENT",
  id: "kb-1",
  isUsedInQuestionnaires: false,
  lastUpdated: AT,
  lastVerified: AT,
  ownerAssignment: null,
  tags: [],
  title: "Human Resource Security Policy",
});

const resource = (over: Partial<FileResource> = {}): FileResource => ({
  ...shared(),
  downloadPermission: "VIEW_AND_DOWNLOAD",
  fileUrl: "https://storage.example/presigned",
  type: "FILE",
  ...over,
});

const webpage = (over: Partial<UrlResource> = {}): UrlResource => ({
  ...shared(),
  includeSubPages: false,
  type: "URL",
  url: "https://trust.example/security",
  ...over,
});

const collectingWriter = (): { writer: AtlasArtifactWriter; written: string[] } => {
  const written: string[] = [];
  return {
    writer: ({ relativePath }) => {
      written.push(relativePath);
      return ok(null);
    },
    written,
  };
};

/**
 * Bytes that carry the PDF magic, because the source file's own NAME is now decided by them: a fake
 * serving `[1,2,3]` while its extract seam reports a successful extraction describes a world that cannot
 * happen, and would assert `source.bin` for a document the same test calls readable.
 */
const downloadOk: VantaDocumentDownload = async () => ok(new TextEncoder().encode("%PDF-1.4 fake"));
const extractOk: VantaDocumentExtract = async () =>
  ok({ glyphless: false, pages: 3, pagesRead: 3, text: "personnel and contractors" });

/** The one-page fixture with a real text layer. */
const TEXT_SAMPLE = join(import.meta.dirname, "../../../fixtures/pdf/text-sample.pdf");

/** The two-page fixture drawn without a font, so it has no text layer at all. */
const SCANNED_SAMPLE = join(import.meta.dirname, "../../../fixtures/pdf/scanned-sample.pdf");

/** Serve one committed fixture, and read it with the SHIPPED extractor rather than a restatement of it. */
const servingFixture = ({
  fixture,
}: {
  fixture: string;
}): { download: VantaDocumentDownload; extract: VantaDocumentExtract } => ({
  download: async () => ok(new Uint8Array(readFileSync(fixture))),
  extract: pdfAttachmentFrom,
});

/** Bytes a human might well upload beside a policy, and which are not a PDF at all. */
const servingBytes = ({
  bytes,
}: {
  bytes: string;
}): { download: VantaDocumentDownload; extract: VantaDocumentExtract } => ({
  download: async () => ok(new TextEncoder().encode(bytes)),
  extract: pdfAttachmentFrom,
});

describe("policyDocumentArtifactPaths", () => {
  it("puts the source and the text side by side under one directory per resource", () => {
    const paths = policyDocumentArtifactPaths({ isPdf: true, providerId: "kb-1" });
    expect(paths.source).toBe("artifacts/policy-document/kb-1/source.pdf");
    expect(paths.text).toBe("artifacts/policy-document/kb-1/body.md");
  });

  it("escapes a provider id that would otherwise leave its own directory", () => {
    const paths = policyDocumentArtifactPaths({ isPdf: true, providerId: "../escape" });
    expect(paths.source).toBe("artifacts/policy-document/..%2Fescape/source.pdf");
  });
});

describe("knowledgeBaseFileUrl", () => {
  it("returns the presigned url for a FILE resource", () => {
    expect(knowledgeBaseFileUrl({ dto: resource() })).toBe("https://storage.example/presigned");
  });

  it("returns null for a URL resource, which has no bytes to fetch", () => {
    expect(knowledgeBaseFileUrl({ dto: webpage() })).toBe(null);
  });

  it("returns null for a FILE resource whose url is empty", () => {
    expect(knowledgeBaseFileUrl({ dto: resource({ fileUrl: "" }) })).toBe(null);
  });
});

describe("syncVantaPolicyDocuments", () => {
  it("stores the source and the text, and puts the text where a query can find it", async () => {
    const { writer, written } = collectingWriter();
    const result = await syncVantaPolicyDocuments({
      at: AT,
      download: downloadOk,
      extract: extractOk,
      list: async () => ok([resource()]),
      stored: emptyVantaKindFile({ kind: "policy-document", updatedAt: AT }),
      writeArtifact: writer,
    });
    expect(result.isOk()).toBe(true);
    const value = unwrap(result);
    expect(value.complete).toBe(true);
    expect(written).toEqual(["artifacts/policy-document/kb-1/source.pdf", "artifacts/policy-document/kb-1/body.md"]);
    expect(value.file.entities).toHaveLength(1);
    const channel = value.file.entities[0]!.channels["manage-api"]!;
    expect((channel.detail as { text: string }).text).toBe("personnel and contractors");
    expect((channel.detail as { fileUrl: string | null }).fileUrl).toBe(null);
    expect(channel.source!.artifacts).toHaveLength(2);
    expect(channel.source!.endpoint).toBe("/knowledge-base/resources");
  });

  it("refuses the whole kind when one document's bytes will not download", async () => {
    const { writer } = collectingWriter();
    const result = await syncVantaPolicyDocuments({
      at: AT,
      download: async () => err(["the presigned document URL answered HTTP 403"]),
      extract: extractOk,
      list: async () => ok([resource()]),
      stored: emptyVantaKindFile({ kind: "policy-document", updatedAt: AT }),
      writeArtifact: writer,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().join(" ")).toContain("could not be stored whole");
  });

  it("refuses the whole kind when an artifact will not land", async () => {
    const result = await syncVantaPolicyDocuments({
      at: AT,
      download: downloadOk,
      extract: extractOk,
      list: async () => ok([resource()]),
      stored: emptyVantaKindFile({ kind: "policy-document", updatedAt: AT }),
      writeArtifact: () => err(["the artifact hashes to something else"]),
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().join(" ")).toContain("hashes to something else");
  });

  it("refuses a FILE resource that arrived with no usable url, rather than publishing it contentless", async () => {
    const { writer } = collectingWriter();
    const result = await syncVantaPolicyDocuments({
      at: AT,
      download: downloadOk,
      extract: extractOk,
      list: async () => ok([resource({ fileUrl: "" })]),
      stored: emptyVantaKindFile({ kind: "policy-document", updatedAt: AT }),
      writeArtifact: writer,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().join(" ")).toContain("no usable fileUrl");
  });

  it("stores a URL resource as an entity with no artifacts and no text", async () => {
    const { writer, written } = collectingWriter();
    const result = await syncVantaPolicyDocuments({
      at: AT,
      download: downloadOk,
      extract: extractOk,
      list: async () => ok([webpage({ id: "kb-2" })]),
      stored: emptyVantaKindFile({ kind: "policy-document", updatedAt: AT }),
      writeArtifact: writer,
    });
    const value = unwrap(result);
    expect(written).toEqual([]);
    expect(value.file.entities).toHaveLength(1);
    expect((value.file.entities[0]!.channels["manage-api"]!.detail as { text: string | null }).text).toBe(null);
  });

  it("records the surface as unreadable and keeps the stored entities when the list call fails", async () => {
    const { writer } = collectingWriter();
    const result = await syncVantaPolicyDocuments({
      at: AT,
      download: downloadOk,
      extract: extractOk,
      list: async () => err(refused403),
      stored: emptyVantaKindFile({ kind: "policy-document", updatedAt: AT }),
      writeArtifact: writer,
    });
    const value = unwrap(result);
    expect(value.complete).toBe(false);
    expect(value.file.coverage).toHaveLength(1);
    expect(value.file.coverage[0]!.surface).toBe("knowledge-base-resources");
    expect(value.file.coverage[0]!.state).toBe("unreadable");
  });

  it("publishes an empty but complete kind when the collection is empty", async () => {
    const { writer } = collectingWriter();
    const result = await syncVantaPolicyDocuments({
      at: AT,
      download: downloadOk,
      extract: extractOk,
      list: async () => ok([]),
      stored: emptyVantaKindFile({ kind: "policy-document", updatedAt: AT }),
      writeArtifact: writer,
    });
    const value = unwrap(result);
    expect(value.complete).toBe(true);
    expect(value.file.entities).toEqual([]);
  });
});

describe("syncVantaPolicyDocuments — what the bytes turn out to be", () => {
  it("keeps every other policy when one resource is not a PDF at all", async () => {
    const { writer, written } = collectingWriter();
    const pdfBytes = new Uint8Array(readFileSync(TEXT_SAMPLE));
    const notPdf = new TextEncoder().encode("PK\u0003\u0004 a spreadsheet somebody uploaded");
    const result = await syncVantaPolicyDocuments({
      at: AT,
      download: async ({ url }) => ok(url.endsWith("sheet") ? notPdf : pdfBytes),
      extract: pdfAttachmentFrom,
      list: async () => ok([resource(), resource({ fileUrl: "https://storage.example/sheet", id: "kb-2" })]),
      stored: emptyVantaKindFile({ kind: "policy-document", updatedAt: AT }),
      writeArtifact: writer,
    });
    expect(result.isOk()).toBe(true);
    const value = unwrap(result);
    expect(value.complete).toBe(true);
    expect(written).toEqual([
      "artifacts/policy-document/kb-1/source.pdf",
      "artifacts/policy-document/kb-1/body.md",
      "artifacts/policy-document/kb-2/source.bin",
    ]);
    const byId = ({ providerId }: { providerId: string }) =>
      value.file.entities.find((entity) => entity.providerId === providerId)!.channels["manage-api"]!.detail;
    const policy = byId({ providerId: "kb-1" }) as { text: string; textState: string };
    expect(policy.textState).toBe("extracted");
    expect(policy.text).toBe("personnel and contractors");
    const sheet = byId({ providerId: "kb-2" }) as { text: null; textState: string };
    expect(sheet.textState).toBe("not-a-document");
    expect(sheet.text).toBe(null);
  });

  it("stores a non-PDF under a name its own bytes earn, never as application/pdf", async () => {
    const { writer } = collectingWriter();
    const result = await syncVantaPolicyDocuments({
      at: AT,
      ...servingBytes({ bytes: "PK\u0003\u0004 a spreadsheet somebody uploaded" }),
      list: async () => ok([resource()]),
      stored: emptyVantaKindFile({ kind: "policy-document", updatedAt: AT }),
      writeArtifact: writer,
    });
    const artifacts = unwrap(result).file.entities[0]!.channels["manage-api"]!.source!.artifacts;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.relativePath).toBe("artifacts/policy-document/kb-1/source.bin");
    expect(artifacts[0]!.mediaType).toBe("application/octet-stream");
  });

  it("says a scanned policy has no text layer, and writes no blank body beside it", async () => {
    const { writer, written } = collectingWriter();
    const result = await syncVantaPolicyDocuments({
      at: AT,
      ...servingFixture({ fixture: SCANNED_SAMPLE }),
      list: async () => ok([resource()]),
      stored: emptyVantaKindFile({ kind: "policy-document", updatedAt: AT }),
      writeArtifact: writer,
    });
    expect(written).toEqual(["artifacts/policy-document/kb-1/source.pdf"]);
    const detail = unwrap(result).file.entities[0]!.channels["manage-api"]!.detail as {
      text: null;
      textState: string;
    };
    expect(detail.textState).toBe("no-text-layer");
    expect(detail.text).toBe(null);
  });

  it("carries a real document's words through the shipped extractor", async () => {
    const { writer } = collectingWriter();
    const result = await syncVantaPolicyDocuments({
      at: AT,
      ...servingFixture({ fixture: TEXT_SAMPLE }),
      list: async () => ok([resource()]),
      stored: emptyVantaKindFile({ kind: "policy-document", updatedAt: AT }),
      writeArtifact: writer,
    });
    const detail = unwrap(result).file.entities[0]!.channels["manage-api"]!.detail as {
      text: string;
      textState: string;
    };
    expect(detail.text).toBe("personnel and contractors");
    expect(detail.textState).toBe("extracted");
  });

  it("still fails the kind for a file that CLAIMS to be a PDF and will not parse", async () => {
    const { writer } = collectingWriter();
    const result = await syncVantaPolicyDocuments({
      at: AT,
      ...servingBytes({ bytes: "%PDF-1.4\nnot actually a pdf body\n" }),
      list: async () => ok([resource()]),
      stored: emptyVantaKindFile({ kind: "policy-document", updatedAt: AT }),
      writeArtifact: writer,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().join(" ")).toContain("could not extract text from this PDF");
  });

  it("names the source .bin only when the bytes are not a PDF", () => {
    expect(policyDocumentArtifactPaths({ isPdf: false, providerId: "kb-1" }).source).toBe(
      "artifacts/policy-document/kb-1/source.bin",
    );
    expect(policyDocumentArtifactPaths({ isPdf: false, providerId: "kb-1" }).text).toBe(
      "artifacts/policy-document/kb-1/body.md",
    );
  });
});

describe("syncVantaPolicyDocuments — the ceiling is a fact about the machine, not a failed run", () => {
  it("records an oversized policy and keeps the kind, rather than failing every other policy with it", async () => {
    const { writer, written } = collectingWriter();
    const oversized = new Uint8Array(PDF_BYTES_MAX + 1);
    oversized.set(new TextEncoder().encode("%PDF-"), 0);
    const result = await syncVantaPolicyDocuments({
      at: AT,
      download: async () => ok(oversized),
      extract: pdfAttachmentFrom,
      list: async () => ok([resource()]),
      stored: emptyVantaKindFile({ kind: "policy-document", updatedAt: AT }),
      writeArtifact: writer,
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).complete).toBe(true);
    expect(written).toEqual(["artifacts/policy-document/kb-1/source.pdf"]);
    const detail = unwrap(result).file.entities[0]!.channels["manage-api"]!.detail as {
      text: null;
      textState: string;
    };
    expect(detail.textState).toBe("too-large");
    expect(detail.text).toBe(null);
  });
});

describe("syncVantaPolicyDocuments — kind is asked before size", () => {
  it("calls a huge screen recording not-a-document, never too-large, which would invite raising the ceiling", async () => {
    const { writer, written } = collectingWriter();
    const video = new Uint8Array(PDF_BYTES_MAX + 1);
    video.set(new TextEncoder().encode("\u0000\u0000\u0000 ftypmp42"), 0);
    const result = await syncVantaPolicyDocuments({
      at: AT,
      download: async () => ok(video),
      extract: pdfAttachmentFrom,
      list: async () => ok([resource()]),
      stored: emptyVantaKindFile({ kind: "policy-document", updatedAt: AT }),
      writeArtifact: writer,
    });
    expect(result.isOk()).toBe(true);
    expect(written).toEqual(["artifacts/policy-document/kb-1/source.bin"]);
    const detail = unwrap(result).file.entities[0]!.channels["manage-api"]!.detail as { textState: string };
    expect(detail.textState).toBe("not-a-document");
  });
});
