import { describe, expect, it } from "vitest";
import type { NestedNodes } from "../../../../corpus/linear/nested.js";
import {
  parseInitiativeNode,
  parseLinearIssueIdentity,
  parseLinearIssueNode,
  parseLinearIssueRelations,
  parseProjectUpdates,
} from "../../../../corpus/linear/parse.js";
import { parseDocumentNode } from "../../../../corpus/linear/parseDocument.js";
import { parseExternalLinks, parseReactionData } from "../../../../corpus/linear/parseFields.js";
import { parseIssueLifecycle, parseIssueScalars } from "../../../../corpus/linear/parseIssueParts.js";
import { parseProject } from "../../../../corpus/linear/parseProject.js";
import { isRecord } from "../../../../lib/parsers.js";

/** The nested-connection bag, defaulting every connection to empty. */
function nested({ overrides = {} }: { overrides?: Partial<Record<string, readonly unknown[]>> } = {}): NestedNodes {
  return {
    attachments: [],
    children: [],
    comments: [],
    history: [],
    inverseRelations: [],
    labels: [],
    relations: [],
    stateHistory: [],
    subscribers: [],
    ...overrides,
  };
}

const ISSUE_NODE = {
  archivedAt: null,
  assignee: { displayName: "Dana" },
  branchName: "eng-42-recall-regression",
  createdAt: "2026-05-01T00:00:00.000Z",
  creator: { displayName: "Seth" },
  cycle: { id: "cy1", name: "Cycle 12", number: 12 },
  description: "the retriever drops old records",
  dueDate: "2026-06-01",
  estimate: 3,
  id: "uuid-42",
  identifier: "ENG-42",
  number: 42,
  parent: { identifier: "ENG-1" },
  priority: 2,
  priorityLabel: "High",
  project: { name: "Search quality" },
  projectMilestone: { id: "m1", name: "Beta" },
  reactionData: [{ emoji: "eyes", userIds: ["u1", "u2"] }],
  startedAt: "2026-05-02T00:00:00.000Z",
  state: { name: "In Progress", type: "started" },
  team: { key: "ENG" },
  title: "recall regression",
  triagedAt: "2026-05-01T12:00:00.000Z",
  updatedAt: "2026-05-03T00:00:00.000Z",
  url: "https://linear.app/acme/issue/ENG-42",
};

describe("parseLinearIssueIdentity", () => {
  it("falls back title to the identifier and keeps present fields", () => {
    const identity = parseLinearIssueIdentity({ node: { identifier: "ENG-1", updatedAt: "2026-01-01T00:00:00Z" } })!;
    expect(identity.identifier).toBe("ENG-1");
    expect(identity.title).toBe("ENG-1");
    expect(identity.tsIso).toBe("2026-01-01T00:00:00Z");
  });

  it("drops the issue (undefined) when there is no identifier", () => {
    expect(parseLinearIssueIdentity({ node: { title: "no id" } })).toBeUndefined();
  });

  it("omits description when absent", () => {
    const identity = parseLinearIssueIdentity({ node: { identifier: "ENG-2" } })!;
    expect(Object.hasOwn(identity, "description")).toBe(false);
  });
});

describe("parseLinearIssueRelations", () => {
  it("extracts state (+ its type), team, project, milestone, cycle, parent and people", () => {
    expect(parseLinearIssueRelations({ node: ISSUE_NODE })).toEqual({
      assignee: "Dana",
      author: "Seth",
      cycle: "Cycle 12",
      cycleNumber: 12,
      milestone: "Beta",
      parent: "ENG-1",
      project: "Search quality",
      state: "In Progress",
      stateType: "started",
      team: "ENG",
    });
  });

  it("prefers the creator's real id over their display name when the node carries one", () => {
    const withId = { ...ISSUE_NODE, creator: { displayName: "Seth", id: "u-42" } };
    expect(parseLinearIssueRelations({ node: withId }).author).toBe("u-42");
  });

  it("keeps the project's id apart from its name, as the key an issue joins its project on", () => {
    const hydrated = { ...ISSUE_NODE, project: { id: "proj-7", name: "Search quality" } };
    const relations = parseLinearIssueRelations({ node: hydrated });
    expect(relations.projectId).toBe("proj-7");
    expect(relations.project).toBe("Search quality");
  });

  it("never stands a project's name in for its missing id", () => {
    expect(Object.hasOwn(parseLinearIssueRelations({ node: ISSUE_NODE }), "projectId")).toBe(false);
  });

  it("returns an empty object when all relations are missing", () => {
    expect(parseLinearIssueRelations({ node: {} })).toEqual({});
  });
});

