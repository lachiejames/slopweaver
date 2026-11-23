/**
 * The LABEL lane — which SDK document each write sends, that the caller-chosen id rides inside the input,
 * that `replaceTeamLabels` never does, and what a read-back shapes.
 *
 * The transport is a plain injected function that records every request it was handed. That is a seam, not
 * a mock.
 */
import { describe, expect, it } from "vitest";

import {
  CREATE_ISSUE_LABEL_MUTATION,
  CREATE_PROJECT_LABEL_MUTATION,
  makeLinearLabelWriteApi,
  READ_ISSUE_LABEL_QUERY,
  readLabelFrom,
} from "../../../../corpus/linear/writeLabels.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../../../linearWritePrivacyFixture.js";

const LABEL_ID = "0f1d3c52-7a4e-4b1a-9c2d-6e8f0a1b2c3d";
const TEAM_ID = "5fd296ef-baa7-4bc4-ab3d-3afbc6202759";

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
    api: makeLinearLabelWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      request: transport.request,
      scheduler: (task) => task(),
      token: "lin_api_fake",
    }),
    transport,
  };
}

describe("createIssueLabel", () => {
  it("sends the issue-label document with the CALLER-CHOSEN id inside the input, and nothing else added", async () => {
    const { api, transport } = apiWith({
      reply: { issueLabelCreate: { issueLabel: { id: LABEL_ID }, success: true } },
    });
    const result = await api.createIssueLabel({ id: LABEL_ID, input: { name: "Can drive", teamId: TEAM_ID } });

    expect(result._unsafeUnwrap()).toEqual({ id: LABEL_ID });
    expect(transport.calls).toEqual([
      {
        query: CREATE_ISSUE_LABEL_MUTATION,
        variables: { input: { id: LABEL_ID, name: "Can drive", teamId: TEAM_ID } },
      },
    ]);
  });
});

describe("createProjectLabel", () => {
  it("sends the project-label document, never the issue-label one", async () => {
    const { api, transport } = apiWith({
      reply: { projectLabelCreate: { projectLabel: { id: LABEL_ID }, success: true } },
    });
    const result = await api.createProjectLabel({ id: LABEL_ID, input: { name: "Audit" } });

    expect(result._unsafeUnwrap()).toEqual({ id: LABEL_ID });
    expect(transport.calls).toEqual([
      { query: CREATE_PROJECT_LABEL_MUTATION, variables: { input: { id: LABEL_ID, name: "Audit" } } },
    ]);
  });
});

describe("readIssueLabel", () => {
  it("asks for the exact id and shapes the label it finds", async () => {
    const { api, transport } = apiWith({
      reply: {
        issueLabel: { id: LABEL_ID, isGroup: false, name: "Can drive", parent: { id: "g-1" }, team: { id: TEAM_ID } },
      },
    });
    const result = await api.readIssueLabel({ id: LABEL_ID });

    expect(transport.calls).toEqual([{ query: READ_ISSUE_LABEL_QUERY, variables: { id: LABEL_ID } }]);
    expect(result._unsafeUnwrap()).toEqual({
      groupType: undefined,
      id: LABEL_ID,
      isGroup: false,
      kind: "issue",
      name: "Can drive",
      parentId: "g-1",
      teamId: TEAM_ID,
    });
  });
});

describe("readLabelFrom", () => {
  it("reads a workspace label's null team as no team, which is Linear's own encoding", () => {
    expect(
      readLabelFrom({ data: { projectLabel: { id: LABEL_ID, name: "Audit", team: null } }, kind: "project" }),
    ).toEqual({
      groupType: undefined,
      id: LABEL_ID,
      isGroup: false,
      kind: "project",
      name: "Audit",
      parentId: undefined,
      teamId: undefined,
    });
  });

  it("keeps an issue group's groupType", () => {
    expect(
      readLabelFrom({
        data: { issueLabel: { groupType: "singleSelect", id: LABEL_ID, isGroup: true, name: "Bucket" } },
        kind: "issue",
      })!.groupType,
    ).toBe("singleSelect");
  });

  it("answers undefined for a missing label, and for one read under the other vocabulary's root field", () => {
    expect(readLabelFrom({ data: { issueLabel: null }, kind: "issue" })).toBe(undefined);
    expect(readLabelFrom({ data: { issueLabel: { id: LABEL_ID, name: "Can drive" } }, kind: "project" })).toBe(
      undefined,
    );
  });

  it("answers undefined for a node with no name", () => {
    expect(readLabelFrom({ data: { issueLabel: { id: LABEL_ID } }, kind: "issue" })).toBe(undefined);
  });
});
