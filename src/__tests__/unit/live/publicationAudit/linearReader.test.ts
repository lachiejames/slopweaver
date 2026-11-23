import { describe, expect, it } from "vitest";

import { err, ok } from "../../../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "../../../../live/linear/errors.js";
import type { LinearInventory, LinearInventoryFamily } from "../../../../live/publicationAudit/linearInventory.js";
import { readLinearPublications } from "../../../../live/publicationAudit/linearReader.js";
import {
  LINEAR_PUBLICATION_GAPS,
  LinearPublicationReadErrors,
  type LinearPublicationSeam,
} from "../../../../live/publicationAudit/linearSeam.js";
import type { AppendRecord } from "../../../../outbound/linear/commentLedger.js";
import type { IssueRecord } from "../../../../outbound/linear/issueLedger.js";
import { LedgerListingErrors } from "../../../../outbound/linear/ledgerListing.js";
import type { ProjectRecord } from "../../../../outbound/linear/projectLedger.js";

const RESERVED = "2026-11-19T23:59:00.000Z";
const CONFIRMED = "2026-11-20T00:00:00.000Z";

const ISSUE_ID = "00000000-0000-4000-8000-000000000001";
const SECOND_ISSUE_ID = "00000000-0000-4000-8000-000000000002";
const THIRD_ISSUE_ID = "00000000-0000-4000-8000-000000000003";
const COMMENT_ID = "00000000-0000-4000-8000-00000000c001";
const NEIGHBOUR_ID = "00000000-0000-4000-8000-00000000c002";
const PROJECT_ID = "00000000-0000-4000-8000-00000000p001";
const UPDATE_ID = "00000000-0000-4000-8000-00000000u001";
const OTHER_UPDATE_ID = "00000000-0000-4000-8000-00000000u002";

const ISSUE_URL = "https://linear.app/acme/issue/ABC-1/fixture-title";
const PROJECT_URL = "https://linear.app/acme/project/fixture-project-abc123";

/** The one gap every Linear read carries: `linear attach upload` keeps no per-object ledger. */
const ATTACH = LINEAR_PUBLICATION_GAPS.attachmentWritesNotInventoried;

/** A listed family holding these records. */
const listing = <T>({
  records,
  unreadableRows = 0,
}: {
  records: readonly T[];
  unreadableRows?: number;
}): LinearInventoryFamily<T> => ok({ records, unreadableRows });

/** An inventory with every family listed empty, overridden per test. */
const inventoryWith = (over: Partial<LinearInventory>): LinearInventory => ({
  comments: listing<AppendRecord>({ records: [] }),
  documents: listing({ records: [] }),
  initiativeUpdates: listing<AppendRecord>({ records: [] }),
  initiatives: listing<ProjectRecord>({ records: [] }),
  issues: listing<IssueRecord>({ records: [] }),
  labels: listing<AppendRecord>({ records: [] }),
  milestones: listing<ProjectRecord>({ records: [] }),
  projectUpdates: listing<AppendRecord>({ records: [] }),
  projects: listing<ProjectRecord>({ records: [] }),
  ...over,
});

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

/** A seam answering from tables keyed by address; a missing address is `NOT_FOUND`. Records every call. */
const seamOf = ({
  objects = {},
  updates = {},
  failing = {},
}: {
  objects?: Readonly<Record<string, unknown>>;
  updates?: Readonly<Record<string, unknown>>;
  failing?: Readonly<Record<string, LinearLiveError>>;
}): LinearPublicationSeam & { readonly asked: string[] } => {
  const asked: string[] = [];
  const readObject: LinearPublicationSeam["readObject"] = async ({ address, comments }) => {
    asked.push(`object ${address} comments=${String(comments)}`);
    const failure = failing[address];
    if (failure !== undefined) {
      return err(failure);
    }
    if (!(address in objects)) {
      return err(LinearLiveErrors.notFound({ identity: address, kind: "issue" }));
    }
    return ok(objects[address]);
  };
  const readProjectUpdates: LinearPublicationSeam["readProjectUpdates"] = async ({ address }) => {
    asked.push(`updates ${address}`);
    if (!(address in updates)) {
      return err(LinearLiveErrors.notFound({ identity: address, kind: "project" }));
    }
    return ok(updates[address]);
  };
  return { asked, readObject, readProjectUpdates };
};

/** A comments connection holding these nodes. */
const connectionOf = ({ nodes, hasNextPage = false }: { nodes: readonly unknown[]; hasNextPage?: boolean }) => ({
  nodes,
  pageInfo: { hasNextPage, hasPreviousPage: false },
});