describe("parseIssueScalars / parseIssueLifecycle", () => {
  it("keeps every planning scalar that was previously dropped", () => {
    expect(parseIssueScalars({ node: ISSUE_NODE })).toEqual({
      branchName: "eng-42-recall-regression",
      dueDate: "2026-06-01",
      estimate: 3,
      number: 42,
      priority: 2,
      priorityLabel: "High",
    });
  });

  it("keeps only the lifecycle timestamps that are present", () => {
    expect(parseIssueLifecycle({ node: ISSUE_NODE })).toEqual({
      createdAtIso: "2026-05-01T00:00:00.000Z",
      startedAtIso: "2026-05-02T00:00:00.000Z",
      triagedAtIso: "2026-05-01T12:00:00.000Z",
    });
  });

  it("returns nothing for a node with no scalars at all", () => {
    expect(parseIssueScalars({ node: {} })).toEqual({});
    expect(parseIssueLifecycle({ node: {} })).toEqual({});
  });
});

describe("parseReactionData", () => {
  it("renders each reaction as the SAME `:emoji: xN` shape the Slack connector writes", () => {
    expect(
      parseReactionData({
        value: [
          { emoji: "eyes", userIds: ["u1", "u2"] },
          { emoji: "tada", userIds: ["u1"] },
        ],
      }),
    ).toEqual([":eyes: x2", ":tada: x1"]);
  });

  it("counts a reaction with no userIds as one and drops an emoji-less entry", () => {
    expect(parseReactionData({ value: [{ emoji: "eyes" }, { userIds: ["u1"] }] })).toEqual([":eyes: x1"]);
  });

  it("returns nothing for a non-array", () => {
    expect(parseReactionData({ value: { eyes: 2 } })).toEqual([]);
  });
});

describe("parseLinearIssueNode", () => {
  it("shapes the issue from its COMPLETED nested connections, not the inline node", () => {
    const parsed = parseLinearIssueNode({
      nested: nested({
        overrides: {
          comments: [{ body: "hi", createdAt: "2026-05-02T00:00:00.000Z", id: "c1", url: "u" }],
          // Three labels, where the inline node's own `labels` connection is absent entirely: reading the
          // connections off the node would produce ZERO labels here.
          labels: [{ name: "bug" }, { name: "retrieval" }, { name: "paged-in" }],
          subscribers: [{ displayName: "Ada" }],
        },
      }),
      node: ISSUE_NODE,
    })!;
    expect(parsed.item.identifier).toBe("ENG-42");
    // Sorted, not arrival order: `text` embeds this list too and `text` is fingerprinted, so an unsorted
    // connection would churn bronze on every refresh.
    expect(parsed.item.labels).toEqual(["bug", "paged-in", "retrieval"]);
    expect(parsed.item.comments.map((c) => c.id)).toEqual(["c1"]);
    expect(parsed.item.subscribers).toEqual(["Ada"]);
    expect(parsed.item.reactions).toEqual([":eyes: x2"]);
    expect(parsed.id).toBe("uuid-42");
  });

  it("returns undefined for a node with no identifier", () => {
    expect(parseLinearIssueNode({ nested: nested(), node: { title: "x" } })).toBeUndefined();
  });

  it("captures sub-issue/relation edges + ref-only attachments, sorted", () => {
    const parsed = parseLinearIssueNode({
      nested: nested({
        overrides: {
          attachments: [{ id: "a1", title: "Spec", url: "https://example/s" }],
          children: [{ identifier: "ENG-43" }],
          relations: [
            { createdAt: "2026-05-04T00:00:00.000Z", id: "r1", relatedIssue: { identifier: "ENG-99" }, type: "blocks" },
          ],
        },
      }),
      node: ISSUE_NODE,
    })!;
    // Sorted, because array CONTENTS participate in the dedup fingerprint: a reshuffled connection would
    // otherwise look like a content change and append a false new version forever.
    expect(parsed.item.edgeRefs).toEqual(["blocks|linear:ENG-99", "sub-issue|linear:ENG-43"]);
    expect(parsed.item.attachments).toEqual(["Spec (https://example/s)"]);
  });

  it("rebuilds `raw` with the COMPLETE connections and DROPS both history streams", () => {
    const parsed = parseLinearIssueNode({
      nested: nested({
        overrides: {
          comments: [
            { body: "a", id: "c1" },
            { body: "b", id: "c2" },
          ],
          history: [{ createdAt: "2026-05-04T00:00:00.000Z", id: "h1" }],
          stateHistory: [{ id: "s1", startedAt: "2026-05-01T00:00:00.000Z" }],
        },
      }),
      node: { ...ISSUE_NODE, comments: { nodes: [{ body: "a", id: "c1" }] }, history: { nodes: [] } },
    })!;
    // `raw` carries the complete comment list, so it cannot disagree with `attrs`...
    expect(parsed.item.raw!["comments"]).toEqual({
      nodes: [
        { body: "a", id: "c1" },
        { body: "b", id: "c2" },
      ],
    });
    // ...and the two history streams are gone from bronze entirely: they live in the sibling store, and a
    // second copy of ~192,000 events would multiply bronze for no reader's benefit.
    expect(Object.hasOwn(parsed.item.raw!, "history")).toBe(false);
    expect(Object.hasOwn(parsed.item.raw!, "stateHistory")).toBe(false);
  });

  it("carries the issue's history rows out separately, both streams", () => {
    const parsed = parseLinearIssueNode({
      nested: nested({
        overrides: {
          history: [{ actor: { displayName: "Seth" }, createdAt: "2026-05-04T00:00:00.000Z", id: "h1" }],
          stateHistory: [{ id: "s1", startedAt: "2026-05-01T00:00:00.000Z", state: { name: "Todo" } }],
        },
      }),
      node: ISSUE_NODE,
    })!;
    expect(parsed.historyRows.map((r) => `${r.stream}:${r.eventId}`)).toEqual(["history:h1", "state:s1"]);
    expect(parsed.historyRows[0]!.subjectId).toBe("ENG-42");
    expect(parsed.historyRows[0]!.container).toBe("linear/ENG");
  });
});

