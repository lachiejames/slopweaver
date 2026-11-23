/**
 * The irreversible half of `linear document`, driven directly: what a lost mutation response settles to.
 *
 * A create's id was freshly reserved, so a page found there proves the create landed. An update's page existed
 * before, so finding it proves nothing; only the stored title and content being exactly what was sent does.
 * Every edge is a plain injected function. No mocks.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterAll, describe, expect, it } from "vitest";

import { parseLinearDocumentForm } from "../../../../../cli/commands/linear/documentCore.js";
import type { LinearDocumentWriteDeps } from "../../../../../cli/commands/linear/documentDeps.js";
import {
  type DocumentWriteContext,
  documentUpdatePrecheck,
  performDocumentWrite,
} from "../../../../../cli/commands/linear/documentWrite.js";
import type { LinearDocumentWriteApi, ReadLinearDocument } from "../../../../../corpus/linear/writeDocument.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import { readDocumentRecord } from "../../../../../outbound/linear/documentLedger.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { emptyMentionResolution } from "../../../../linearMentionFixtures.js";

const homes: string[] = [];

afterAll(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-document-write-"));
  homes.push(home);
  return home;
}

const DOC_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const FORM = unwrap(
  parseLinearDocumentForm({
    raw: JSON.stringify({
      content: [{ kind: "para", text: "One queue." }],
      fields: { destination: { id: "ENG-42", kind: "issue" }, title: "Intake" },
    }),
  }),
);

function stored({ content }: { content: string }): ReadLinearDocument {
  return {
    content,
    id: DOC_ID,
    initiativeId: undefined,
    issueId: "i1",
    projectId: undefined,
    slugId: "s",
    title: "Intake",
    updatedAt: "u1",
    url: "https://linear.test/d",
  };
}

const DEPS: LinearDocumentWriteDeps = {
  bareRefContext: () => ({ repos: [] }),
  doorLedger: memoryDoorLedger().port,
  env: () => undefined,
  err: () => undefined,
  makeApi: () => {
    throw new Error("the context carries its own api");
  },
  nowIso: () => "2026-10-22T00:00:00.000Z",
  out: () => undefined,
  previewMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
  readForm: () => "",
  resolveMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
  resolveToken: () => "lin_api_fake",
};

const ingestError: IngestError = {
  kind: "http",
  message: "socket hang up",
  operation: "linear.documentUpdate",
  provider: "linear",
};

/** An API whose mutation always loses its response, and whose read answers with `found`. */
function lostResponse({ found }: { found: ReadLinearDocument | undefined }): LinearDocumentWriteApi {
  const lost = errAsync(ingestError);
  return {
    createDocument: () => lost,
    deleteDocument: () => okAsync(true),
    readDocument: () => okAsync(found),
    updateDocument: () => lost,
  };
}

function ctxOf({
  api,
  home,
  verb,
}: {
  api: LinearDocumentWriteApi;
  home: string;
  verb: "create" | "update";
}): DocumentWriteContext {
  return { api, deps: DEPS, form: FORM, home, id: DOC_ID, verb };
}

describe("performDocumentWrite after a lost response", () => {
  it("settles a create as landed when the page is at the reserved id, and confirms the ledger", async () => {
    const home = tempHome();
    const ctx = ctxOf({ api: lostResponse({ found: stored({ content: "One queue." }) }), home, verb: "create" });

    const outcome = await performDocumentWrite({ ctx, priorUpdatedAt: undefined, reservedIso: undefined });

    expect(outcome.kind).toBe("landedAfterError");
    expect(readDocumentRecord({ home, id: DOC_ID })!.confirmedIso).toBe("2026-10-22T00:00:00.000Z");
  });

  it("settles an update as indeterminate when the stored content is not exactly what was sent", async () => {
    const home = tempHome();
    const ctx = ctxOf({
      api: lostResponse({ found: stored({ content: "the page as it was" }) }),
      home,
      verb: "update",
    });

    const outcome = await performDocumentWrite({ ctx, priorUpdatedAt: "u0", reservedIso: "t0" });

    expect(outcome).toEqual({ kind: "indeterminate", reason: "socket hang up" });
  });

  it("settles an update as landed when the stored title and content are exactly what was sent", async () => {
    const home = tempHome();
    const ctx = ctxOf({ api: lostResponse({ found: stored({ content: "One queue." }) }), home, verb: "update" });

    const outcome = await performDocumentWrite({ ctx, priorUpdatedAt: "u0", reservedIso: "t0" });

    expect(outcome.kind).toBe("landedAfterError");
    expect(readDocumentRecord({ home, id: DOC_ID })!.reservedIso).toBe("t0");
  });

  it("never settles an update on a read-back that answers with another page's id", async () => {
    const home = tempHome();
    const elsewhere = { ...stored({ content: "One queue." }), id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b" };
    const ctx = ctxOf({ api: lostResponse({ found: elsewhere }), home, verb: "update" });

    const outcome = await performDocumentWrite({ ctx, priorUpdatedAt: "u0", reservedIso: "t0" });

    expect(outcome).toEqual({ kind: "indeterminate", reason: "socket hang up" });
  });

  it("never confirms a create whose reserved id holds a page with another title", async () => {
    const home = tempHome();
    const foreign = { ...stored({ content: "One queue." }), title: "Somebody else's page" };
    const ctx = ctxOf({ api: lostResponse({ found: foreign }), home, verb: "create" });

    const outcome = await performDocumentWrite({ ctx, priorUpdatedAt: undefined, reservedIso: undefined });

    expect(outcome).toEqual({ kind: "indeterminate", reason: "socket hang up" });
    expect(readDocumentRecord({ home, id: DOC_ID })!.confirmedIso).toBeUndefined();
  });
});

describe("performDocumentWrite after an acknowledged mutation", () => {
  it("reports unconfirmed when the read-back answers with another page's id", async () => {
    const home = tempHome();
    const elsewhere = { ...stored({ content: "One queue." }), id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b" };
    const api: LinearDocumentWriteApi = {
      ...lostResponse({ found: elsewhere }),
      createDocument: () => okAsync({ id: DOC_ID }),
    };

    const outcome = await performDocumentWrite({
      ctx: ctxOf({ api, home, verb: "create" }),
      priorUpdatedAt: undefined,
      reservedIso: undefined,
    });

    expect(outcome).toEqual({ id: DOC_ID, kind: "unconfirmed" });
  });
});

describe("documentUpdatePrecheck", () => {
  it("clears a create without reading anything", async () => {
    const ctx = ctxOf({ api: lostResponse({ found: undefined }), home: tempHome(), verb: "create" });

    expect(await documentUpdatePrecheck({ ctx })).toEqual({
      kind: "clear",
      priorUpdatedAt: undefined,
      reservedIso: undefined,
    });
  });
});
