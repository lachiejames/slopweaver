import { describe, expect, it } from "vitest";

import type { LinearQueryHit } from "../../../../corpus/linear/query.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { LinearLiveErrors } from "../../../../live/linear/errors.js";
import { parseIssueIdentifier } from "../../../../live/linear/issueIdentifier.js";
import { compareHitToLive, verifyLinearHits } from "../../../../live/linear/verify.js";
import type { LinearLiveFacts } from "../../../../live/linear/verifyDocument.js";

const NOW = "2026-09-06T11:00:00.000Z";

const hit = ({
  identifier = "ENG-1",
  kind = "issue" as const,
  state = "In Review",
  assignee = "kim.lee",
  title = "Fix the pool",
}: Partial<Pick<LinearQueryHit, "identifier" | "kind" | "state" | "assignee" | "title">> = {}): LinearQueryHit => ({
  assignee,
  cycleNumber: undefined,
  identifier,
  kind,
  labels: [],
  priority: undefined,
  project: undefined,
  projectId: undefined,
  state,
  stateType: undefined,
  team: "ENG",
  title,
  tsIso: "2026-09-01T00:00:00.000Z",
  url: `https://linear.app/acme/issue/${identifier}`,
});

const BASE_FACTS: LinearLiveFacts = {
  archived: false,
  identifier: "ENG-1",
  owner: "kim.lee",
  state: "In Review",
  title: "Fix the pool",
};

/** Spread rather than defaulted, so an explicitly-`undefined` field STAYS undefined. */
const facts = (over: Partial<LinearLiveFacts> = {}): LinearLiveFacts => ({ ...BASE_FACTS, ...over });

describe("parseIssueIdentifier", () => {
  it("splits an ABC-123 identifier into its team and number", () => {
    expect(parseIssueIdentifier({ identifier: "ENG-1143" })).toEqual({ number: 1143, team: "ENG" });
  });

  it("refuses a UUID rather than reading a real ticket number out of it", () => {
    expect(parseIssueIdentifier({ identifier: "abc-123-uuid" })).toBe(undefined);
  });

  it("refuses an identifier with no number at all", () => {
    expect(parseIssueIdentifier({ identifier: "ENG" })).toBe(undefined);
  });
});

/**
 * One live issue node in the shape `@linear/sdk`'s `Issue` fragment returns it: every relation a bare id,
 * never a name. The names are what {@link verifyLinearHits}'s own resolution pass fetches.
 */
const issueNode = ({
  identifier,
  assignee = "u-kim",
  state = "s-review",
}: {
  identifier: string;
  assignee?: string | null;
  state?: string | null;
}) => ({
  archivedAt: null,
  assignee: assignee === null ? null : { id: assignee },
  identifier,
  state: state === null ? null : { id: state },
  title: "Fix the pool",
  url: "u",
});

/**
 * A transport routing all five documents a verification pass can send: the two reads, and the three
 * id-to-name lookups that resolve what their fragments left as ids.
 */
function verifyTransport({
  issues = [],
  projects = [],
  onQuery,
}: {
  issues?: readonly unknown[];
  projects?: readonly unknown[];
  onQuery?: (args: { query: string; variables: Readonly<Record<string, unknown>> }) => void;
} = {}) {
  return ({ query, variables }: { query: string; variables: Readonly<Record<string, unknown>> }) => {
    onQuery?.({ query, variables });
    if (query.includes("query users(")) {
      return Promise.resolve(ok({ users: { nodes: [{ displayName: "kim.lee", id: "u-kim" }] } }));
    }
    if (query.includes("query workflowStates(")) {
      return Promise.resolve(ok({ workflowStates: { nodes: [{ id: "s-review", name: "In Review" }] } }));
    }
    if (query.includes("query projectStatuses(")) {
      return Promise.resolve(ok({ projectStatuses: { nodes: [{ id: "ps-done", name: "Completed" }] } }));
    }
    if (query.includes("query projects(")) {
      return Promise.resolve(ok({ projects: { nodes: projects } }));
    }
    return Promise.resolve(ok({ issues: { nodes: issues } }));
  };
}

describe("compareHitToLive", () => {
  it("confirms a citation whose every compared field still agrees", () => {
    const verdict = compareHitToLive({ facts: facts(), hit: hit() });
    expect(verdict.status).toBe("confirmed");
    expect(verdict.drifts).toEqual([]);
  });

  it("reports a moved state as local → live", () => {
    const verdict = compareHitToLive({ facts: facts({ state: "Done" }), hit: hit() });
    expect(verdict.status).toBe("changed");
    expect(verdict.drifts).toEqual([{ field: "state", live: "Done", local: "In Review" }]);
  });

  it("reports a reassignment, and an unassignment as (none)", () => {
    const verdict = compareHitToLive({ facts: facts({ owner: undefined }), hit: hit() });
    expect(verdict.drifts).toEqual([{ field: "assignee", live: "(none)", local: "kim.lee" }]);
  });

  it("reports an archived object as a drift rather than as gone", () => {
    const verdict = compareHitToLive({ facts: facts({ archived: true }), hit: hit() });
    expect(verdict.status).toBe("changed");
    expect(verdict.drifts).toEqual([{ field: "archived", live: "true", local: "false" }]);
  });

  it("calls a citation gone when the provider returned nothing for it", () => {
    const verdict = compareHitToLive({ facts: undefined, hit: hit() });
    expect(verdict.status).toBe("gone");
    expect(verdict.drifts).toEqual([]);
  });

  it("does not compare priority, cycle or labels", () => {
    const verdict = compareHitToLive({ facts: facts(), hit: { ...hit(), labels: ["/ship"], priority: 4 } });
    expect(verdict.status).toBe("confirmed");
  });
});