describe("readLinearPublications", () => {
  it("judges a confirmed issue's title and description, addressed by identifier and linked by its live url", async () => {
    const seam = seamOf({
      objects: {
        "ABC-1": { description: "Fixture description", id: ISSUE_ID, title: "Fixture title", url: ISSUE_URL },
      },
    });
    const read = await readLinearPublications({
      inventory: inventoryWith({
        issues: listing({ records: [confirmedIssue({ id: ISSUE_ID, identifier: "ABC-1" })] }),
      }),
      seam,
    });
    expect(read.texts).toEqual([
      {
        door: "linear",
        field: "title",
        link: ISSUE_URL,
        linkCarriesNoText: false,
        objectKey: `issue ${ISSUE_ID}`,
        text: "Fixture title",
      },
      {
        door: "linear",
        field: "description",
        link: ISSUE_URL,
        linkCarriesNoText: false,
        objectKey: `issue ${ISSUE_ID}`,
        text: "Fixture description",
      },
    ]);
    expect(read.coverage).toEqual({
      attachmentsNotSwept: 0,
      door: "linear",
      gaps: [ATTACH],
      objects: 1,
      state: "partial",
      texts: 2,
    });
    expect(seam.asked).toEqual(["object ABC-1 comments=false"]);
  });

  it("judges ONLY the fleet's own comment, by exact id, never the neighbour on the same issue", async () => {
    const seam = seamOf({
      objects: {
        "ABC-1": {
          comments: connectionOf({
            nodes: [
              { body: "a neighbour's own words", id: NEIGHBOUR_ID, url: `${ISSUE_URL}#comment-2` },
              { body: "the fleet's comment", id: COMMENT_ID, url: `${ISSUE_URL}#comment-1` },
            ],
          }),
          id: ISSUE_ID,
          title: "Not ours",
          url: ISSUE_URL,
        },
      },
    });
    const read = await readLinearPublications({
      inventory: inventoryWith({
        comments: listing({ records: [confirmedAppend({ id: COMMENT_ID, subject: "ABC-1" })] }),
      }),
      seam,
    });
    expect(read.texts).toEqual([
      {
        door: "linear",
        field: "body",
        link: `${ISSUE_URL}#comment-1`,
        linkCarriesNoText: false,
        objectKey: `comment ${COMMENT_ID}`,
        text: "the fleet's comment",
      },
    ]);
    expect(read.coverage.objects).toBe(1);
    expect(seam.asked).toEqual(["object ABC-1 comments=true"]);
  });

  it("reads an issue and a comment on it whose subject is the issue's uuid in ONE read", async () => {
    const seam = seamOf({
      objects: {
        "ABC-1": {
          comments: connectionOf({ nodes: [{ body: "ours", id: COMMENT_ID, url: `${ISSUE_URL}#comment-1` }] }),
          id: ISSUE_ID,
          title: "Ours too",
          url: ISSUE_URL,
        },
      },
    });
    const read = await readLinearPublications({
      inventory: inventoryWith({
        comments: listing({ records: [confirmedAppend({ id: COMMENT_ID, subject: ISSUE_ID })] }),
        issues: listing({ records: [confirmedIssue({ id: ISSUE_ID, identifier: "ABC-1" })] }),
      }),
      seam,
    });
    expect(read.texts.map((piece) => `${piece.objectKey} ${piece.field}`)).toEqual([
      `issue ${ISSUE_ID} title`,
      `comment ${COMMENT_ID} body`,
    ]);
    expect(seam.asked).toEqual(["object ABC-1 comments=true"]);
  });

  it("reports an unconfirmed reservation as unresolved and reads nothing for it", async () => {
    const seam = seamOf({});
    const read = await readLinearPublications({
      inventory: inventoryWith({ issues: listing({ records: [{ id: ISSUE_ID, reservedIso: RESERVED }] }) }),
      seam,
    });
    expect(read.texts).toEqual([]);
    expect(read.coverage.gaps).toEqual([ATTACH, LINEAR_PUBLICATION_GAPS.inventoryRowUnresolved]);
    expect(seam.asked).toEqual([]);
  });

  it("reports NOT_FOUND as not found or not visible, never as deleted", async () => {
    const read = await readLinearPublications({
      inventory: inventoryWith({
        issues: listing({ records: [confirmedIssue({ id: ISSUE_ID, identifier: "ABC-1" })] }),
      }),
      seam: seamOf({}),
    });
    expect(read.coverage).toEqual({
      attachmentsNotSwept: 0,
      door: "linear",
      gaps: [ATTACH, LINEAR_PUBLICATION_GAPS.objectNotFound],
      objects: 0,
      state: "partial",
      texts: 0,
    });
  });

  it("reports READ_FAILED as a fixed gap, never the provider's message", async () => {
    const read = await readLinearPublications({
      inventory: inventoryWith({
        issues: listing({ records: [confirmedIssue({ id: ISSUE_ID, identifier: "ABC-1" })] }),
      }),
      seam: seamOf({ failing: { "ABC-1": LinearLiveErrors.readFailed({ message: "upstream detail ABC-1" }) } }),
    });
    expect(read.coverage.gaps).toEqual([ATTACH, LINEAR_PUBLICATION_GAPS.objectReadFailed]);
  });

  it("reports a comment missing from a connection with more pages as a page ceiling, and from a whole one as not found", async () => {
    const inventory = inventoryWith({
      comments: listing({ records: [confirmedAppend({ id: COMMENT_ID, subject: "ABC-1" })] }),
    });
    const neighbour = { body: "not ours", id: NEIGHBOUR_ID, url: `${ISSUE_URL}#comment-2` };
    const paged = await readLinearPublications({
      inventory,
      seam: seamOf({
        objects: { "ABC-1": { comments: connectionOf({ hasNextPage: true, nodes: [neighbour] }), url: ISSUE_URL } },
      }),
    });
    const whole = await readLinearPublications({
      inventory,
      seam: seamOf({ objects: { "ABC-1": { comments: connectionOf({ nodes: [neighbour] }), url: ISSUE_URL } } }),
    });
    expect(paged.coverage.gaps).toEqual([LINEAR_PUBLICATION_GAPS.activityPageCeiling, ATTACH]);
    expect(whole.coverage.gaps).toEqual([ATTACH, LINEAR_PUBLICATION_GAPS.objectNotFound]);
    expect(paged.texts).toEqual([]);
    expect(whole.texts).toEqual([]);
  });

  it("caps the objects judged, in key order, and reports the ceiling", async () => {
    const seam = seamOf({
      objects: {
        "ABC-1": { title: "one", url: ISSUE_URL },
        "ABC-2": { title: "two", url: "https://linear.app/acme/issue/ABC-2/two" },
        "ABC-3": { title: "three", url: "https://linear.app/acme/issue/ABC-3/three" },
      },
    });
    const read = await readLinearPublications({
      inventory: inventoryWith({
        issues: listing({
          records: [
            confirmedIssue({ id: THIRD_ISSUE_ID, identifier: "ABC-3" }),
            confirmedIssue({ id: ISSUE_ID, identifier: "ABC-1" }),
            confirmedIssue({ id: SECOND_ISSUE_ID, identifier: "ABC-2" }),
          ],
        }),
      }),
      objectLimit: 2,
      seam,
    });
    expect(seam.asked).toEqual(["object ABC-1 comments=false", "object ABC-2 comments=false"]);
    expect(read.coverage.objects).toBe(2);
    expect(read.coverage.gaps).toEqual([ATTACH, LINEAR_PUBLICATION_GAPS.objectCeiling]);
  });

  it("names each family this build reads no text of, once it holds a row", async () => {
    const row = confirmedAppend({ id: COMMENT_ID, subject: "workspace" });
    const object: ProjectRecord = { confirmedIso: CONFIRMED, id: PROJECT_ID, reservedIso: RESERVED };
    const read = await readLinearPublications({
      inventory: inventoryWith({
        initiativeUpdates: listing({ records: [row] }),
        initiatives: listing({ records: [object] }),
        labels: listing({ records: [row] }),
        milestones: listing({ records: [object] }),
      }),
      seam: seamOf({}),
    });
    expect(read.coverage.gaps).toEqual([
      ATTACH,
      LINEAR_PUBLICATION_GAPS.initiativeUpdatesNotSwept,
      LINEAR_PUBLICATION_GAPS.initiativesNotSwept,
      LINEAR_PUBLICATION_GAPS.labelsNotSwept,
      LINEAR_PUBLICATION_GAPS.milestonesNotSwept,
    ]);
  });

  it("reports a comment whose subject no ledger can name the kind of, and reads nothing for it", async () => {
    const seam = seamOf({});
    const read = await readLinearPublications({
      inventory: inventoryWith({
        comments: listing({ records: [confirmedAppend({ id: COMMENT_ID, subject: SECOND_ISSUE_ID })] }),
      }),
      seam,
    });
    expect(read.coverage.gaps).toEqual([ATTACH, LINEAR_PUBLICATION_GAPS.commentDestinationUnknown]);
    expect(seam.asked).toEqual([]);
  });

  it("reports a family that would not list as unreadable and a malformed row as an unreadable row", async () => {
    const read = await readLinearPublications({
      inventory: inventoryWith({
        comments: listing<AppendRecord>({ records: [], unreadableRows: 1 }),
        issues: err(LedgerListingErrors.unreadable()),
      }),
      seam: seamOf({}),
    });
    expect(read.coverage.gaps).toEqual([
      ATTACH,
      LINEAR_PUBLICATION_GAPS.inventoryRowUnreadable,
      LINEAR_PUBLICATION_GAPS.inventoryUnreadable,
    ]);
  });

  it("links a comment that answers no url by its parent's, and an issue that answers none by the root, saying so", async () => {
    const read = await readLinearPublications({
      inventory: inventoryWith({
        comments: listing({ records: [confirmedAppend({ id: COMMENT_ID, subject: "ABC-1" })] }),
        issues: listing({ records: [confirmedIssue({ id: SECOND_ISSUE_ID, identifier: "ABC-2" })] }),
      }),
      seam: seamOf({
        objects: {
          "ABC-1": { comments: connectionOf({ nodes: [{ body: "ours", id: COMMENT_ID }] }), url: ISSUE_URL },
          "ABC-2": { title: "no address" },
        },
      }),
    });
    expect(read.texts.map((piece) => `${piece.objectKey} ${piece.link}`)).toEqual([
      `comment ${COMMENT_ID} ${ISSUE_URL}`,
      `issue ${SECOND_ISSUE_ID} https://linear.app/`,
    ]);
    expect(read.coverage.gaps).toEqual([ATTACH, LINEAR_PUBLICATION_GAPS.objectAddressUnresolved]);
  });

  it("judges a project and the fleet's own update on it, by exact id, through the project's recorded url", async () => {
    const seam = seamOf({
      objects: { [PROJECT_URL]: { content: "", description: "", name: "Fixture project", url: PROJECT_URL } },
      updates: {
        [PROJECT_URL]: connectionOf({
          nodes: [
            { body: "somebody else's update", id: OTHER_UPDATE_ID },
            { body: "the fleet's update", id: UPDATE_ID, url: `${PROJECT_URL}/updates#u1` },
          ],
        }),
      },
    });
    const read = await readLinearPublications({
      inventory: inventoryWith({
        projectUpdates: listing({ records: [confirmedAppend({ id: UPDATE_ID, subject: PROJECT_ID })] }),
        projects: listing({
          records: [{ confirmedIso: CONFIRMED, id: PROJECT_ID, reservedIso: RESERVED, url: PROJECT_URL }],
        }),
      }),
      seam,
    });
    expect(read.texts.map((piece) => `${piece.objectKey} ${piece.field} ${piece.text}`)).toEqual([
      `project ${PROJECT_ID} name Fixture project`,
      `project-update ${UPDATE_ID} body the fleet's update`,
    ]);
    expect(seam.asked).toEqual([`object ${PROJECT_URL} comments=false`, `updates ${PROJECT_URL}`]);
    expect(read.coverage.gaps).toEqual([ATTACH]);
  });

  it("counts uploaded files the published text links as not swept", async () => {
    const read = await readLinearPublications({
      inventory: inventoryWith({
        issues: listing({ records: [confirmedIssue({ id: ISSUE_ID, identifier: "ABC-1" })] }),
      }),
      seam: seamOf({
        objects: {
          "ABC-1": { description: "see https://uploads.linear.app/acme/fixture.png", title: "t", url: ISSUE_URL },
        },
      }),
    });
    expect(read.coverage.attachmentsNotSwept).toBe(1);
    expect(read.coverage.gaps).toEqual([ATTACH, LINEAR_PUBLICATION_GAPS.uploadsNotRead]);
  });

  it("never carries a published body or a provider message into the gaps", async () => {
    const marker = "SYNTHETIC-BODY-FIXTURE";
    const read = await readLinearPublications({
      inventory: inventoryWith({
        comments: listing({ records: [confirmedAppend({ id: COMMENT_ID, subject: "ABC-1" })] }),
        issues: listing({ records: [confirmedIssue({ id: SECOND_ISSUE_ID, identifier: "ABC-2" })] }),
      }),
      seam: seamOf({
        failing: { "ABC-2": LinearLiveErrors.readFailed({ message: marker }) },
        objects: {
          "ABC-1": { comments: connectionOf({ nodes: [{ body: marker, id: COMMENT_ID }] }), url: ISSUE_URL },
        },
      }),
    });
    expect(read.texts.map((piece) => piece.text)).toEqual([marker]);
    expect(read.coverage.gaps.join("\n")).not.toContain(marker);
    expect(read.coverage.gaps).toEqual([
      ATTACH,
      LINEAR_PUBLICATION_GAPS.objectAddressUnresolved,
      LINEAR_PUBLICATION_GAPS.objectReadFailed,
    ]);
  });
});

describe("LinearPublicationReadErrors", () => {
  it("keeps a live failure's code and drops its upstream text, so nothing the provider said crosses the seam", () => {
    const live = LinearLiveErrors.readFailed({ message: "upstream detail ABC-1" });
    expect(live.message).toContain("ABC-1");
    expect(LinearPublicationReadErrors.fromLive({ error: live })).toEqual({
      code: "READ_FAILED",
      message: "the linear publication read failed (READ_FAILED)",
    });
  });
});