describe("parseComments (via parseLinearIssueNode)", () => {
  it("recovers the reply parent, reactions, edit/resolve marks and the quoted passage", () => {
    const parsed = parseLinearIssueNode({
      nested: nested({
        overrides: {
          comments: [
            {
              body: "agreed",
              createdAt: "2026-05-02T00:00:00.000Z",
              editedAt: "2026-05-02T01:00:00.000Z",
              id: "c2",
              parent: { id: "c1" },
              quotedText: "the retriever drops",
              reactionData: [{ emoji: "+1", userIds: ["u1"] }],
              resolvedAt: "2026-05-02T02:00:00.000Z",
              url: "u",
              user: { displayName: "Ada" },
            },
          ],
        },
      }),
      node: ISSUE_NODE,
    })!;
    const comment = parsed.item.comments[0]!;
    expect(comment.parentId).toBe("c1");
    expect(comment.reactions).toEqual([":+1: x1"]);
    expect(comment.editedAtIso).toBe("2026-05-02T01:00:00.000Z");
    expect(comment.resolvedAtIso).toBe("2026-05-02T02:00:00.000Z");
    expect(comment.quotedText).toBe("the retriever drops");
    expect(comment.author).toBe("Ada");
  });

  it("prefers the commenter's real id over their display name when the node carries one", () => {
    const parsed = parseLinearIssueNode({
      nested: nested({
        overrides: { comments: [{ body: "agreed", id: "c2", user: { displayName: "Ada", id: "u-1" } }] },
      }),
      node: ISSUE_NODE,
    })!;
    expect(parsed.item.comments[0]!.author).toBe("u-1");
  });

  it("names an EXTERNAL commenter who was previously anonymous", () => {
    const parsed = parseLinearIssueNode({
      nested: nested({
        overrides: {
          comments: [{ body: "from support", externalUser: { displayName: "Customer Contact" }, id: "c3", user: null }],
        },
      }),
      node: ISSUE_NODE,
    })!;
    expect(parsed.item.comments[0]!.author).toBe("Customer Contact");
  });

  it("prefers an EXTERNAL commenter's real id over their display name when the node carries one", () => {
    const parsed = parseLinearIssueNode({
      nested: nested({
        overrides: {
          comments: [
            {
              body: "from support",
              externalUser: { displayName: "Customer Contact", id: "eu-1" },
              id: "c3b",
              user: null,
            },
          ],
        },
      }),
      node: ISSUE_NODE,
    })!;
    expect(parsed.item.comments[0]!.author).toBe("eu-1");
  });

  it("falls back to the integration that posted, then to no author at all", () => {
    const parsed = parseLinearIssueNode({
      nested: nested({
        overrides: {
          comments: [
            { body: "sync", botActor: { name: "GitHub" }, id: "c4" },
            { body: "orphan", id: "c5" },
          ],
        },
      }),
      node: ISSUE_NODE,
    })!;
    expect(parsed.item.comments[0]!.author).toBe("GitHub");
    expect(parsed.item.comments[1]!.author).toBeUndefined();
  });

  it("skips a body-less comment node", () => {
    const parsed = parseLinearIssueNode({
      nested: nested({ overrides: { comments: [{ id: "c6" }] } }),
      node: ISSUE_NODE,
    })!;
    expect(parsed.item.comments).toEqual([]);
  });
});