describe("verifyLinearHits", () => {
  it("issues ONE request per distinct team, not one per citation", async () => {
    const teams: unknown[] = [];
    const result = await verifyLinearHits({
      hits: [hit({ identifier: "ENG-1" }), hit({ identifier: "ENG-2" }), hit({ identifier: "INS-9" })],
      nowIso: () => NOW,
      request: verifyTransport({
        issues: [
          issueNode({ identifier: "ENG-1" }),
          issueNode({ identifier: "ENG-2" }),
          issueNode({ identifier: "INS-9" }),
        ],
        onQuery: ({ query, variables }) => {
          if (query.includes("query issues(")) {
            const filter = variables["filter"] as { team: { key: { eq: unknown } } };
            teams.push(filter.team.key.eq);
          }
        },
      }),
    });
    const document = unwrap(result);
    expect(teams).toEqual(["ENG", "INS"]);
    // Two team reads, plus ONE users lookup and ONE workflow-state lookup for the whole page — the
    // resolution pass is bounded by the distinct ids that appeared, never by the number of citations.
    expect(document.requests).toBe(4);
    expect(document.verifications.length).toBe(3);
    expect(document.verifications.every((entry) => entry.status === "confirmed")).toBe(true);
    expect(document.verifiedAtIso).toBe(NOW);
  });

  it("calls a citation gone when the filter returned every OTHER row but not that one", async () => {
    const result = await verifyLinearHits({
      hits: [hit({ identifier: "ENG-1" }), hit({ identifier: "ENG-2" })],
      nowIso: () => NOW,
      request: verifyTransport({ issues: [issueNode({ identifier: "ENG-1" })] }),
    });
    const document = unwrap(result);
    expect(document.verifications.map((entry) => entry.status)).toEqual(["confirmed", "gone"]);
  });

  it("reports an unresolvable assignee id as (none) rather than inventing a name", async () => {
    const result = await verifyLinearHits({
      hits: [hit({ identifier: "ENG-1" })],
      nowIso: () => NOW,
      request: verifyTransport({ issues: [issueNode({ assignee: "u-nobody", identifier: "ENG-1" })] }),
    });
    const document = unwrap(result);
    expect(document.verifications[0]!.drifts).toEqual([{ field: "assignee", live: "(none)", local: "kim.lee" }]);
  });

  it("spends NO resolution request when the page carries no assignee or state at all", async () => {
    const sent: string[] = [];
    const result = await verifyLinearHits({
      hits: [hit({ assignee: undefined, identifier: "ENG-1", state: undefined })],
      nowIso: () => NOW,
      request: verifyTransport({
        issues: [issueNode({ assignee: null, identifier: "ENG-1", state: null })],
        onQuery: ({ query }) => sent.push(query),
      }),
    });

    expect(sent.length).toBe(1);
    expect(unwrap(result).requests).toBe(1);
    // Both facets come back as `(none)` because the object genuinely has neither, not because a lookup was
    // skipped — the citation still claimed both, so it is CHANGED, and that is the drift a reader wants.
    expect(unwrap(result).verifications[0]!.drifts).toEqual([
      { field: "state", live: "(none)", local: "In Review" },
      { field: "assignee", live: "(none)", local: "kim.lee" },
    ]);
  });

  it("reads a project's status NAME off `status`, never the deprecated `state` field", async () => {
    const result = await verifyLinearHits({
      hits: [hit({ assignee: "kim.lee", identifier: "abc-123", kind: "project", state: "Completed" })],
      nowIso: () => NOW,
      request: verifyTransport({
        projects: [
          {
            archivedAt: null,
            id: "abc-123",
            lead: { id: "u-kim" },
            name: "Fix the pool",
            // `state` is the DEPRECATED sibling, and it answers the status TYPE. A shaper reading it would
            // report a false `Completed -> completed` drift on every project citation.
            state: "completed",
            status: { id: "ps-done" },
          },
        ],
      }),
    });
    const document = unwrap(result);
    expect(document.verifications[0]!.status).toBe("confirmed");
  });

  it("returns the provider failure rather than reporting every citation as gone", async () => {
    const result = await verifyLinearHits({
      hits: [hit()],
      nowIso: () => NOW,
      request: () => Promise.resolve(err(LinearLiveErrors.readFailed({ message: "Linear is down" }))),
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toBe("Linear is down");
  });

  it("reports an unparseable issue identifier as unverified rather than filtering on a wrong ticket", async () => {
    let calls = 0;
    const result = await verifyLinearHits({
      hits: [hit({ identifier: "abc-123-uuid" })],
      nowIso: () => NOW,
      request: () => {
        calls += 1;
        return Promise.resolve(ok({}));
      },
    });
    const document = unwrap(result);
    expect(calls).toBe(0);
    expect(document.verifications[0]!.status).toBe("unverified");
    expect(document.verifications[0]!.reason).toBe("identifier is not a `TEAM-123` issue key to filter on");
  });

  it("makes no request at all for an empty page", async () => {
    let calls = 0;
    const result = await verifyLinearHits({
      hits: [],
      nowIso: () => NOW,
      request: () => {
        calls += 1;
        return Promise.resolve(ok({}));
      },
    });
    expect(calls).toBe(0);
    expect(unwrap(result).verifications).toEqual([]);
  });
});
