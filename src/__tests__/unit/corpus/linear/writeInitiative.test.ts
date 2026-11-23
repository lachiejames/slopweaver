/**
 * The INITIATIVE lane — what its four writes hand back, what its three read-backs shape, and which SDK
 * documents it sends.
 *
 * Same class of check `write.test.ts` runs for issues and projects, and here for the same reason: every one
 * of these payload objects is nullable, so a 200 carrying `success: true` and a null object is a real API
 * shape. A parser that read one as a write would report a created initiative that does not exist.
 *
 * The transport is a plain injected function that records every request it was handed. That is a seam, not
 * a mock. Every other edge is a plain value.
 */
import { describe, expect, it } from "vitest";

import {
  ARCHIVE_INITIATIVE_UPDATE_MUTATION,
  CREATE_INITIATIVE_LINK_MUTATION,
  CREATE_INITIATIVE_MUTATION,
  CREATE_INITIATIVE_UPDATE_MUTATION,
  DELETE_INITIATIVE_LINK_MUTATION,
  DELETE_INITIATIVE_MUTATION,
  makeLinearInitiativeWriteApi,
  READ_INITIATIVE_LINK_QUERY,
  READ_INITIATIVE_QUERY,
  READ_INITIATIVE_UPDATE_QUERY,
  readInitiativeFrom,
  readInitiativeLinkFrom,
  readInitiativeUpdateFrom,
  UPDATE_INITIATIVE_MUTATION,
} from "../../../../corpus/linear/writeInitiative.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../../../linearWritePrivacyFixture.js";

const INITIATIVE = {
  id: "aa831adf-e969-430b-abd3-d72397f6b8e9",
  name: "Ship the thing",
  slugId: "c52d854e84c6",
  url: "https://linear.test/acme/initiative/ship-the-thing-c52d854e84c6",
};

const UPDATE = { health: "onTrack", id: "u1", url: "https://linear.test/initiative/x/activity#u1" };

const LINK = { id: "l1", initiative: { id: INITIATIVE.id }, project: { id: "p1" } };

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
    api: makeLinearInitiativeWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      request: transport.request,
      scheduler: (task) => task(),
      token: "lin_api_fake",
    }),
    transport,
  };
}

