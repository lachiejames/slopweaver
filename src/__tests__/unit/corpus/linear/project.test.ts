import { describe, expect, it } from "vitest";
import type { LinearIssueItem, LinearProjectItem } from "../../../../corpus/linear/items.js";
import { projectLinearRecords } from "../../../../corpus/linear/project.js";
import { recordContentFingerprint, serialiseRecord } from "../../../../corpus/recordSerialisation.js";
import { isRecord } from "../../../../lib/parsers.js";

const rawIssue = { identifier: "ENG-42", rawMarker: "linear-issue" };
const rawComment = { id: "c1", rawMarker: "linear-comment" };
const rawProject = { id: "p1", rawMarker: "linear-project" };

const issue: LinearIssueItem = {
  assignee: "Dana",
  author: "Seth",
  comments: [
    {
      author: "Dana",
      body: "on it",
      id: "c1",
      raw: rawComment,
      tsIso: "2026-05-02T00:00:00.000Z",
      url: "https://linear.app/acme/issue/ENG-42#comment-c1",
    },
  ],
  description: "the retriever drops old records",
  identifier: "ENG-42",
  labels: ["bug", "retrieval"],
  project: "Search quality",
  raw: rawIssue,
  state: "In Progress",
  team: "ENG",
  title: "recall regression",
  tsIso: "2026-05-01T00:00:00.000Z",
  url: "https://linear.app/acme/issue/ENG-42",
};

const project: LinearProjectItem = {
  description: "make ask trustworthy",
  id: "p1",
  name: "Search quality",
  raw: rawProject,
  state: "started",
  tsIso: "2026-05-01T00:00:00.000Z",
  url: "https://linear.app/acme/project/p1",
};

describe("projectLinearRecords", () => {
  it("projects an issue atom keyed by identifier, folding state/assignee/labels/project into the text", () => {
    const records = projectLinearRecords({ issues: [issue], projects: [] });
    const atom = records.find((r) => r.kind === "issue")!;
    expect(atom.sourceId).toBe("ENG-42");
    expect(atom.source).toBe("linear");
    expect(atom.container).toBe("linear/ENG");
    expect(atom.title).toBe("ENG-42 recall regression");
    expect(atom.author).toBe("Seth");
    expect(atom.text).toContain("State: In Progress");
    expect(atom.text).toContain("Assignee: Dana");
    expect(atom.text).toContain("Labels: bug, retrieval");
    expect(atom.text).toContain("the retriever drops old records");
    expect(atom.refs).toContain("ENG-42");
  });

  it("stores the project's id beside its name on the issue atom, so a join can key on it", () => {
    const records = projectLinearRecords({ issues: [{ ...issue, projectId: "p1" }], projects: [] });
    const atom = records.find((r) => r.kind === "issue")!;
    expect(atom.attrs!["projectId"]).toBe("p1");
    expect(atom.attrs!["project"]).toBe("Search quality");
  });

  it("threads raw payloads onto issue, comment, and project records", () => {
    const records = projectLinearRecords({ issues: [issue], projects: [project] });
    expect(records.find((r) => r.sourceId === "ENG-42")!.raw).toEqual(rawIssue);
    expect(records.find((r) => r.sourceId === "ENG-42:comment:c1")!.raw).toEqual(rawComment);
    expect(records.find((r) => r.sourceId === "project:p1")!.raw).toEqual(rawProject);
  });

  it("projects each comment to a comment record keyed by issue + comment id", () => {
    const records = projectLinearRecords({ issues: [issue], projects: [] });
    const comment = records.find((r) => r.kind === "comment")!;
    expect(comment.sourceId).toBe("ENG-42:comment:c1");
    expect(comment.text).toBe("on it");
    expect(comment.author).toBe("Dana");
  });

  it("projects a project to a `project` record keyed by project id", () => {
    const records = projectLinearRecords({ issues: [], projects: [project] });
    expect(records).toHaveLength(1);
    expect(records[0]!.kind).toBe("project");
    expect(records[0]!.sourceId).toBe("project:p1");
    expect(records[0]!.title).toBe("Search quality");
    expect(records[0]!.text).toContain("State: started");
  });

  it("omits an absent description without faking an empty body", () => {
    const records = projectLinearRecords({
      issues: [
        { comments: [], identifier: "ENG-9", labels: [], title: "bare", tsIso: "2026-05-01T00:00:00.000Z", url: "u" },
      ],
      projects: [],
    });
    expect(records[0]!.text).toBe("bare");
  });
});

