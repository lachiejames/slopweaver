/**
 * What the Notion write transport's privacy guard judges in one request, and the verdict over it. Synthetic rules,
 * terms and organisation throughout: `quillfeather` is the private person term, `zorblatt` the forbidden word.
 */
import { describe, expect, it } from "vitest";

import { type ForbiddenIdentifierRules, identifierDigest } from "../../../../hygiene/identifierScan.js";
import { parsePrivateTerms } from "../../../../hygiene/privateTerms.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  isNotionReadRequest,
  isNotionStructuralKey,
  NOTION_READ_ROUTES,
  NOTION_WORKSPACE_DESTINATION,
  notionFormLeaves,
  notionJsonWriteLeaves,
  notionRequestCommand,
  notionUploadRequest,
  notionWriteFindings,
  notionWriteRequest,
} from "../../../../outbound/notion/writePrivacyPayload.js";
import type { PrivacyPolicy } from "../../../../outbound/privacyCheck.js";

/** The word `zorblatt` is forbidden. */
const RULES: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [],
    exactIds: [],
    exemptTicketReferences: [],
    spanHeads: [],
    substringCi: [],
    substringCs: [],
    teamKeys: [],
    wordCi: [identifierDigest({ text: "zorblatt" })],
    wordCs: [],
  },
  providerLocations: [],
};

const POLICY: PrivacyPolicy = {
  denylist: [],
  identifierRules: RULES,
  privateTerms: unwrap(
    parsePrivateTerms({ text: "class\tflags\tpattern\tsource\nperson\ti\tquillfeather\tsynthetic\n" }),
  ),
};

const API = "https://api.notion.com";
const ID = "3c300000-0000-817c-a1d1-da9a9b003e05";
const bytes = ({ text }: { text: string }): Uint8Array => new TextEncoder().encode(text);

describe("isNotionReadRequest", () => {
  it("lists exactly the write lane's five reads", () => {
    expect(NOTION_READ_ROUTES.map((route) => `${route.method} ${route.name}`)).toEqual([
      "GET pages.retrieve",
      "GET pages.retrieveMarkdown",
      "GET blocks.children.list",
      "GET fileUploads.retrieve",
      "GET users.me",
    ]);
  });

  it("matches a read on its method AND its path", () => {
    expect(
      [
        `/v1/pages/${ID}`,
        `/v1/pages/${ID}/markdown`,
        `/v1/blocks/${ID}/children?page_size=100`,
        `/v1/file_uploads/${ID}`,
        "/v1/users/me",
      ].map((path) => isNotionReadRequest({ method: "GET", url: `${API}${path}` })),
    ).toEqual([true, true, true, true, true]);
  });

  it("judges a write on a read's path, an unlisted read, a missing method and an unparseable address", () => {
    expect(
      [
        { method: "PATCH", url: `${API}/v1/pages/${ID}` },
        { method: "DELETE", url: `${API}/v1/blocks/${ID}` },
        { method: "POST", url: `${API}/v1/users/me` },
        { method: "GET", url: `${API}/v1/comments` },
        { method: undefined, url: `${API}/v1/pages/${ID}` },
        { method: "GET", url: "not a url" },
      ].map(isNotionReadRequest),
    ).toEqual([false, false, false, false, false, false]);
  });

  it("reads a lowercase method the same as its uppercase form", () => {
    expect(isNotionReadRequest({ method: "get", url: `${API}/v1/pages/${ID}` })).toBe(true);
  });
});

describe("notionRequestCommand", () => {
  it("names a known write by its SDK method, carrying no id", () => {
    expect(
      [
        { method: "POST", url: `${API}/v1/pages` },
        { method: "PATCH", url: `${API}/v1/pages/${ID}` },
        { method: "PATCH", url: `${API}/v1/pages/${ID}/markdown` },
        { method: "POST", url: `${API}/v1/pages/${ID}/move` },
        { method: "PATCH", url: `${API}/v1/blocks/${ID}/children` },
        { method: "DELETE", url: `${API}/v1/blocks/${ID}` },
        { method: "POST", url: `${API}/v1/file_uploads` },
        { method: "POST", url: `${API}/v1/file_uploads/${ID}/send` },
      ].map(notionRequestCommand),
    ).toEqual([
      "notion pages.create",
      "notion pages.update",
      "notion pages.updateMarkdown",
      "notion pages.move",
      "notion blocks.children.append",
      "notion blocks.delete",
      "notion fileUploads.create",
      "notion fileUploads.send",
    ]);
  });

  it("names an unlisted write by method and path, every id segment replaced", () => {
    expect(notionRequestCommand({ method: "post", url: `${API}/v1/comments/${ID}/replies` })).toBe(
      "notion POST /v1/comments/{id}/replies",
    );
    expect(notionRequestCommand({ method: undefined, url: `${API}/v1/databases/${ID}` })).toBe(
      "notion UNSPECIFIED /v1/databases/{id}",
    );
    expect(notionRequestCommand({ method: "POST", url: "::" })).toBe("notion POST an unparseable address");
  });
});