describe("createInitiative", () => {
  it("returns the id ALONE, because the SDK's InitiativePayload echoes nothing else", async () => {
    const { api } = apiWith({ reply: { initiativeCreate: { initiative: INITIATIVE, success: true } } });
    const result = await api.createInitiative({ id: INITIATIVE.id, input: { name: "Ship the thing" } });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ id: INITIATIVE.id });
  });

  it("sends the CALLER-CHOSEN id inside the input, which is what makes at-most-once possible", async () => {
    const { api, transport } = apiWith({
      reply: { initiativeCreate: { initiative: INITIATIVE, success: true } },
    });
    await api.createInitiative({ id: INITIATIVE.id, input: { name: "Ship the thing" } });

    expect(transport.calls[0]!.variables).toEqual({ input: { id: INITIATIVE.id, name: "Ship the thing" } });
  });

  it("names the false success where the payload reports success with a null initiative", async () => {
    const { api } = apiWith({ reply: { initiativeCreate: { initiative: null, success: true } } });
    const result = await api.createInitiative({ id: INITIATIVE.id, input: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("initiativeCreate reported success but returned no initiative");
  });

  it("names the missing payload where the mutation field is absent entirely", async () => {
    const { api } = apiWith({ reply: {} });
    const result = await api.createInitiative({ id: INITIATIVE.id, input: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("the response carried no initiativeCreate payload");
  });

  it("FAILS on an initiative missing its id — the only field the SDK's payload promises", async () => {
    const { api } = apiWith({
      reply: { initiativeCreate: { initiative: { name: "n", slugId: "s" }, success: true } },
    });
    const result = await api.createInitiative({ id: INITIATIVE.id, input: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("missing its id");
  });
});

describe("updateInitiative", () => {
  it("sends the id and the input separately, which is what makes it patch-shaped", async () => {
    const { api, transport } = apiWith({
      reply: { initiativeUpdate: { initiative: INITIATIVE, success: true } },
    });
    const result = await api.updateInitiative({ id: INITIATIVE.id, input: { name: "new" } });

    expect(result._unsafeUnwrap()).toEqual({ id: INITIATIVE.id });
    expect(transport.calls[0]!.variables).toEqual({ id: INITIATIVE.id, input: { name: "new" } });
  });
});

describe("createInitiativeUpdate", () => {
  it("returns the id alone — the health a report states now comes from the read-back", async () => {
    const { api } = apiWith({ reply: { initiativeUpdateCreate: { initiativeUpdate: UPDATE, success: true } } });
    const result = await api.createInitiativeUpdate({ id: "u1", input: { health: "onTrack" } });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ id: "u1" });
  });

  it("names the false success where the payload reports success with a null update", async () => {
    const { api } = apiWith({ reply: { initiativeUpdateCreate: { initiativeUpdate: null, success: true } } });
    const result = await api.createInitiativeUpdate({ id: "u1", input: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("returned no initiativeUpdate");
  });
});

describe("createInitiativeLink", () => {
  it("returns the edge's id alone — neither endpoint is echoed by the SDK's payload", async () => {
    const { api } = apiWith({
      reply: { initiativeToProjectCreate: { initiativeToProject: LINK, success: true } },
    });
    const result = await api.createInitiativeLink({ id: "l1", input: { initiativeId: INITIATIVE.id } });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ id: "l1" });
  });

  it("FAILS on a link payload that reports success with no edge at all", async () => {
    const { api } = apiWith({ reply: { initiativeToProjectCreate: { initiativeToProject: null, success: true } } });
    const result = await api.createInitiativeLink({ id: "l1", input: {} });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("returned no initiativeToProject");
  });
});

describe("the read-backs", () => {
  it("shapes an initiative, carrying the stored status and target date", () => {
    const found = readInitiativeFrom({
      data: {
        initiative: {
          ...INITIATIVE,
          description: "d",
          status: "Planned",
          targetDate: "2026-12-31",
          updatedAt: "2026-09-07T00:00:00.000Z",
        },
      },
    });

    expect(found!.status).toBe("Planned");
    expect(found!.targetDate).toBe("2026-12-31");
    expect(found!.description).toBe("d");
  });

  it("reports a MISSING initiative as undefined, which is a real answer rather than a failure", () => {
    expect(readInitiativeFrom({ data: { initiative: null } })).toBe(undefined);
  });

  it("distinguishes a stored empty description from none at all", () => {
    const found = readInitiativeFrom({
      data: { initiative: { ...INITIATIVE, description: "", updatedAt: "2026-09-07T00:00:00.000Z" } },
    });

    expect(found!.description).toBe("");
    expect(found!.status).toBe(undefined);
  });

  it("shapes an initiative update, carrying the body the fidelity check compares", () => {
    const found = readInitiativeUpdateFrom({
      data: { initiativeUpdate: { ...UPDATE, body: "Shipped four.", updatedAt: "2026-09-07T00:00:00.000Z" } },
    });

    expect(found!.body).toBe("Shipped four.");
    expect(found!.health).toBe("onTrack");
  });

  it("shapes a link", () => {
    expect(readInitiativeLinkFrom({ data: { initiativeToProject: LINK } })!.projectId).toBe("p1");
  });

  it("reports a missing link as undefined", () => {
    expect(readInitiativeLinkFrom({ data: { initiativeToProject: null } })).toBe(undefined);
  });
});

describe("the documents this lane sends are the SDK's own", () => {
  it("creates through the SDK's InitiativePayload, which echoes the initiative as a bare id", () => {
    expect(CREATE_INITIATIVE_MUTATION).toContain("mutation createInitiative($input: InitiativeCreateInput!)");
    expect(CREATE_INITIATIVE_MUTATION).toContain("...InitiativePayload");
    expect(CREATE_INITIATIVE_MUTATION).toContain("fragment InitiativePayload on InitiativePayload");
  });

  it("keeps the two operations Linear names `initiativeUpdate` apart by word order alone", () => {
    expect(UPDATE_INITIATIVE_MUTATION).toContain(
      "mutation updateInitiative($id: String!, $input: InitiativeUpdateInput!)",
    );
    expect(UPDATE_INITIATIVE_MUTATION).toContain("initiativeUpdate(id: $id, input: $input)");
    expect(READ_INITIATIVE_UPDATE_QUERY).toContain("query initiativeUpdate($id: String!)");
    expect(READ_INITIATIVE_UPDATE_QUERY).toContain("initiativeUpdate(id: $id)");
  });

  it("posts a status update through the SDK's InitiativeUpdatePayload", () => {
    expect(CREATE_INITIATIVE_UPDATE_MUTATION).toContain(
      "mutation createInitiativeUpdate($input: InitiativeUpdateCreateInput!)",
    );
    expect(CREATE_INITIATIVE_UPDATE_MUTATION).toContain("...InitiativeUpdatePayload");
  });

  it("asserts a link through the SDK's InitiativeToProjectPayload", () => {
    expect(CREATE_INITIATIVE_LINK_MUTATION).toContain(
      "mutation createInitiativeToProject($input: InitiativeToProjectCreateInput!)",
    );
    expect(CREATE_INITIATIVE_LINK_MUTATION).toContain("...InitiativeToProjectPayload");
  });

  it("tears an update down by ARCHIVE, which is the only teardown Linear ships for the kind", () => {
    expect(ARCHIVE_INITIATIVE_UPDATE_MUTATION).toContain("initiativeUpdateArchive(id: $id)");
  });

  it("names the delete mutations Linear actually ships for the two kinds that have one", () => {
    expect(DELETE_INITIATIVE_MUTATION).toContain("initiativeDelete(id: $id)");
    expect(DELETE_INITIATIVE_LINK_MUTATION).toContain("initiativeToProjectDelete(id: $id)");
  });
});

describe("the SDK read-back documents carry what their shapers read", () => {
  it("asks an initiative for the status, target date and slug the shaper reports", () => {
    expect(READ_INITIATIVE_QUERY).toContain("fragment Initiative on Initiative");
    expect(READ_INITIATIVE_QUERY).toContain("targetDate");
    expect(READ_INITIATIVE_QUERY).toContain("slugId");
    expect(READ_INITIATIVE_QUERY).toContain("status");
  });

  it("asks an update for the body and health the fidelity comparison would read", () => {
    expect(READ_INITIATIVE_UPDATE_QUERY).toContain("fragment InitiativeUpdate on InitiativeUpdate");
    expect(READ_INITIATIVE_UPDATE_QUERY).toContain("body");
    expect(READ_INITIATIVE_UPDATE_QUERY).toContain("health");
  });

  it("asks a link for both endpoints, so a read-back can prove which pair it joined", () => {
    expect(READ_INITIATIVE_LINK_QUERY).toContain("fragment InitiativeToProject on InitiativeToProject");
    expect(READ_INITIATIVE_LINK_QUERY).toContain("initiative {\n    id\n  }");
    expect(READ_INITIATIVE_LINK_QUERY).toContain("project {\n    id\n  }");
  });
});
