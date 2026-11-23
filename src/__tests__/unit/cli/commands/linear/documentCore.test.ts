/**
 * The pure core of `linear document` — args, the intent id, the provider inputs, the door request — and the
 * write lane's read-back shaping.
 */
import { describe, expect, it } from "vitest";

import {
  documentCreateInputFor,
  documentDoorRequestFor,
  documentIntentId,
  documentUpdateInputFor,
  parseLinearDocumentArgs,
  parseLinearDocumentForm,
} from "../../../../../cli/commands/linear/documentCore.js";
import { linearVerbErrorLines } from "../../../../../cli/commands/linear/errors.js";
import { readDocumentFrom } from "../../../../../corpus/linear/writeDocument.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { LinearDocumentForm } from "../../../../../outbound/linear/documentTypes.js";

const DOC_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

function formOf({
  title = "Intake",
  kind = "issue",
  id = "ENG-42",
}: { title?: string; kind?: string; id?: string } = {}): LinearDocumentForm {
  return unwrap(
    parseLinearDocumentForm({
      raw: JSON.stringify({
        content: [{ kind: "para", text: "One queue." }],
        fields: { destination: { id, kind }, title },
      }),
    }),
  );
}

describe("parseLinearDocumentArgs", () => {
  it("parses an update with its document id", () => {
    const args = unwrap(parseLinearDocumentArgs({ argv: ["update", "--form", "-", "--document-id", DOC_ID] }));

    expect(args.verb).toBe("update");
    expect(args.documentId).toBe(DOC_ID);
  });

  it("refuses an update without a document id, and one that is not a UUID v4", () => {
    const missing = unwrapErr(parseLinearDocumentArgs({ argv: ["update", "--form", "-"] }));
    const traversal = unwrapErr(parseLinearDocumentArgs({ argv: ["update", "--form", "-", "--document-id", "../x"] }));

    expect(linearVerbErrorLines({ error: missing }).join("\n")).toContain(
      "--document-id <uuid> is required for update",
    );
    expect(linearVerbErrorLines({ error: traversal }).join("\n")).toContain("--document-id must be a UUID v4");
  });

  it("refuses a sub-verb it does not have", () => {
    expect(unwrapErr(parseLinearDocumentArgs({ argv: ["delete", "--form", "-"] })).code).toBe("USAGE");
  });
});

describe("documentIntentId", () => {
  it("is stable for one form and moves with the title", () => {
    expect(documentIntentId({ form: formOf() })).toBe(documentIntentId({ form: formOf() }));
    expect(documentIntentId({ form: formOf({ title: "Other" }) })).not.toBe(documentIntentId({ form: formOf() }));
    expect(documentIntentId({ form: formOf() })).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });
});

describe("the provider inputs", () => {
  it("sends the destination's one id field on create", () => {
    expect(documentCreateInputFor({ form: formOf() })).toEqual({
      content: "One queue.",
      issueId: "ENG-42",
      title: "Intake",
    });
    expect(documentCreateInputFor({ form: formOf({ id: "t1", kind: "team" }) })).toEqual({
      content: "One queue.",
      teamId: "t1",
      title: "Intake",
    });
  });

  it("sends only the title and content on update", () => {
    expect(documentUpdateInputFor({ form: formOf() })).toEqual({ content: "One queue.", title: "Intake" });
  });
});

describe("documentDoorRequestFor", () => {
  it("names the verb and destination, and counts only a create as a work item", () => {
    const destination = { id: "ENG-42", kind: "issue" } as const;
    const create = documentDoorRequestFor({ destination, home: "/h", id: DOC_ID, verb: "create" });
    const update = documentDoorRequestFor({ destination, home: "/h", id: DOC_ID, verb: "update" });

    expect(create.action).toEqual({ kind: "verb", noun: "linear", verb: "document create" });
    expect(create.artifact).toEqual({ destination: "issue:ENG-42", id: DOC_ID });
    expect(create.meta.createsWorkItem).toBe(true);
    expect(update.meta.createsWorkItem).toBe(false);
  });
});

describe("readDocumentFrom", () => {
  const node = {
    content: "",
    id: DOC_ID,
    initiative: null,
    issue: { id: "i1" },
    project: null,
    slugId: "s",
    title: "Intake",
    updatedAt: "u",
    url: "https://linear.test/d",
  };

  it("keeps an empty page distinct from an absent one and reads the parent", () => {
    expect(readDocumentFrom({ data: { document: node } })).toEqual({
      content: "",
      id: DOC_ID,
      initiativeId: undefined,
      issueId: "i1",
      projectId: undefined,
      slugId: "s",
      title: "Intake",
      updatedAt: "u",
      url: "https://linear.test/d",
    });
    expect(readDocumentFrom({ data: { document: { ...node, content: null } } })!.content).toBeUndefined();
  });

  it("reads a missing document as undefined", () => {
    expect(readDocumentFrom({ data: { document: null } })).toBeUndefined();
  });
});
