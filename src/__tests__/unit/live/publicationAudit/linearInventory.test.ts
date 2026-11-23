/**
 * The publication audit's Linear inventory, read off a real ledger directory: each family's fallible lister, and
 * `readLinearInventory` leaving out a family that carries no authored text. Synthetic workspace only.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, unwrap, unwrapErr } from "../../../../lib/result.js";
import { LinearLiveErrors } from "../../../../live/linear/errors.js";
import { readLinearInventory } from "../../../../live/publicationAudit/linearInventory.js";
import { readLinearPublications } from "../../../../live/publicationAudit/linearReader.js";
import { LINEAR_PUBLICATION_GAPS, type LinearPublicationSeam } from "../../../../live/publicationAudit/linearSeam.js";
import { type AppendRecord, listAppendRecords } from "../../../../outbound/linear/commentLedger.js";
import { listDocumentRecords } from "../../../../outbound/linear/documentLedger.js";
import { type IssueRecord, listIssueRecords } from "../../../../outbound/linear/issueLedger.js";
import { listObjectRecords, type ProjectRecord } from "../../../../outbound/linear/projectLedger.js";
import { stateHomePaths } from "../../../../stateHome.js";

const RESERVED = "2026-11-19T23:59:00.000Z";
const CONFIRMED = "2026-11-20T00:00:00.000Z";

const ISSUE_ID = "00000000-0000-4000-8000-000000000001";
const SECOND_ISSUE_ID = "00000000-0000-4000-8000-000000000002";
const THIRD_ISSUE_ID = "00000000-0000-4000-8000-000000000003";
const COMMENT_ID = "00000000-0000-4000-8000-00000000c001";
const PROJECT_ID = "00000000-0000-4000-8000-00000000p001";

const PROJECT_URL = "https://linear.app/acme/project/fixture-project-abc123";

/** A confirmed issue reservation carrying its identifier. */
const confirmedIssue = ({ id, identifier }: { id: string; identifier: string }): IssueRecord => ({
  confirmedIso: CONFIRMED,
  id,
  identifier,
  reservedIso: RESERVED,
});

/** A confirmed append reservation hanging off a subject. */
const confirmedAppend = ({ id, subject }: { id: string; subject: string }): AppendRecord => ({
  confirmedIso: CONFIRMED,
  id,
  reservedIso: RESERVED,
  subject,
});

/** A seam that answers every read `NOT_FOUND` and records each one asked. */
const recordingSeam = (): LinearPublicationSeam & { readonly asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    readObject: async ({ address }) => {
      asked.push(`object ${address}`);
      return err(LinearLiveErrors.notFound({ identity: address, kind: "issue" }));
    },
    readProjectUpdates: async ({ address }) => {
      asked.push(`updates ${address}`);
      return err(LinearLiveErrors.notFound({ identity: address, kind: "project" }));
    },
  };
};

describe("the Linear ledger listers", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "linear-ledgers-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Write one raw ledger file under a family's directory. */
  const writeRow = ({ family, name, contents }: { family: string; name: string; contents: string }): void => {
    const directory = join(stateHomePaths({ home }).ledgers, family);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, name), contents);
  };

  it("lists nothing, and no unreadable row, when the ledger was never written", () => {
    const listed = listIssueRecords({ home });
    expect(listed.isOk()).toBe(true);
    expect(unwrap(listed)).toEqual({ records: [], unreadableRows: 0 });
  });

  it("lists a good issue row", () => {
    const record = confirmedIssue({ id: ISSUE_ID, identifier: "ABC-1" });
    writeRow({ contents: JSON.stringify(record), family: "linear-issues", name: `${ISSUE_ID}.json` });
    expect(unwrap(listIssueRecords({ home }))).toEqual({ records: [record], unreadableRows: 0 });
  });

  it("counts a malformed file and a file filed under another id as unreadable, keeping the good row", () => {
    const record = confirmedIssue({ id: ISSUE_ID, identifier: "ABC-1" });
    writeRow({ contents: JSON.stringify(record), family: "linear-issues", name: `${ISSUE_ID}.json` });
    writeRow({ contents: "{ not json", family: "linear-issues", name: `${SECOND_ISSUE_ID}.json` });
    writeRow({ contents: JSON.stringify(record), family: "linear-issues", name: `${THIRD_ISSUE_ID}.json` });
    expect(unwrap(listIssueRecords({ home }))).toEqual({ records: [record], unreadableRows: 2 });
  });

  it("refuses rather than reading as empty when the ledger path cannot be listed", () => {
    mkdirSync(stateHomePaths({ home }).ledgers, { recursive: true });
    writeFileSync(join(stateHomePaths({ home }).ledgers, "linear-issues"), "a file where a directory belongs");
    expect(unwrapErr(listIssueRecords({ home })).code).toBe("LEDGER_UNREADABLE");
  });

  it("lists a good append, object and document row", () => {
    const append = confirmedAppend({ id: COMMENT_ID, subject: "ABC-1" });
    const project: ProjectRecord = {
      confirmedIso: CONFIRMED,
      id: PROJECT_ID,
      name: "Fixture project",
      reservedIso: RESERVED,
      url: PROJECT_URL,
    };
    const document = {
      confirmedIso: CONFIRMED,
      destination: { id: ISSUE_ID, kind: "issue" as const },
      id: SECOND_ISSUE_ID,
      reservedIso: RESERVED,
      title: "Fixture document",
      url: "https://linear.app/acme/document/fixture-document-abc123",
    };
    writeRow({ contents: JSON.stringify(append), family: "linear-comments", name: `${COMMENT_ID}.json` });
    writeRow({ contents: JSON.stringify(project), family: "linear-projects", name: `${PROJECT_ID}.json` });
    writeRow({ contents: JSON.stringify(document), family: "linear-documents", name: `${SECOND_ISSUE_ID}.json` });
    expect(unwrap(listAppendRecords({ home, kind: "linear-comments" }))).toEqual({
      records: [append],
      unreadableRows: 0,
    });
    expect(unwrap(listObjectRecords({ home, kind: "linear-projects" }))).toEqual({
      records: [project],
      unreadableRows: 0,
    });
    expect(unwrap(listDocumentRecords({ home }))).toEqual({ records: [document], unreadableRows: 0 });
  });

  it("skips a relation row without a gap: an edge carries no authored text", async () => {
    writeRow({
      contents: JSON.stringify(confirmedAppend({ id: COMMENT_ID, subject: "ABC-1" })),
      family: "linear-relations",
      name: `${COMMENT_ID}.json`,
    });
    const seam = recordingSeam();
    const read = await readLinearPublications({ inventory: readLinearInventory({ home }), seam });
    expect(read.coverage).toEqual({
      attachmentsNotSwept: 0,
      door: "linear",
      gaps: [LINEAR_PUBLICATION_GAPS.attachmentWritesNotInventoried],
      objects: 0,
      state: "partial",
      texts: 0,
    });
    expect(seam.asked).toEqual([]);
  });
});
