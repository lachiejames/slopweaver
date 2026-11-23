/**
 * The Linear WRITE seam. Every case here is a shape the API can really return, and most of them look like
 * success at a glance — which is the point: a create that reports success without creating anything is the
 * defect this seam exists to catch.
 *
 * The transport is a plain injected function that counts its calls. That is a seam, not a mock.
 */
import { describe, expect, it } from "vitest";

import { makeLinearWriteApi } from "../../../../corpus/linear/write.js";
import { readIssueFrom, readMilestoneFrom, readProjectFrom } from "../../../../corpus/linear/writeReadBack.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../../../linearWritePrivacyFixture.js";

const ISSUE = { id: "uuid-1", identifier: "AAA-1", url: "https://linear.test/issue/AAA-1" };

/** A transport that returns a fixed payload and records every request it was handed. */
function fakeTransport({ reply }: { reply: unknown }) {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  return {
    calls,
    request: ({ query, variables }: { query: string; variables: Record<string, unknown> }) => {
      calls.push({ query, variables });
      return Promise.resolve(reply);
    },
  };
}

function apiWith({ reply }: { reply: unknown }) {
  const transport = fakeTransport({ reply });
  return {
    api: makeLinearWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      request: transport.request,
      scheduler: (task) => task(),
      token: "lin_api_fake",
    }),
    transport,
  };
}

