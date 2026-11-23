import { describe, expect, it } from "vitest";
import { parseCuratedEdgeRef } from "../../../../corpus/curated/types.js";
import {
  customerNeedRecord,
  externalUserRow,
  initiativeProjectEdges,
  initiativeUpdateRecord,
  projectMilestoneRecord,
  templateRecord,
} from "../../../../corpus/linear/entities.js";
import { customViewRow, issueLabelRow } from "../../../../corpus/linear/vocabularyRows.js";

const AT = "2026-08-03T00:00:00.000Z";

describe("customerNeedRecord — the one entity carrying verbatim CUSTOMER prose", () => {
  const NODE = {
    body: "we cannot export the report to CSV",
    createdAt: "2026-05-01T00:00:00.000Z",
    creator: { displayName: "Seth" },
    customer: { id: "cu1", name: "Northwind" },
    id: "n1",
    issue: { identifier: "ENG-42" },
    priority: 2,
    project: { name: "Reporting" },
    updatedAt: "2026-05-02T00:00:00.000Z",
    url: "https://linear.app/acme/need/n1",
  };

  it("lands as a `need` record with the customer's own words in the searchable text", () => {
    const record = customerNeedRecord({ node: NODE })!;
    expect(record.kind).toBe("need");
    expect(record.sourceId).toBe("need:n1");
    expect(record.text).toContain("we cannot export the report to CSV");
  });

  it("puts the customer, issue and project in the TEXT as well as attrs", () => {
    // `retrievalIndex.ts` indexes title/text/refs, so a binding that lived only in `attrs` would leave
    // "what did <customer> ask for" unanswerable — which is the whole point of capturing this entity.
    const record = customerNeedRecord({ node: NODE })!;
    expect(record.text).toContain("Customer: Northwind");
    expect(record.text).toContain("Issue: ENG-42");
    expect(record.attrs).toEqual({
      createdAt: "2026-05-01T00:00:00.000Z",
      creator: "Seth",
      customer: "Northwind",
      issue: "ENG-42",
      priority: 2,
      project: "Reporting",
    });
  });

  it("falls back to `content` when there is no `body`", () => {
    const record = customerNeedRecord({ node: { content: "the rich-text form", id: "n2" } })!;
    expect(record.text).toBe("the rich-text form");
  });

  it("is dropped when it has no prose at all — metadata alone is not a need", () => {
    expect(customerNeedRecord({ node: { customer: { name: "Northwind" }, id: "n3" } })).toBeUndefined();
    expect(customerNeedRecord({ node: { body: "orphan" } })).toBeUndefined();
  });
});

describe("projectMilestoneRecord", () => {
  it("reuses the existing `milestone` kind rather than inventing vocabulary", () => {
    const record = projectMilestoneRecord({
      node: {
        description: "everything behind the flag",
        id: "m1",
        name: "Beta",
        progress: 0.5,
        project: { name: "Reporting" },
        status: "next",
        targetDate: "2026-09-01",
        updatedAt: "2026-05-02T00:00:00.000Z",
      },
    })!;
    expect(record.kind).toBe("milestone");
    expect(record.sourceId).toBe("milestone:m1");
    expect(record.title).toBe("Beta");
    expect(record.text).toContain("Target: 2026-09-01");
    expect(record.attrs!["progress"]).toBe(0.5);
  });

  it("falls back to the name when a milestone has no description", () => {
    expect(projectMilestoneRecord({ node: { id: "m2", name: "GA" } })!.text).toBe("GA");
  });

  it("is dropped without an id + name", () => {
    expect(projectMilestoneRecord({ node: { name: "nameless" } })).toBeUndefined();
  });
});

describe("initiativeUpdateRecord", () => {
  it("lands as an `update` record naming its initiative and health", () => {
    const record = initiativeUpdateRecord({
      node: {
        body: "on track for Q4",
        createdAt: "2026-05-02T00:00:00.000Z",
        health: "onTrack",
        id: "iu1",
        initiative: { name: "North star" },
        reactionData: [{ emoji: "tada", userIds: ["a"] }],
        url: "u",
        user: { displayName: "Seth" },
      },
    })!;
    expect(record.kind).toBe("update");
    expect(record.sourceId).toBe("initiativeUpdate:iu1");
    expect(record.title).toBe("Initiative update: North star (onTrack)");
    expect(record.author).toBe("Seth");
    expect(record.attrs!["reactions"]).toEqual([":tada: x1"]);
  });

  it("prefers the poster's real id over their display name when the node carries one", () => {
    const record = initiativeUpdateRecord({
      node: { body: "on track", id: "iu3", url: "u", user: { displayName: "Seth", id: "u-99" } },
    })!;
    expect(record.author).toBe("u-99");
  });

  it("is dropped without an id + body", () => {
    expect(initiativeUpdateRecord({ node: { id: "iu2" } })).toBeUndefined();
  });
});

describe("templateRecord", () => {
  it("lands as a `document` — deliberately-authored scaffolding, same class as a spec", () => {
    const record = templateRecord({
      node: {
        creator: { displayName: "Seth" },
        description: "how we write a bug report",
        id: "t1",
        name: "Bug report",
        team: { key: "ENG" },
        type: "issue",
        updatedAt: "2026-05-02T00:00:00.000Z",
      },
    })!;
    expect(record.kind).toBe("document");
    expect(record.sourceId).toBe("template:t1");
    expect(record.title).toBe("Template: Bug report");
    expect(record.text).toContain("Team: ENG");
    expect(record.attrs!["templateType"]).toBe("issue");
  });

  it("is dropped without an id + name", () => {
    expect(templateRecord({ node: { name: "nameless" } })).toBeUndefined();
  });
});