describe("parseExternalLinks", () => {
  it("renders `label (url)` lines and dedupes them", () => {
    expect(
      parseExternalLinks({
        nodes: [
          { label: "Design", url: "https://example/d" },
          { label: "Design", url: "https://example/d" },
          { url: "https://example/bare" },
        ],
      }),
    ).toEqual(["Design (https://example/d)", "https://example/bare"]);
  });

  it("drops a url-less node", () => {
    expect(parseExternalLinks({ nodes: [{ label: "no url" }] })).toEqual([]);
  });
});

/**
 * The COMPLETED connection lists for a project fixture, read off the node's inline pages.
 *
 * In production these arrive from `completeParentConnections`, having been paged to exhaustion. A fixture that
 * only has inline pages can build them directly — which is also the point of the parameter: the parser can no
 * longer reach into the node and quietly use one page.
 */
function projectNested({ node }: { node: Record<string, unknown> }): NestedNodes {
  const conn = ({ key }: { key: string }): readonly unknown[] => {
    const value = node[key];
    return isRecord(value) && Array.isArray(value["nodes"]) ? value["nodes"] : [];
  };
  return {
    externalLinks: conn({ key: "externalLinks" }),
    initiatives: conn({ key: "initiatives" }),
    labels: conn({ key: "labels" }),
    members: conn({ key: "members" }),
    teams: conn({ key: "teams" }),
  };
}

describe("parseProject", () => {
  const NODE = {
    archivedAt: null,
    content: "the full brief, several paragraphs long",
    createdAt: "2026-04-01T00:00:00.000Z",
    description: "one paragraph",
    externalLinks: { nodes: [{ label: "Figma", url: "https://example/f" }] },
    health: "onTrack",
    id: "p1",
    initiatives: { nodes: [{ id: "i1", name: "North star" }] },
    labels: { nodes: [{ name: "platform" }] },
    lead: { displayName: "Seth" },
    members: { nodes: [{ displayName: "Dana" }] },
    name: "Search quality",
    startDate: "2026-04-01",
    status: { name: "In Progress", type: "started" },
    targetDate: "2026-08-01",
    teams: { nodes: [{ key: "ENG" }] },
    updatedAt: "2026-05-01T00:00:00.000Z",
    url: "https://linear.app/acme/project/p1",
  };

  it("captures `content` — the full brief, the biggest per-field loss in the connector", () => {
    const project = parseProject({ nested: projectNested({ node: NODE }), node: NODE, updates: [] })!;
    expect(project.content).toBe("the full brief, several paragraphs long");
    expect(project.description).toBe("one paragraph");
  });

  it("reads the status NAME off `status`, since Linear deprecated the `state` field", () => {
    expect(parseProject({ nested: projectNested({ node: NODE }), node: NODE, updates: [] })!.state).toBe("In Progress");
  });

  it("gives externalLinks an attrs destination rather than leaving them in raw", () => {
    // A connection whose only home is `raw` is discarded on re-ingest: `contentFingerprint` excludes `raw`
    // and the FIRST-captured record wins, so the thin original is the one retained.
    expect(parseProject({ nested: projectNested({ node: NODE }), node: NODE, updates: [] })!.links).toEqual([
      "Figma (https://example/f)",
    ]);
  });

  it("keeps teams, members, labels and initiatives", () => {
    const project = parseProject({ nested: projectNested({ node: NODE }), node: NODE, updates: [] })!;
    expect(project.teams).toEqual(["ENG"]);
    expect(project.members).toEqual(["Dana"]);
    expect(project.labels).toEqual(["platform"]);
    expect(project.initiatives).toEqual(["North star"]);
  });

  it("reads the COMPLETED connection lists, not the node's inline page", () => {
    // The R1 review pass found this: `teams`/`members`/`labels`/`initiatives`/`externalLinks` carried a
    // `hasNextPage` flag that NOTHING read, so a project with more teams than its inline page silently lost the
    // remainder. Passing a completed list that DISAGREES with the inline page is the falsifiable form of the fix.
    const project = parseProject({
      nested: { ...projectNested({ node: NODE }), teams: [{ key: "ENG" }, { key: "PLAT" }, { key: "PAGED-IN" }] },
      node: NODE,
      updates: [],
    })!;
    expect(project.teams).toEqual(["ENG", "PAGED-IN", "PLAT"]);
  });

  it("returns undefined without an id or a name", () => {
    expect(parseProject({ nested: nested(), node: { id: "p2" }, updates: [] })).toBeUndefined();
    expect(parseProject({ nested: nested(), node: { name: "nameless" }, updates: [] })).toBeUndefined();
  });
});