describe("isNotionStructuralKey", () => {
  it("skips a token, auth, an id and any key ending _id, and nothing else", () => {
    expect(
      ["token", "auth", "id", "page_id", "file_upload_id", "title", "markdown", "identity", "idea"].map((key) =>
        isNotionStructuralKey({ key }),
      ),
    ).toEqual([true, true, true, true, true, false, false, false, false]);
  });
});

describe("notionJsonWriteLeaves", () => {
  it("collects every string leaf at any depth under its locus, skipping structural keys", () => {
    const body = JSON.stringify({
      icon: { emoji: "a" },
      markdown: "body text",
      parent: { page_id: ID },
      properties: { title: { title: [{ text: { content: "the title" } }] } },
    });
    expect(unwrap(notionJsonWriteLeaves({ body, command: "notion pages.create" }))).toEqual([
      { locus: "notion pages.create icon.emoji", text: "a" },
      { locus: "notion pages.create markdown", text: "body text" },
      { locus: "notion pages.create properties.title.title[0].text.content", text: "the title" },
    ]);
  });

  it("walks an object under a key ending _id, skipping only an id string sitting directly under one", () => {
    const body = JSON.stringify({
      initial_data_source: { properties: { Ticket: { type: "unique_id", unique_id: { prefix: "quillfeather" } } } },
      parent: { page_id: ID },
    });
    expect(unwrap(notionJsonWriteLeaves({ body, command: "notion POST /v1/databases" }))).toEqual([
      { locus: "notion POST /v1/databases initial_data_source.properties.Ticket.type", text: "unique_id" },
      {
        locus: "notion POST /v1/databases initial_data_source.properties.Ticket.unique_id.prefix",
        text: "quillfeather",
      },
    ]);
  });

  it("judges nothing for a request with no body", () => {
    expect(unwrap(notionJsonWriteLeaves({ body: undefined, command: "notion blocks.delete" }))).toEqual([]);
  });

  it("refuses a body that is not JSON rather than passing it unjudged", () => {
    const refused = unwrapErr(notionJsonWriteLeaves({ body: "{ not json", command: "notion pages.create" }));
    expect(refused.code).toBe("BODY_NOT_JSON");
    expect(refused.message).toBe("notion pages.create: a request body that is not JSON, so it cannot be judged");
  });
});

describe("notionFormLeaves", () => {
  it("judges string fields, each file's name and type, and a text-like file's bytes", () => {
    const leaves = notionFormLeaves({
      command: "notion fileUploads.send",
      form: {
        fields: [
          { field: "part_number", value: "1" },
          { field: "file_upload_id", value: ID },
        ],
        files: [{ bytes: bytes({ text: "notes body" }), field: "file", filename: "notes.TXT", type: "text/plain" }],
      },
    });
    expect(unwrap(leaves)).toEqual([
      { locus: "notion fileUploads.send part_number", text: "1" },
      { locus: "notion fileUploads.send file.filename", text: "notes.TXT" },
      { locus: "notion fileUploads.send file.type", text: "text/plain" },
      { locus: "notion fileUploads.send file", text: "notes body" },
    ]);
  });

  it("leaves an image's bytes unread, judging only its name and type", () => {
    const leaves = notionFormLeaves({
      command: "notion fileUploads.send",
      form: {
        fields: [],
        files: [{ bytes: bytes({ text: "quillfeather" }), field: "file", filename: "hero.png", type: "image/png" }],
      },
    });
    expect(unwrap(leaves).map(({ locus }) => locus)).toEqual([
      "notion fileUploads.send file.filename",
      "notion fileUploads.send file.type",
    ]);
  });

  it("refuses a text-like file that is not valid UTF-8", () => {
    const leaves = notionFormLeaves({
      command: "notion fileUploads.send",
      form: {
        fields: [],
        files: [{ bytes: new Uint8Array([0xff, 0xfe, 0xfd]), field: "file", filename: "a.md", type: "text/markdown" }],
      },
    });
    expect(unwrapErr(leaves).code).toBe("TEXT_NOT_UTF8");
    expect(unwrapErr(leaves).message).toBe(
      "notion fileUploads.send file: a text-like file that is not valid UTF-8, so it cannot be judged",
    );
  });
});