describe("issueLabelRow — org vocabulary, in the STRUCTURE store", () => {
  it("keeps the description and the group hierarchy the issue query could not express", () => {
    const row = issueLabelRow({
      fetchedAtIso: AT,
      node: {
        color: "#ff0000",
        description: "a defect in shipped behaviour",
        id: "l1",
        isGroup: false,
        name: "bug",
        parent: { id: "lg1", name: "type" },
        team: { id: "t1", key: "ENG" },
      },
    })!;
    expect(row.kind).toBe("issue_label");
    expect(row.attrs).toEqual({ color: "#ff0000", description: "a defect in shipped behaviour", isGroup: false });
    // Both bindings: the owning team AND the label group. Only bare NAMES rode the issue query before.
    expect(row.relations).toEqual([
      { targetId: "t1", targetKind: "team", targetSource: "linear", type: "parent" },
      { targetId: "lg1", targetKind: "issue_label", targetSource: "linear", type: "parent" },
    ]);
  });

  it("marks an archived label and carries no relations for a workspace-level one", () => {
    const row = issueLabelRow({
      fetchedAtIso: AT,
      node: { archivedAt: "2026-06-01T00:00:00.000Z", id: "l2", isGroup: true, name: "retired" },
    })!;
    expect(row.attrs["archived"]).toBe(true);
    expect(row.attrs["isGroup"]).toBe(true);
    expect(row.relations).toEqual([]);
  });

  it("is dropped without an id", () => {
    expect(issueLabelRow({ fetchedAtIso: AT, node: { name: "no id" } })).toBeUndefined();
  });
});

describe("customViewRow", () => {
  it("keeps the name, owner and team binding", () => {
    const row = customViewRow({
      fetchedAtIso: AT,
      node: {
        description: "everything blocking the release",
        id: "v1",
        modelName: "Issue",
        name: "Release blockers",
        owner: { displayName: "Seth" },
        shared: true,
        team: { id: "t1", key: "ENG" },
      },
    })!;
    expect(row.kind).toBe("custom_view");
    expect(row.attrs).toEqual({
      description: "everything blocking the release",
      modelName: "Issue",
      owner: "Seth",
      shared: true,
    });
    expect(row.relations).toEqual([{ targetId: "t1", targetKind: "team", targetSource: "linear", type: "parent" }]);
  });

  it("is dropped without an id", () => {
    expect(customViewRow({ fetchedAtIso: AT, node: { name: "no id" } })).toBeUndefined();
  });
});

describe("externalUserRow — the 652 commenters who were anonymous", () => {
  it("becomes a member row carrying the email that makes them joinable", () => {
    const row = externalUserRow({
      fetchedAtIso: AT,
      node: {
        avatarUrl: "https://cdn/av.png",
        displayName: "contact",
        email: "contact@northwind.example",
        id: "eu1",
        name: "Northwind Contact",
      },
    })!;
    expect(row.sourceId).toBe("eu1");
    expect(row.identity.email).toBe("contact@northwind.example");
    expect(row.identity.name).toBe("Northwind Contact");
    // `provenance` is what marks them external — there is no profile flag to set, and inventing one would
    // change the member contract for every source.
    expect(row.provenance).toEqual(["linear.externalUsers"]);
    // `active` is ABSENT, not `true`: an external user has no activity field on the API, and since the
    // store copies this onto an identity whose contract is "what the provider said", asserting one would
    // report a contact as confirmed-present on the word of an API that was never asked.
    expect(row.profile).toEqual({ avatarUrl: "https://cdn/av.png", bot: false });
  });

  it("warns rather than guessing when an external user has no email", () => {
    const row = externalUserRow({ fetchedAtIso: AT, node: { id: "eu2", name: "Anon" } })!;
    expect(row.warnings).toEqual(["no email on Linear external user"]);
  });

  it("is dropped without an id", () => {
    expect(externalUserRow({ fetchedAtIso: AT, node: { name: "no id" } })).toBeUndefined();
  });
});

describe("the initiative → project link", () => {
  it("encodes each project as a `project-item` edge to the project record's own node key", () => {
    const edges = initiativeProjectEdges({ projectIds: ["p2", "p1"] });
    expect(edges).toEqual(["project-item|linear:project:p1", "project-item|linear:project:p2"]);
    // The target must line up with the project record's `sourceId` (`project:<id>`), or the edge dangles.
    expect(parseCuratedEdgeRef({ encoded: edges[0]! })).toEqual({
      kind: "project-item",
      target: "linear:project:p1",
    });
  });

  it("dedupes and sorts, so a reshuffled connection cannot churn the fingerprint", () => {
    expect(initiativeProjectEdges({ projectIds: ["p1", "p2", "p1"] })).toEqual(
      initiativeProjectEdges({ projectIds: ["p2", "p1"] }),
    );
  });

  it("returns nothing for an initiative with no projects", () => {
    expect(initiativeProjectEdges({ projectIds: [] })).toEqual([]);
  });
});
