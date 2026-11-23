import { describe, expect, it } from "vitest";

import { resolveVantaWriteRequest } from "../../../../atlas/vanta/writePreview.js";

/** The SHA-256 of the three bytes 01 02 03 — `printf '\001\002\003' | shasum -a 256`. */
const SHA256_OF_1_2_3 = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";

describe("resolveVantaWriteRequest", () => {
  it("resolves create-document as a JSON POST, with the auth header redacted", () => {
    const request = resolveVantaWriteRequest({
      input: {
        cadence: "P1Y",
        description: "d",
        isSensitive: false,
        reminderWindow: "P1M",
        timeSensitivity: "MOST_RECENT",
        title: "t",
      },
      kind: "create-document",
    });
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/v1/documents");
    expect(request.headers["authorization"]).toBe("Bearer <token>");
    expect(request.body.kind).toBe("json");
  });

  it("resolves upload-evidence as multipart, naming the file by its byte count and SHA-256, never its bytes", () => {
    const request = resolveVantaWriteRequest({
      input: {
        description: "a description",
        documentId: "d1",
        effectiveAtDate: "2026-01-01",
        file: { content: new Uint8Array([1, 2, 3]), mimeType: "text/plain", name: "f.txt" },
      },
      kind: "upload-evidence",
    });
    expect(request.path).toBe("/v1/documents/d1/uploads");
    expect(request.body).toEqual({
      fields: [
        `file: f.txt (text/plain, 3 bytes, sha256 ${SHA256_OF_1_2_3})`,
        "effectiveAtDate: 2026-01-01",
        "description: a description",
      ],
      kind: "multipart",
    });
  });

  // The defect this pins: the field once named only the file's name and media type, so two uploads that differed
  // in nothing but their bytes resolved to the same body and `vantaDocumentDigest` approved either.
  it("resolves two same-named uploads with different bytes to different bodies", () => {
    const upload = ({ content }: { content: Uint8Array<ArrayBuffer> }) =>
      resolveVantaWriteRequest({
        input: {
          description: null,
          documentId: "d1",
          effectiveAtDate: null,
          file: { content, mimeType: "application/pdf", name: "report.pdf" },
        },
        kind: "upload-evidence",
      });
    const original = upload({ content: new Uint8Array([1, 2, 3]) });
    const swapped = upload({ content: new Uint8Array([3, 2, 1]) });

    expect(original.body).toEqual({
      fields: [`file: report.pdf (application/pdf, 3 bytes, sha256 ${SHA256_OF_1_2_3})`],
      kind: "multipart",
    });
    expect(swapped.body).not.toEqual(original.body);
  });

  it("resolves submit-document with no body", () => {
    const request = resolveVantaWriteRequest({ input: { documentId: "d1" }, kind: "submit-document" });
    expect(request.path).toBe("/v1/documents/d1/submit");
    expect(request.body).toEqual({ kind: "none" });
  });

  it("URL-encodes the document id", () => {
    const request = resolveVantaWriteRequest({ input: { documentId: "a/b" }, kind: "submit-document" });
    expect(request.path).toBe("/v1/documents/a%2Fb/submit");
  });
});

describe("resolveVantaWriteRequest — deactivate-vulnerabilities", () => {
  it("resolves the batch as a JSON POST to Vanta's own deactivate route", () => {
    const request = resolveVantaWriteRequest({
      input: {
        updates: [{ deactivateReason: "dev-only dependency", id: "vuln-1", shouldReactivateWhenFixable: true }],
      },
      kind: "deactivate-vulnerabilities",
    });
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/v1/vulnerabilities/deactivate");
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers["authorization"]).toBe("Bearer <token>");
  });

  it("prints the exact bytes the real write would send, wrapped in the updates envelope", () => {
    const request = resolveVantaWriteRequest({
      input: {
        updates: [
          {
            deactivateReason: "not reachable in our usage",
            deactivateUntilDate: "2026-12-01T00:00:00.000Z",
            id: "vuln-1",
            shouldReactivateWhenFixable: false,
          },
        ],
      },
      kind: "deactivate-vulnerabilities",
    });
    expect(request.body).toEqual({
      json:
        '{"updates":[{"deactivateReason":"not reachable in our usage",' +
        '"deactivateUntilDate":"2026-12-01T00:00:00.000Z","id":"vuln-1","shouldReactivateWhenFixable":false}]}',
      kind: "json",
    });
  });
});

describe("resolveVantaWriteRequest — reactivate-vulnerabilities", () => {
  it("resolves the batch as a compact JSON POST of ids to Vanta's own reactivate route", () => {
    const request = resolveVantaWriteRequest({
      input: { updates: [{ id: "vuln-1" }, { id: "vuln-2" }] },
      kind: "reactivate-vulnerabilities",
    });
    expect(request).toEqual({
      body: { json: '{"updates":[{"id":"vuln-1"},{"id":"vuln-2"}]}', kind: "json" },
      headers: { authorization: "Bearer <token>", "content-type": "application/json" },
      method: "POST",
      path: "/v1/vulnerabilities/reactivate",
    });
  });
});

describe("resolveVantaWriteRequest, for the two group-membership legs", () => {
  it("resolves the add leg at Vanta's own bulk add route", () => {
    const request = resolveVantaWriteRequest({
      input: { groupId: "g1", updates: [{ id: "p1" }, { id: "p2" }] },
      kind: "add-people-to-group",
    });
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/v1/groups/g1/add-people");
    expect(request.headers["authorization"]).toBe("Bearer <token>");
    expect(request.headers["content-type"]).toBe("application/json");
  });

  it("resolves the remove leg at the remove route, same group", () => {
    const request = resolveVantaWriteRequest({
      input: { groupId: "g1", updates: [{ id: "p1" }] },
      kind: "remove-people-from-group",
    });
    expect(request.path).toBe("/v1/groups/g1/remove-people");
  });

  // The two document cases above pretty-print a body the client sends compact. These do not: both legs
  // resolve through the client's OWN serializer, so what an operator approves is the bytes the wire carries.
  it("previews the COMPACT bytes the client really sends, not a pretty-printed description of them", () => {
    const request = resolveVantaWriteRequest({
      input: { groupId: "g1", updates: [{ id: "p1" }, { id: "p2" }] },
      kind: "add-people-to-group",
    });
    expect(request.body).toEqual({ json: '{"updates":[{"id":"p1"},{"id":"p2"}]}', kind: "json" });
  });

  it("keeps the people in the order the plan named them, which the approval digest is taken over", () => {
    const request = resolveVantaWriteRequest({
      input: { groupId: "g1", updates: [{ id: "p2" }, { id: "p1" }] },
      kind: "remove-people-from-group",
    });
    expect(request.body).toEqual({ json: '{"updates":[{"id":"p2"},{"id":"p1"}]}', kind: "json" });
  });

  it("encodes a group id rather than letting it change the route it previews", () => {
    const request = resolveVantaWriteRequest({
      input: { groupId: "a/b", updates: [{ id: "p1" }] },
      kind: "add-people-to-group",
    });
    expect(request.path).toBe("/v1/groups/a%2Fb/add-people");
  });
});