describe("projectLinearRecords — an omitted optional list projects exactly as an empty one", () => {
  /** Every record out of the projector, as the bytes bronze would store. */
  function bytes({ records }: { records: ReturnType<typeof projectLinearRecords> }): readonly string[] {
    return records.map((record) => serialiseRecord({ record }));
  }

  it("an issue without `historyRows` carries no digest and no stream counts, byte for byte as with none", () => {
    const without = projectLinearRecords({ issues: [issue], projects: [] });
    const empty = projectLinearRecords({ issues: [{ ...issue, historyRows: [] }], projects: [] });
    expect(bytes({ records: without })).toEqual(bytes({ records: empty }));
    const atom = without.find((r) => r.kind === "issue")!;
    expect(Object.hasOwn(atom.attrs!, "historyEvents")).toBe(false);
    expect(Object.hasOwn(atom.attrs!, "stateSpans")).toBe(false);
    expect(atom.text).not.toContain("Activity");
  });

  it("an issue whose history has rows counts each stream and appends the digest", () => {
    const atom = projectLinearRecords({
      issues: [
        {
          ...issue,
          historyRows: [
            {
              actor: "Seth",
              changes: { toState: { name: "Done" } },
              container: "linear/ENG",
              eventId: "h1",
              source: "linear",
              stream: "history",
              subjectId: "ENG-42",
              tsIso: "2026-05-04T00:00:00.000Z",
              version: 1,
            },
          ],
        },
      ],
      projects: [],
    }).find((r) => r.kind === "issue")!;
    expect(atom.attrs!["historyEvents"]).toBe(1);
    expect(Object.hasOwn(atom.attrs!, "stateSpans")).toBe(false);
    expect(atom.text).toContain("Activity:\n2026-05-04 Seth: state —→Done");
  });

  it("a project without `updates` yields its own record only, exactly as with an empty list", () => {
    const without = projectLinearRecords({ issues: [], projects: [project] });
    expect(without.map((r) => r.sourceId)).toEqual(["project:p1"]);
    expect(bytes({ records: without })).toEqual(
      bytes({ records: projectLinearRecords({ issues: [], projects: [{ ...project, updates: [] }] }) }),
    );
  });

  it("an omitted entity lane yields no records, exactly as an empty one, while a present lane projects", () => {
    const omitted = projectLinearRecords({ issues: [], projects: [] });
    expect(omitted).toEqual([]);
    expect(
      projectLinearRecords({
        customerNeeds: [],
        initiativeUpdates: [],
        issues: [],
        projectMilestones: [],
        projects: [],
      }),
    ).toEqual([]);
    const needs = projectLinearRecords({
      customerNeeds: [{ body: "please export", id: "n1", updatedAt: "2026-05-01T00:00:00.000Z" }],
      issues: [],
      projects: [],
    });
    expect(needs.map((r) => r.sourceId)).toEqual(["need:n1"]);
  });
});