describe("parseProjectUpdates", () => {
  it("parses updates with reactions and edit marks, skipping body-less ones", () => {
    const nodes = [
      {
        body: "on track",
        createdAt: "2026-05-03T00:00:00.000Z",
        editedAt: "2026-05-03T01:00:00.000Z",
        health: "onTrack",
        id: "u1",
        reactionData: [{ emoji: "tada", userIds: ["a", "b"] }],
        url: "u",
        user: { displayName: "Seth" },
      },
      { id: "u2" },
    ];
    expect(parseProjectUpdates({ nodes })).toEqual([
      {
        author: "Seth",
        body: "on track",
        editedAtIso: "2026-05-03T01:00:00.000Z",
        health: "onTrack",
        id: "u1",
        raw: nodes[0],
        reactions: [":tada: x2"],
        tsIso: "2026-05-03T00:00:00.000Z",
        url: "u",
      },
    ]);
  });

  it("prefers the poster's real id over their display name when the node carries one", () => {
    const nodes = [{ body: "on track", id: "u3", url: "u", user: { displayName: "Seth", id: "u-77" } }];
    expect(parseProjectUpdates({ nodes })[0]!.author).toBe("u-77");
  });
});

describe("parseInitiativeNode", () => {
  it("captures the full brief, owner, status and its projects", () => {
    const initiative = parseInitiativeNode({
      node: {
        content: "the strategy, in full",
        description: "one line",
        health: "onTrack",
        id: "i1",
        links: { nodes: [{ label: "Deck", url: "https://example/deck" }] },
        name: "North star",
        owner: { displayName: "Seth" },
        projects: { nodes: [{ id: "p1", name: "Search quality" }] },
        status: "Active",
        targetDate: "2026-12-01",
        updatedAt: "2026-05-01T00:00:00.000Z",
        url: "u",
      },
    })!;
    expect(initiative.content).toBe("the strategy, in full");
    expect(initiative.owner).toBe("Seth");
    expect(initiative.status).toBe("Active");
    expect(initiative.projects).toEqual(["Search quality"]);
    expect(initiative.links).toEqual(["Deck (https://example/deck)"]);
  });

  it("returns undefined without an id + name", () => {
    expect(parseInitiativeNode({ node: { id: "i2" } })).toBeUndefined();
  });
});

describe("parseDocumentNode", () => {
  it("recovers all six parent bindings, which were dropped entirely", () => {
    const document = parseDocumentNode({
      node: {
        content: "the spec",
        creator: { displayName: "Seth" },
        id: "d1",
        initiative: { id: "i1", name: "North star" },
        issue: { identifier: "ENG-42" },
        owner: { displayName: "Dana" },
        project: { id: "p1", name: "Search quality" },
        team: { key: "ENG" },
        title: "Retrieval spec",
        updatedAt: "2026-05-01T00:00:00.000Z",
        url: "u",
      },
    })!;
    expect(document.project).toBe("Search quality");
    expect(document.initiative).toBe("North star");
    expect(document.issue).toBe("ENG-42");
    expect(document.team).toBe("ENG");
    expect(document.creator).toBe("Seth");
    expect(document.owner).toBe("Dana");
  });

  it("returns undefined without an id + title", () => {
    expect(parseDocumentNode({ node: { title: "no id" } })).toBeUndefined();
  });
});
