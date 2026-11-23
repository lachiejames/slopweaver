/**
 * The Linear DOCUMENT form, renderer, fold regions and ledger — the pure half of `linear document`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { linearDocumentAboveFoldCells, linearDocumentBelowFoldCells } from "../../../../outbound/linear/aboveFold.js";
import {
  confirmDocument,
  listDocumentIds,
  ownershipOfDocument,
  parseDocumentRecord,
  readDocumentRecord,
  reserveDocument,
} from "../../../../outbound/linear/documentLedger.js";
import { renderDocumentContent } from "../../../../outbound/linear/documentRender.js";
import { linearDocumentFormSchema } from "../../../../outbound/linear/documentSchema.js";
import { descriptionHash } from "../../../../outbound/linear/issueLedger.js";
import type { FreeformBlock } from "../../../../outbound/linear/types.js";
import { stateHomePaths } from "../../../../stateHome.js";

const homes: string[] = [];

afterAll(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-document-ledger-"));
  homes.push(home);
  return home;
}

const DOC_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const DESTINATION = { id: "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f", kind: "project" } as const;

const CONTENT: readonly FreeformBlock[] = [
  { kind: "para", text: "This proposes one intake queue." },
  { kind: "heading", text: "Why now" },
  { items: [{ text: "volume doubled" }], kind: "bullets" },
];

/** The messages a form's refusal carries, or none when it parses. */
function refusals({ form }: { form: unknown }): readonly string[] {
  const parsed = linearDocumentFormSchema.safeParse(form);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("the document form", () => {
  it("accepts a title, one destination and freeform blocks", () => {
    expect(refusals({ form: { content: CONTENT, fields: { destination: DESTINATION, title: "Intake" } } })).toEqual([]);
  });

  it("refuses a two-line title, naming why", () => {
    expect(refusals({ form: { content: CONTENT, fields: { destination: DESTINATION, title: "A\nB" } } })).toEqual([
      "fields.title: a document title is a single line; the newline would be dropped silently",
    ]);
  });

  it("refuses an empty body", () => {
    expect(refusals({ form: { content: [], fields: { destination: DESTINATION, title: "T" } } })).toEqual([
      "content: Too small: expected array to have >=1 items",
    ]);
  });

  it("refuses a destination kind Linear documents cannot hang off", () => {
    const form = { content: CONTENT, fields: { destination: { id: "x", kind: "cycle" }, title: "T" } };

    expect(refusals({ form })[0]).toContain("fields.destination.kind");
  });

  it("refuses an icon, a field this form does not declare", () => {
    const form = { content: CONTENT, fields: { destination: DESTINATION, icon: "Rocket", title: "T" } };

    expect(refusals({ form })[0]).toContain("icon");
  });

  it("carries the issue body's structural refusals into the content", () => {
    const form = { content: [{ kind: "para", text: "+++ fold" }], fields: { destination: DESTINATION, title: "T" } };

    expect(refusals({ form }).length).toBeGreaterThan(0);
  });
});

describe("renderDocumentContent", () => {
  it("joins the blocks one blank line apart with nothing synthesised around them", () => {
    expect(renderDocumentContent({ content: CONTENT })).toBe(
      "This proposes one intake queue.\n\n## Why now\n\n- volume doubled",
    );
  });
});

describe("the document fold", () => {
  it("holds the lead above the fold and everything from the first heading below it", () => {
    expect(linearDocumentAboveFoldCells({ content: CONTENT })).toEqual([
      { path: "content.lead", text: "This proposes one intake queue." },
    ]);
    expect(linearDocumentBelowFoldCells({ content: CONTENT })).toEqual([
      { path: "content.sections", text: "Why now\nvolume doubled" },
    ]);
  });

  it("has no lead when the page opens on a heading", () => {
    expect(linearDocumentAboveFoldCells({ content: CONTENT.slice(1) })).toEqual([]);
  });
});

describe("the document ledger", () => {
  it("reserves once, and a second reserve of the same id is taken with the first record", () => {
    const home = tempHome();

    expect(reserveDocument({ destination: DESTINATION, home, id: DOC_ID, nowIso: "t1" })).toEqual({ kind: "fresh" });
    expect(reserveDocument({ destination: DESTINATION, home, id: DOC_ID, nowIso: "t2" })).toEqual({
      kind: "taken",
      record: { destination: DESTINATION, id: DOC_ID, reservedIso: "t1" },
    });
    expect(listDocumentIds({ home })).toEqual([DOC_ID]);
  });

  it("refuses ownership of an unconfirmed reservation, then grants it once confirmed", () => {
    const home = tempHome();
    reserveDocument({ destination: DESTINATION, home, id: DOC_ID, nowIso: "t1" });

    expect(ownershipOfDocument({ home, id: DOC_ID })).toEqual({
      owned: false,
      reason: `document ${DOC_ID} was reserved at t1 but never confirmed, so whether it exists is unknown. Reconcile it with a read-back before editing.`,
    });

    confirmDocument({
      content: "stored",
      destination: DESTINATION,
      home,
      id: DOC_ID,
      nowIso: "t3",
      reservedIso: "t1",
      title: "Intake",
      updatedAt: "u1",
      url: "https://linear.test/d",
    });

    expect(ownershipOfDocument({ home, id: DOC_ID })).toEqual({
      owned: true,
      record: {
        confirmedIso: "t3",
        destination: DESTINATION,
        id: DOC_ID,
        lastSeenContentHash: descriptionHash({ description: "stored" }),
        lastSeenUpdatedAt: "u1",
        reservedIso: "t1",
        title: "Intake",
        url: "https://linear.test/d",
      },
    });
  });

  it("reads a record whose destination is unreadable as no record, so ownership fails closed", () => {
    const home = tempHome();
    reserveDocument({ destination: DESTINATION, home, id: DOC_ID, nowIso: "t1" });
    const path = join(stateHomePaths({ home }).ledgers, "linear-documents", `${DOC_ID}.json`);
    writeFileSync(
      path,
      JSON.stringify({ confirmedIso: "t2", destination: { id: "x", kind: "cycle" }, id: DOC_ID, reservedIso: "t1" }),
    );

    expect(readDocumentRecord({ home, id: DOC_ID })).toBeUndefined();
    expect(ownershipOfDocument({ home, id: DOC_ID }).owned).toBe(false);
  });

  it("lends no ownership to a page whose file carries another page's confirmed record", () => {
    const home = tempHome();
    const otherId = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
    const path = join(stateHomePaths({ home }).ledgers, "linear-documents", `${otherId}.json`);
    reserveDocument({ destination: DESTINATION, home, id: DOC_ID, nowIso: "t1" });
    writeFileSync(
      path,
      JSON.stringify({ confirmedIso: "t2", destination: DESTINATION, id: DOC_ID, reservedIso: "t1" }),
    );

    expect(readDocumentRecord({ home, id: otherId })).toBeUndefined();
    expect(ownershipOfDocument({ home, id: otherId })).toEqual({
      owned: false,
      reason:
        `slopweaver has no readable record of creating document ${otherId}, so it will not modify it. Under a ` +
        "personal API key Linear attributes every write to you, so the document itself cannot prove who made " +
        "it; this ledger is the only evidence, and it is absent.",
    });
  });

  it("parses nothing from text that is not JSON", () => {
    expect(parseDocumentRecord({ raw: "{" })).toBeUndefined();
  });
});