describe("projectLinearRecords — curated layer (PR4.3)", () => {
  it("carries an issue's curated edges + ref-only attachments onto its atom attrs", () => {
    const withEdges: LinearIssueItem = {
      ...issue,
      attachments: ["Design doc (https://figma/x)"],
      edgeRefs: ["sub-issue|linear:ENG-43", "blocks|linear:ENG-99"],
    };
    const atom = projectLinearRecords({ issues: [withEdges], projects: [] }).find((r) => r.sourceId === "ENG-42")!;
    expect(atom.attrs!["curatedEdges"]).toEqual(["sub-issue|linear:ENG-43", "blocks|linear:ENG-99"]);
    expect(atom.attrs!["files"]).toEqual(["Design doc (https://figma/x)"]);
  });

  it("projects a project update to an `update` record classified `status`", () => {
    const withUpdate: LinearProjectItem = {
      ...project,
      updates: [
        {
          body: "on track this week",
          health: "onTrack",
          id: "u1",
          tsIso: "2026-05-03T00:00:00.000Z",
          url: "https://linear.app/u1",
        },
      ],
    };
    const update = projectLinearRecords({ issues: [], projects: [withUpdate] }).find((r) => r.kind === "update")!;
    expect(update.sourceId).toBe("projectUpdate:u1");
    expect(update.text).toBe("on track this week");
    expect(update.attrs!["classification"]).toBe("status");
    expect(update.attrs!["project"]).toBe("Search quality");
  });

  it("projects an initiative to an `initiative` record classified `strategy`", () => {
    const records = projectLinearRecords({
      initiatives: [
        {
          description: "grow retention",
          id: "i1",
          name: "North star",
          tsIso: "2026-05-01T00:00:00.000Z",
          url: "https://linear.app/i1",
        },
      ],
      issues: [],
      projects: [],
    });
    const initiative = records.find((r) => r.kind === "initiative")!;
    expect(initiative.sourceId).toBe("initiative:i1");
    expect(initiative.attrs!["classification"]).toBe("strategy");
  });

  it("projects a document to a `document` record classified `strategy`", () => {
    const records = projectLinearRecords({
      documents: [
        {
          content: "the plan",
          id: "d1",
          title: "Roadmap",
          tsIso: "2026-05-01T00:00:00.000Z",
          url: "https://linear.app/d1",
        },
      ],
      issues: [],
      projects: [],
    });
    const document = records.find((r) => r.kind === "document")!;
    expect(document.sourceId).toBe("document:d1");
    expect(document.attrs!["classification"]).toBe("strategy");
  });
});

describe("TRAP 1 — the enrichment must change the dedup fingerprint, or it never reaches the corpus", () => {
  /** The same issue, thin then enriched, as the connector would project it before and after this change. */
  const thin: LinearIssueItem = {
    comments: [],
    identifier: "ENG-42",
    labels: ["bug"],
    state: "In Progress",
    title: "recall regression",
    tsIso: "2026-05-01T00:00:00.000Z",
    url: "https://linear.app/acme/issue/ENG-42",
  };

  /** One issue record out of the projector. */
  function record({ item }: { item: LinearIssueItem }) {
    return projectLinearRecords({ issues: [item], projects: [] })[0]!;
  }

  it("a NEW attr changes the fingerprint, so the enriched record is written", () => {
    // `recordContentFingerprint` drops `raw` and blanks `tsIso`, and on a duplicate the FIRST-captured record is
    // the one retained. So if the enrichment did not move this value, an already-known issue would look
    // unchanged, the enriched record would be discarded as a duplicate, and the THIN original would stay —
    // with a correct query, a correct API response, and a green suite.
    const enriched = record({ item: { ...thin, cycle: "Cycle 12", priorityLabel: "High" } });
    expect(recordContentFingerprint({ record: enriched })).not.toBe(
      recordContentFingerprint({ record: record({ item: thin }) }),
    );
  });

  it("the history digest in `text` changes the fingerprint too", () => {
    const withHistory = record({
      item: {
        ...thin,
        historyRows: [
          {
            actor: "Seth",
            changes: { toState: { name: "Done" } },
            container: "linear/ENG",
            eventId: "h1",
            source: "linear",
            stream: "history",
            subjectId: "ENG-42",
            tsIso: "2026-05-04T00:00:00.000Z",
            version: 1,
          },
        ],
      },
    });
    expect(recordContentFingerprint({ record: withHistory })).not.toBe(
      recordContentFingerprint({ record: record({ item: thin }) }),
    );
  });

  it("a `raw`-ONLY change does NOT change the fingerprint — which is why `raw` is not a destination", () => {
    const withRaw = record({ item: { ...thin, raw: { anythingAtAll: "a whole extra payload" } } });
    expect(recordContentFingerprint({ record: withRaw })).toBe(
      recordContentFingerprint({ record: record({ item: thin }) }),
    );
  });

  it("a reordered label list does NOT change the fingerprint, so a reshuffle cannot churn bronze forever", () => {
    const forward = record({ item: { ...thin, labels: ["bug", "retrieval"] } });
    const reversed = record({ item: { ...thin, labels: ["retrieval", "bug"] } });
    // The label list arrives in whatever order Linear's connection happened to return it. Before array
    // contents were canonicalised, that alone appended a false new version on every single refresh.
    expect(recordContentFingerprint({ record: reversed })).toBe(recordContentFingerprint({ record: forward }));
  });
});