describe("createIssue", () => {
  it("returns the identity Linear echoed for the object it stored", async () => {
    const { api } = apiWith({ reply: { issueCreate: { issue: ISSUE, success: true } } });
    const result = await api.createIssue({ id: "uuid-1", input: { teamId: "t1", title: "x" } });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ id: "uuid-1" });
  });

  it("sends the CALLER-CHOSEN id inside the input, which is what makes at-most-once possible", async () => {
    const { api, transport } = apiWith({ reply: { issueCreate: { issue: ISSUE, success: true } } });
    await api.createIssue({ id: "uuid-chosen", input: { teamId: "t1", title: "x" } });

    expect(transport.calls.length).toBe(1);
    expect(transport.calls[0]!.variables["input"]).toEqual({ id: "uuid-chosen", teamId: "t1", title: "x" });
  });

  it("FAILS when the payload reports success: false", async () => {
    const { api } = apiWith({ reply: { issueCreate: { issue: null, success: false } } });
    const result = await api.createIssue({ id: "uuid-1", input: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("reported success: false");
  });

  it("FAILS on success: true with a null issue, which the schema genuinely permits", async () => {
    // `IssuePayload.issue` is `Maybe<Issue>`. Trusting `success` alone reports a write that never landed.
    const { api } = apiWith({ reply: { issueCreate: { issue: null, success: true } } });
    const result = await api.createIssue({ id: "uuid-1", input: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("returned no issue");
  });

  it("FAILS on an issue missing its id — the only field the SDK's payload promises", async () => {
    const { api } = apiWith({ reply: { issueCreate: { issue: { identifier: "AAA-1" }, success: true } } });
    const result = await api.createIssue({ id: "uuid-1", input: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("missing its id");
  });

  it("FAILS when the response carries no payload at all", async () => {
    const { api } = apiWith({ reply: {} });
    const result = await api.createIssue({ id: "uuid-1", input: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("no issueCreate payload");
  });

  it("classifies a false success as `parse`, never `http`, so nothing reads it as retryable", async () => {
    const { api } = apiWith({ reply: { issueCreate: { issue: null, success: true } } });
    const result = await api.createIssue({ id: "uuid-1", input: {} });

    expect(result._unsafeUnwrapErr().kind).toBe("parse");
  });

  it("is attempted EXACTLY ONCE when the transport throws — a lost response may still have created it", async () => {
    // The at-most-once guarantee, asserted rather than asserted-in-a-comment. A retry here is how one
    // intent becomes two tickets, and it is invisible until someone looks at the board.
    let attempts = 0;
    const api = makeLinearWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      request: () => {
        attempts += 1;
        return Promise.reject(new Error("socket hang up"));
      },
      scheduler: (task) => task(),
      token: "lin_api_fake",
    });
    const result = await api.createIssue({ id: "uuid-1", input: {} });

    expect(result.isErr()).toBe(true);
    expect(attempts).toBe(1);
  });
});

describe("updateIssue", () => {
  it("returns the identity and sends the id outside the input", async () => {
    const { api, transport } = apiWith({ reply: { issueUpdate: { issue: ISSUE, success: true } } });
    const result = await api.updateIssue({ id: "uuid-1", input: { description: "new" } });

    expect(result._unsafeUnwrap()).toEqual({ id: "uuid-1" });
    expect(transport.calls[0]!.variables).toEqual({ id: "uuid-1", input: { description: "new" } });
  });

  it("FAILS on a null issue exactly as create does", async () => {
    const { api } = apiWith({ reply: { issueUpdate: { issue: null, success: true } } });
    const result = await api.updateIssue({ id: "uuid-1", input: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("returned no issue");
  });

  it("is attempted exactly once when the transport throws", async () => {
    let attempts = 0;
    const api = makeLinearWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      request: () => {
        attempts += 1;
        return Promise.reject(new Error("socket hang up"));
      },
      scheduler: (task) => task(),
      token: "lin_api_fake",
    });
    await api.updateIssue({ id: "uuid-1", input: {} });

    expect(attempts).toBe(1);
  });
});

describe("readIssue", () => {
  it("shapes a full read-back", async () => {
    const { api } = apiWith({
      reply: {
        issue: { ...ISSUE, description: "## Problem\n\nx", title: "A title", updatedAt: "2026-08-01T00:00:00Z" },
      },
    });
    const result = await api.readIssue({ id: "uuid-1" });

    expect(result._unsafeUnwrap()).toEqual({
      description: "## Problem\n\nx",
      id: "uuid-1",
      identifier: "AAA-1",
      title: "A title",
      updatedAt: "2026-08-01T00:00:00Z",
      url: "https://linear.test/issue/AAA-1",
    });
  });

  it("returns undefined rather than an error when the id does not exist", async () => {
    // "This id is not there" is a real answer to a reconciliation question, not a failure to ask.
    const { api } = apiWith({ reply: { issue: null } });
    const result = await api.readIssue({ id: "uuid-missing" });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(undefined);
  });
});

describe("readIssueFrom", () => {
  const full = { ...ISSUE, description: "body", title: "t", updatedAt: "2026-08-01T00:00:00Z" };

  it("distinguishes a NULL description from an empty one", () => {
    // `undefined` means Linear returned none; `""` means it stored an empty body. Collapsing them would let
    // a failed read look like an empty ticket, and `update` decides whether to overwrite on exactly this.
    expect(readIssueFrom({ data: { issue: { ...full, description: null } } })!.description).toBe(undefined);
    expect(readIssueFrom({ data: { issue: { ...full, description: "" } } })!.description).toBe("");
  });

  it("returns undefined for a partial issue rather than filling the gaps", () => {
    expect(readIssueFrom({ data: { issue: { id: "uuid-1", identifier: "AAA-1" } } })).toBe(undefined);
  });

  it("returns undefined for a missing issue and for junk", () => {
    expect(readIssueFrom({ data: { issue: null } })).toBe(undefined);
    expect(readIssueFrom({ data: null })).toBe(undefined);
    expect(readIssueFrom({ data: "nope" })).toBe(undefined);
  });
});

describe("deleteIssue", () => {
  it("reports true on success", async () => {
    const { api } = apiWith({ reply: { issueDelete: { success: true } } });
    expect((await api.deleteIssue({ id: "uuid-1" }))._unsafeUnwrap()).toBe(true);
  });

  it("FAILS rather than reporting a silent no-op when success is false", async () => {
    const { api } = apiWith({ reply: { issueDelete: { success: false } } });
    const result = await api.deleteIssue({ id: "uuid-1" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("did not report success");
  });
});

const PROJECT = { id: "puuid-1", name: "A project", slugId: "a-project", url: "https://linear.test/project/a-project" };

describe("createProject", () => {
  it("returns the identity Linear echoed for the object it stored", async () => {
    const { api } = apiWith({ reply: { projectCreate: { project: PROJECT, success: true } } });
    const result = await api.createProject({ id: "puuid-1", input: { name: "A project", teamIds: ["t1"] } });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ id: "puuid-1" });
  });

  it("sends the CALLER-CHOSEN id inside the input", async () => {
    const { api, transport } = apiWith({ reply: { projectCreate: { project: PROJECT, success: true } } });
    await api.createProject({ id: "puuid-chosen", input: { name: "x", teamIds: ["t1"] } });

    expect(transport.calls[0]!.variables["input"]).toEqual({ id: "puuid-chosen", name: "x", teamIds: ["t1"] });
  });

  it("FAILS when the payload reports success: false", async () => {
    const { api } = apiWith({ reply: { projectCreate: { project: null, success: false } } });
    const result = await api.createProject({ id: "puuid-1", input: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("reported success: false");
  });

  it("FAILS on success: true with a null project", async () => {
    const { api } = apiWith({ reply: { projectCreate: { project: null, success: true } } });
    const result = await api.createProject({ id: "puuid-1", input: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("returned no project");
  });

  it("FAILS on a project missing its id", async () => {
    const { api } = apiWith({
      reply: { projectCreate: { project: { name: "x", url: "https://linear.test/x" }, success: true } },
    });
    const result = await api.createProject({ id: "puuid-1", input: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("missing its id");
  });

  it("is attempted EXACTLY ONCE when the transport throws", async () => {
    let attempts = 0;
    const api = makeLinearWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      request: () => {
        attempts += 1;
        return Promise.reject(new Error("socket hang up"));
      },
      scheduler: (task) => task(),
      token: "lin_api_fake",
    });
    await api.createProject({ id: "puuid-1", input: {} });

    expect(attempts).toBe(1);
  });
});

describe("updateProject", () => {
  it("returns the identity and sends the id outside the input", async () => {
    const { api, transport } = apiWith({ reply: { projectUpdate: { project: PROJECT, success: true } } });
    const result = await api.updateProject({ id: "puuid-1", input: { name: "new" } });

    expect(result._unsafeUnwrap()).toEqual({ id: "puuid-1" });
    expect(transport.calls[0]!.variables).toEqual({ id: "puuid-1", input: { name: "new" } });
  });
});

describe("readProject", () => {
  it("shapes a full read-back", async () => {
    const { api } = apiWith({
      reply: {
        project: { ...PROJECT, description: "a summary", targetDate: "2026-12-01", updatedAt: "2026-08-01T00:00:00Z" },
      },
    });
    const result = await api.readProject({ id: "puuid-1" });

    expect(result._unsafeUnwrap()).toEqual({
      ...PROJECT,
      description: "a summary",
      targetDate: "2026-12-01",
      updatedAt: "2026-08-01T00:00:00Z",
    });
  });

  it("returns undefined rather than an error when the id does not exist", async () => {
    const { api } = apiWith({ reply: { project: null } });
    const result = await api.readProject({ id: "puuid-missing" });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(undefined);
  });
});

describe("readProjectFrom", () => {
  const full = { ...PROJECT, updatedAt: "2026-08-01T00:00:00Z" };

  it("distinguishes a NULL description from an empty one", () => {
    expect(readProjectFrom({ data: { project: { ...full, description: null } } })!.description).toBe(undefined);
    expect(readProjectFrom({ data: { project: { ...full, description: "" } } })!.description).toBe("");
  });

  it("returns undefined for a partial project rather than filling the gaps", () => {
    expect(readProjectFrom({ data: { project: { id: "puuid-1", name: "x" } } })).toBe(undefined);
  });

  it("returns undefined for a missing project and for junk", () => {
    expect(readProjectFrom({ data: { project: null } })).toBe(undefined);
    expect(readProjectFrom({ data: null })).toBe(undefined);
  });
});

/** `project` carries an id and NOTHING else, because that is all `@linear/sdk`'s `ProjectMilestone` selects. */
const MILESTONE = { id: "muuid-1", name: "A milestone", project: { id: "puuid-1" } };

describe("createMilestone", () => {
  it("returns the id alone — the parent project comes from the read-back now", async () => {
    const { api } = apiWith({ reply: { projectMilestoneCreate: { projectMilestone: MILESTONE, success: true } } });
    const result = await api.createMilestone({ id: "muuid-1", input: { name: "A milestone", projectId: "puuid-1" } });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ id: "muuid-1" });
  });

  it("FAILS on a milestone missing its id", async () => {
    const { api } = apiWith({
      reply: { projectMilestoneCreate: { projectMilestone: { name: "x" }, success: true } },
    });
    const result = await api.createMilestone({ id: "muuid-1", input: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("missing its id");
  });

  it("is attempted EXACTLY ONCE when the transport throws", async () => {
    let attempts = 0;
    const api = makeLinearWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      request: () => {
        attempts += 1;
        return Promise.reject(new Error("socket hang up"));
      },
      scheduler: (task) => task(),
      token: "lin_api_fake",
    });
    await api.createMilestone({ id: "muuid-1", input: {} });

    expect(attempts).toBe(1);
  });
});

/**
 * The milestone read-back, whose ONE reply serves both round trips.
 *
 * The fake answers every request with the same document, so a body carrying `projectMilestone` AND `project`
 * feeds the milestone shaper on the first call and the project shaper on the second. The call COUNT is what
 * separates the two — see the follow-up assertions below.
 */
const MILESTONE_READ_REPLY = {
  project: { ...PROJECT, updatedAt: "2026-08-01T00:00:00Z" },
  projectMilestone: {
    ...MILESTONE,
    description: "why it matters",
    targetDate: "2026-12-01",
    updatedAt: "2026-08-01T00:00:00Z",
  },
};

describe("readMilestone", () => {
  it("shapes a full read-back", async () => {
    const { api } = apiWith({ reply: MILESTONE_READ_REPLY });
    const result = await api.readMilestone({ id: "muuid-1" });

    expect(result._unsafeUnwrap()).toEqual({
      description: "why it matters",
      id: "muuid-1",
      name: "A milestone",
      projectId: "puuid-1",
      projectUrl: PROJECT.url,
      targetDate: "2026-12-01",
      updatedAt: "2026-08-01T00:00:00Z",
    });
  });

  it("asks the PROJECT for the url the milestone document does not carry", async () => {
    const { api, transport } = apiWith({ reply: MILESTONE_READ_REPLY });
    await api.readMilestone({ id: "muuid-1" });

    expect(transport.calls.length).toBe(2);
    expect(transport.calls[1]!.variables).toEqual({ id: "puuid-1" });
  });

  it("still yields the milestone when the project it points at is gone, with no url", async () => {
    const { api } = apiWith({ reply: { project: null, projectMilestone: { ...MILESTONE, updatedAt: "2026-08-01" } } });
    const result = await api.readMilestone({ id: "muuid-1" });

    expect(result._unsafeUnwrap()!.id).toBe("muuid-1");
    expect(result._unsafeUnwrap()!.projectId).toBe("puuid-1");
    expect(result._unsafeUnwrap()!.projectUrl).toBe(undefined);
  });

  it("returns undefined rather than an error when the id does not exist", async () => {
    const { api } = apiWith({ reply: { projectMilestone: null } });
    const result = await api.readMilestone({ id: "muuid-missing" });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(undefined);
  });

  it("costs ONE request when the milestone is absent, because there is no project to look up", async () => {
    const { api, transport } = apiWith({ reply: { projectMilestone: null } });
    await api.readMilestone({ id: "muuid-missing" });

    expect(transport.calls.length).toBe(1);
  });
});

describe("deleteProject", () => {
  it("reports true on success", async () => {
    const { api } = apiWith({ reply: { projectDelete: { success: true } } });
    expect((await api.deleteProject({ id: "puuid-1" }))._unsafeUnwrap()).toBe(true);
  });

  it("FAILS rather than reporting a silent no-op when success is false", async () => {
    const { api } = apiWith({ reply: { projectDelete: { success: false } } });
    const result = await api.deleteProject({ id: "puuid-1" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("did not report success");
  });
});

describe("deleteMilestone", () => {
  it("reports true on success", async () => {
    const { api } = apiWith({ reply: { projectMilestoneDelete: { success: true } } });
    expect((await api.deleteMilestone({ id: "muuid-1" }))._unsafeUnwrap()).toBe(true);
  });

  it("FAILS rather than reporting a silent no-op when success is false", async () => {
    const { api } = apiWith({ reply: { projectMilestoneDelete: { success: false } } });
    const result = await api.deleteMilestone({ id: "muuid-1" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("did not report success");
  });
});

describe("readMilestoneFrom", () => {
  const full = { ...MILESTONE, updatedAt: "2026-08-01T00:00:00Z" };

  it("returns undefined when the nested project is missing", () => {
    expect(
      readMilestoneFrom({ data: { projectMilestone: { id: "muuid-1", name: "x", updatedAt: full.updatedAt } } }),
    ).toBe(undefined);
  });

  it("returns undefined for a missing milestone and for junk", () => {
    expect(readMilestoneFrom({ data: { projectMilestone: null } })).toBe(undefined);
    expect(readMilestoneFrom({ data: null })).toBe(undefined);
  });
});