describe("notionWriteFindings", () => {
  it("refuses a private term at the leaf that carries it", () => {
    const findings = notionWriteFindings({
      leaves: [
        { locus: "notion pages.create markdown", text: "clean prose" },
        { locus: "notion pages.create icon.emoji", text: "ask Quillfeather" },
      ],
      policy: POLICY,
    });
    expect(findings.map(({ message }) => message)).toEqual([
      "notion pages.create icon.emoji line 1: a private person term (redacted here) — remove or generalise it, or if it is not private ask the chair to narrow that terms row",
    ]);
  });

  it("forgives a forbidden identifier, since the destination is the installation's own workspace", () => {
    expect(NOTION_WORKSPACE_DESTINATION.identifierAudience).toBe("installation-workspace");
    expect(
      notionWriteFindings({ leaves: [{ locus: "notion pages.create markdown", text: "zorblatt" }], policy: POLICY }),
    ).toEqual([]);
  });

  it("still refuses a credential and installation state in the workspace", () => {
    const findings = notionWriteFindings({
      leaves: [
        { locus: "notion pages.create markdown", text: `token ghp_${"b".repeat(30)}` },
        { locus: "notion pages.create icon.emoji", text: "read /Users/fixture-person/notes" },
      ],
      policy: POLICY,
    });
    expect(findings.map(({ code, locus }) => `${code} ${locus}`)).toEqual([
      "HYGIENE notion pages.create markdown",
      "INSTALLATION_STATE notion pages.create icon.emoji",
    ]);
  });
});

describe("notionWriteRequest", () => {
  it("answers undefined for a read, so no policy is ever loaded for one", async () => {
    expect(await notionWriteRequest({ body: undefined, method: "GET", url: `${API}/v1/users/me` })).toBe(undefined);
  });

  it("judges a JSON write's serialised body and hands the dead-host walk the same string", async () => {
    const body = JSON.stringify({ markdown: "hello" });
    const request = await notionWriteRequest({ body, method: "PATCH", url: `${API}/v1/pages/${ID}/markdown` });
    expect(request!.command).toBe("notion pages.updateMarkdown");
    expect(request!.payload).toBe(body);
    expect(unwrap(request!.leaves)).toEqual([{ locus: "notion pages.updateMarkdown markdown", text: "hello" }]);
  });

  it("reads a multipart body's file into bytes for both guards, leaving the form readable for the send", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes({ text: "plain notes" }))], { type: "text/plain" }), "n.txt");
    const url = `${API}/v1/file_uploads/${ID}/send`;
    const first = await notionWriteRequest({ body: form, method: "POST", url });
    const again = await notionWriteRequest({ body: form, method: "POST", url });
    expect(unwrap(first!.leaves).map(({ text }) => text)).toEqual(["n.txt", "text/plain", "plain notes"]);
    expect(unwrap(again!.leaves)).toEqual(unwrap(first!.leaves));
  });
});

describe("notionUploadRequest", () => {
  it("judges a whole upload's name, type and text bytes under one command", () => {
    const request = notionUploadRequest({
      bytes: bytes({ text: "quillfeather notes" }),
      contentType: "text/plain",
      filename: "n.txt",
    });
    expect(request.command).toBe("notion attach upload");
    expect(unwrap(request.leaves)).toEqual([
      { locus: "notion attach upload file.filename", text: "n.txt" },
      { locus: "notion attach upload file.type", text: "text/plain" },
      { locus: "notion attach upload file", text: "quillfeather notes" },
    ]);
  });
});