describe("the bronze emission boundary strips history from `raw`, whoever the caller is", () => {
  /** An item that never went through `parseLinearIssueNode`, carrying full event payloads in `raw`. */
  const smuggled: LinearIssueItem = {
    comments: [],
    identifier: "ENG-99",
    labels: [],
    raw: {
      history: { nodes: [{ actor: { displayName: "Seth" }, createdAt: "2026-05-04T00:00:00.000Z", id: "h1" }] },
      identifier: "ENG-99",
      stateHistory: { nodes: [{ id: "s1", startedAt: "2026-05-01T00:00:00.000Z" }] },
    },
    title: "smuggled",
    tsIso: "2026-05-01T00:00:00.000Z",
    url: "u",
  };

  it("drops both streams even when the parse edge was bypassed entirely", () => {
    // An adversarial review pass found this: `projectLinearRecords` is EXPORTED and takes any `LinearIssueItem`,
    // so stripping only inside the parser enforced the rule at one well-behaved caller rather than at the
    // boundary where records are emitted.
    const record = projectLinearRecords({ issues: [smuggled], projects: [] })[0]!;
    expect(Object.hasOwn(record.raw!, "history")).toBe(false);
    expect(Object.hasOwn(record.raw!, "stateHistory")).toBe(false);
  });

  it("drops a history connection NESTED under a retained key, at any depth", () => {
    // The third finding in this area. The first guard filtered only immediate keys, so this shape carried full
    // actors, timestamps and change payloads into bronze. The production query cannot produce it — but "the
    // current caller cannot" is the reasoning that made the two findings before this one possible.
    const nested: LinearIssueItem = {
      ...smuggled,
      raw: {
        identifier: "ENG-99",
        parent: {
          history: { nodes: [{ actor: { displayName: "Seth" }, createdAt: "2026-05-04T00:00:00.000Z", id: "h1" }] },
          identifier: "ENG-1",
        },
      },
    };
    const record = projectLinearRecords({ issues: [nested], projects: [] })[0]!;
    const parent = record.raw!["parent"];
    if (!isRecord(parent)) {
      throw new Error("expected the projected record's raw.parent to be an object");
    }
    expect(Object.hasOwn(parent, "history")).toBe(false);
    expect(parent["identifier"]).toBe("ENG-1");
    expect(JSON.stringify(record.raw).includes("Seth")).toBe(false);
  });

  it("strips inside an ARRAY as well, so a list of nodes cannot carry one through", () => {
    const inArray: LinearIssueItem = {
      ...smuggled,
      raw: { children: { nodes: [{ history: { nodes: [{ id: "h1" }] }, identifier: "ENG-2" }] } },
    };
    const record = projectLinearRecords({ issues: [inArray], projects: [] })[0]!;
    expect(JSON.stringify(record.raw).includes("history")).toBe(false);
    expect(JSON.stringify(record.raw).includes("ENG-2")).toBe(true);
  });

  it("drops a callable, so a toJSON hook cannot re-inject events at SERIALISATION time", () => {
    // The fourth finding in this area, and the sharpest: every check above passed, then `JSON.stringify` in the
    // writer CALLED the surviving `toJSON` and emitted whatever it returned. The fix is not "also drop toJSON" —
    // that is the first move in an unbounded game. `raw` holds plain JSON data, and a function is not data.
    const hostile: LinearIssueItem = {
      ...smuggled,
      raw: {
        identifier: "ENG-99",
        toJSON: () => ({ history: { nodes: [{ actor: { displayName: "Seth" }, id: "h1" }] }, identifier: "ENG-99" }),
      },
    };
    const record = projectLinearRecords({ issues: [hostile], projects: [] })[0]!;
    // Assert the SERIALISED bytes, not the projected object — the previous test asserted the wrong side of the
    // boundary and passed while the write leaked.
    const line = serialiseRecord({ record });
    expect(line.includes("history")).toBe(false);
    expect(line.includes("Seth")).toBe(false);
    expect(line).toContain("ENG-99");
  });

  it("drops a callable nested as an ARRAY ELEMENT — the rule's last hiding place", () => {
    const smuggler = Object.assign(() => undefined, {
      toJSON: () => ({ history: { nodes: [{ actor: { displayName: "Seth" }, id: "h1" }] } }),
    });
    const hostile: LinearIssueItem = { ...smuggled, raw: { children: [smuggler], identifier: "ENG-99" } };
    const line = serialiseRecord({ record: projectLinearRecords({ issues: [hostile], projects: [] })[0]! });
    expect(line.includes("history")).toBe(false);
    expect(line.includes("Seth")).toBe(false);
  });

  it("drops a hook INHERITED by an array subclass — filter/map would have preserved the species", () => {
    // The review pass's counterexample. `filter().map()` return the same species, so a `toJSON` on the
    // subclass's prototype is never an own entry and survived every own-entry inspection. Rebuilding a plain
    // array is what removes it, and the reason the walk constructs instead of sanitising.
    class HistorySmugglingArray extends Array<unknown> {
      toJSON(): unknown {
        return { history: { nodes: [{ actor: { displayName: "Seth" }, id: "h1" }] } };
      }
    }
    const children = Object.assign(new HistorySmugglingArray(), { 0: { identifier: "ENG-2" }, length: 1 });
    const hostile: LinearIssueItem = { ...smuggled, raw: { children, identifier: "ENG-99" } };
    const line = serialiseRecord({ record: projectLinearRecords({ issues: [hostile], projects: [] })[0]! });
    expect(line.includes("history")).toBe(false);
    expect(line.includes("Seth")).toBe(false);
    // The real datum inside the hostile array is still carried through — this removes the hook, not the data.
    expect(line.includes("ENG-2")).toBe(true);
  });

  it("drops a hook INHERITED by a plain class instance for the same reason", () => {
    class HistorySmugglingBag {
      readonly identifier = "ENG-3";
      toJSON(): unknown {
        return { stateHistory: { nodes: [{ toState: { name: "Done" } }] } };
      }
    }
    const hostile: LinearIssueItem = {
      ...smuggled,
      raw: { identifier: "ENG-99", parent: new HistorySmugglingBag() },
    };
    const line = serialiseRecord({ record: projectLinearRecords({ issues: [hostile], projects: [] })[0]! });
    expect(line.includes("stateHistory")).toBe(false);
    expect(line.includes("Done")).toBe(false);
    expect(line.includes("ENG-3")).toBe(true);
  });

  it("is keyed, NOT content-based: history-shaped data under an unbarred key is carried through", () => {
    // The boundary's stated limit, pinned so it cannot be mistaken for an oversight. A review pass produced
    // this with a getter; the getter was incidental — a plain property yields the same bytes, which is why the
    // fix is a documented scope rather than another hook check. No payload the connector can OBTAIN reaches
    // here, because `history` and `stateHistory` are the only keys its queries select history under.
    const event = { actor: { displayName: "Seth" }, id: "h1" };
    const viaGetter: LinearIssueItem = {
      ...smuggled,
      raw: {
        get elsewhere() {
          return event;
        },
        history: { nodes: [event] },
        identifier: "ENG-99",
      },
    };
    const viaPlainKey: LinearIssueItem = {
      ...smuggled,
      raw: { elsewhere: event, history: { nodes: [event] }, identifier: "ENG-99" },
    };
    const bytes = ({ item }: { item: LinearIssueItem }): string =>
      serialiseRecord({ record: projectLinearRecords({ issues: [item], projects: [] })[0]! });
    // Byte-identical: the accessor is not the mechanism, the unbarred KEY is.
    expect(bytes({ item: viaGetter })).toBe(bytes({ item: viaPlainKey }));
    // The barred key is still gone even in the payload that gets through by another name.
    expect(bytes({ item: viaGetter }).includes('"history"')).toBe(false);
    expect(bytes({ item: viaGetter }).includes("elsewhere")).toBe(true);
  });

  it("keeps every other raw field, so this is a targeted exclusion and not a purge", () => {
    const record = projectLinearRecords({ issues: [smuggled], projects: [] })[0]!;
    expect(record.raw!["identifier"]).toBe("ENG-99");
  });

  it("omits `raw` entirely when the streams were all it held, so the bytes do not change", () => {
    const onlyHistory: LinearIssueItem = { ...smuggled, raw: { history: { nodes: [{ id: "h1" }] } } };
    const record = projectLinearRecords({ issues: [onlyHistory], projects: [] })[0]!;
    expect(Object.hasOwn(record, "raw")).toBe(false);
  });
});
