/**
 * The group-membership door, checked at the REAL command boundary: run `write vanta group-people` with an
 * injected write client and no approval evidence, and assert Vanta was never reached.
 *
 * The witness is the injected client itself, which records every leg it was handed — so "Vanta was not
 * reached" is asserted through a value that MOVES when it is, rather than through silence. The
 * approved-run block is what proves the witness fires.
 *
 * `--home` is a fresh temp directory on every run, because the door records its decision — the refusal
 * included — in that home's ledger.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { VantaGroupMembershipResponse } from "../../../../../atlas/vanta/groupApiSchemas.js";
import { vantaGroupMembershipDigest } from "../../../../../atlas/vanta/groupMembershipApproval.js";
import type { VantaGroupBatch, VantaGroupWriteClient } from "../../../../../atlas/vanta/groupWriteClient.js";
import { type VantaGroupWriteError, VantaGroupWriteErrors } from "../../../../../atlas/vanta/groupWriteErrors.js";
import { resolveVantaWriteRequest } from "../../../../../atlas/vanta/writePreview.js";
import {
  performVantaGroupPlan,
  resolveVantaGroupLegs,
  runVantaGroupPeopleWith,
  type VantaGroupPeopleDeps,
} from "../../../../../cli/commands/vanta/groupPeopleRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const GROUP = "g_clinical";

/** One leg as the recorder saw it: which direction, which group, which people. */
interface SentLeg {
  readonly direction: "add" | "remove";
  readonly groupId: string;
  readonly ids: readonly string[];
}

/** The digest an operator would read off `--dry-run` for the argv below. */
function digestFor({ add, remove }: { add: readonly string[]; remove: readonly string[] }): string {
  return vantaGroupMembershipDigest({
    requests: resolveVantaGroupLegs({
      plan: { add: add.map((id) => ({ id })), groupId: GROUP, remove: remove.map((id) => ({ id })) },
    }).map((leg) => leg.request),
  });
}

/** The provider effect, and the record of whether it ran. A plain fake function, not a mock. */
function recordingDeps({
  answer,
}: { answer?: (input: VantaGroupBatch) => Result<VantaGroupMembershipResponse, VantaGroupWriteError> } = {}): {
  deps: VantaGroupPeopleDeps;
  sent: SentLeg[];
} {
  const sent: SentLeg[] = [];
  const reply = (input: VantaGroupBatch): Result<VantaGroupMembershipResponse, VantaGroupWriteError> => {
    if (answer === undefined) {
      return ok({ results: input.updates.map((update) => ({ id: update.id, status: "SUCCESS" as const })) });
    }
    return answer(input);
  };
  const client: VantaGroupWriteClient = {
    addPeopleToGroup: (input) => {
      sent.push({ direction: "add", groupId: input.groupId, ids: input.updates.map((u) => u.id) });
      return Promise.resolve(reply(input));
    },
    removePeopleFromGroup: (input) => {
      sent.push({ direction: "remove", groupId: input.groupId, ids: input.updates.map((u) => u.id) });
      return Promise.resolve(reply(input));
    },
  };
  return { deps: { createClient: () => ok(client), doorLedger: memoryDoorLedger().port }, sent };
}

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-vanta-group-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function argv({ approve, extra = [] }: { approve: string | null; extra?: readonly string[] }): readonly string[] {
  return [
    "node",
    "cli",
    "write",
    "vanta",
    "group-people",
    "--group",
    GROUP,
    "--add",
    "p_noor",
    "--remove",
    "p_mark",
    "--home",
    home,
    ...(approve === null ? [] : ["--approve", approve]),
    ...extra,
  ];
}

describe("write vanta group-people, with no approval evidence", () => {
  it("never reaches Vanta", async () => {
    const { deps, sent } = recordingDeps();
    await runVantaGroupPeopleWith({ argv: argv({ approve: null }), deps });
    expect(sent).toEqual([]);
  });

  it("exits 1, the door-refused code, rather than reporting a move that never happened", async () => {
    const { deps } = recordingDeps();
    expect(await runVantaGroupPeopleWith({ argv: argv({ approve: null }), deps })).toBe(EXIT_ERROR);
  });

  it("never reaches Vanta with an approval for a DIFFERENT plan either", async () => {
    const { deps, sent } = recordingDeps();
    const other = digestFor({ add: ["p_noor", "p_adam"], remove: ["p_mark"] });
    expect(await runVantaGroupPeopleWith({ argv: argv({ approve: other }), deps })).toBe(EXIT_ERROR);
    expect(sent).toEqual([]);
  });

  it("is not waivable by the per-action override token", async () => {
    const { deps, sent } = recordingDeps();
    process.env["SLOPWEAVER_DOOR_OVERRIDE"] = "vanta.group-membership-unapproved,door.approval-unbacked";
    try {
      expect(await runVantaGroupPeopleWith({ argv: argv({ approve: null }), deps })).toBe(EXIT_ERROR);
    } finally {
      delete process.env["SLOPWEAVER_DOOR_OVERRIDE"];
    }
    expect(sent).toEqual([]);
  });
});

describe("write vanta group-people, with the digest that covers this exact plan", () => {
  it("sends the add leg first and then the remove leg — the witness fires", async () => {
    const { deps, sent } = recordingDeps();
    const code = await runVantaGroupPeopleWith({
      argv: argv({ approve: digestFor({ add: ["p_noor"], remove: ["p_mark"] }) }),
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(sent).toEqual([
      { direction: "add", groupId: GROUP, ids: ["p_noor"] },
      { direction: "remove", groupId: GROUP, ids: ["p_mark"] },
    ]);
  });

  it("exits 1 when Vanta refuses one person, even though the call itself was accepted", async () => {
    const { deps, sent } = recordingDeps({
      answer: (input) =>
        ok({ results: input.updates.map((update) => ({ id: update.id, message: "no such person", status: "ERROR" })) }),
    });
    const code = await runVantaGroupPeopleWith({
      argv: argv({ approve: digestFor({ add: ["p_noor"], remove: ["p_mark"] }) }),
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(sent.length).toBe(2);
  });

  it("stops after a leg whose outcome cannot be read, leaving the second leg unsent", async () => {
    const { deps, sent } = recordingDeps({
      answer: () =>
        err(VantaGroupWriteErrors.unreadable({ problems: ["the request to /v1/groups never reached api.vanta.com"] })),
    });
    const code = await runVantaGroupPeopleWith({
      argv: argv({ approve: digestFor({ add: ["p_noor"], remove: ["p_mark"] }) }),
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(sent).toEqual([{ direction: "add", groupId: GROUP, ids: ["p_noor"] }]);
  });
});

describe("--dry-run stops before the door, so it needs no approval and records nothing", () => {
  it("exits 0 and reaches Vanta not at all", async () => {
    const { deps, sent } = recordingDeps();
    const code = await runVantaGroupPeopleWith({ argv: argv({ approve: null, extra: ["--dry-run"] }), deps });
    expect(code).toBe(EXIT_OK);
    expect(sent).toEqual([]);
  });
});

describe("a plan the verb refuses before any of this", () => {
  it("exits 2 and reaches Vanta not at all when the plan moves nobody", async () => {
    const { deps, sent } = recordingDeps();
    const code = await runVantaGroupPeopleWith({
      argv: ["node", "cli", "write", "vanta", "group-people", "--group", GROUP, "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(sent).toEqual([]);
  });

  it("exits 2 and reaches Vanta not at all when the same person is on both sides", async () => {
    const { deps, sent } = recordingDeps();
    const code = await runVantaGroupPeopleWith({
      argv: [
        "node",
        "cli",
        "write",
        "vanta",
        "group-people",
        "--group",
        GROUP,
        "--add",
        "p_noor",
        "--remove",
        "p_noor",
        "--home",
        home,
      ],
      deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(sent).toEqual([]);
  });
});

describe("resolveVantaGroupLegs", () => {
  it("sends the add leg first, because the two legs are not a transaction and an order had to be picked", () => {
    const legs = resolveVantaGroupLegs({
      plan: { add: [{ id: "p1" }], groupId: GROUP, remove: [{ id: "p2" }] },
    });
    expect(legs.map((leg) => leg.direction)).toEqual(["add", "remove"]);
  });

  it("resolves no leg at all for an empty direction, rather than a request for nobody", () => {
    const legs = resolveVantaGroupLegs({ plan: { add: [{ id: "p1" }], groupId: GROUP, remove: [] } });
    expect(legs.length).toBe(1);
    expect(legs[0]!.request).toEqual(
      resolveVantaWriteRequest({ input: { groupId: GROUP, updates: [{ id: "p1" }] }, kind: "add-people-to-group" }),
    );
  });
});

describe("performVantaGroupPlan", () => {
  it("records the later leg as NOT ATTEMPTED rather than discarding what the first leg achieved", async () => {
    const seen: string[] = [];
    const client: VantaGroupWriteClient = {
      addPeopleToGroup: (input) => {
        seen.push("add");
        return Promise.resolve(
          ok({ results: input.updates.map((u) => ({ id: u.id, message: "nope", status: "ERROR" as const })) }),
        );
      },
      removePeopleFromGroup: () => {
        seen.push("remove");
        return Promise.resolve(err(VantaGroupWriteErrors.unreadable({ problems: ["sent, no readable answer"] })));
      },
    };
    // The add leg COMPLETES (its people were refused per person), so the run does not stop: a read
    // outcome is not a stopped one.
    const report = await performVantaGroupPlan({
      client,
      plan: { add: [{ id: "p1" }], groupId: GROUP, remove: [{ id: "p2" }] },
    });
    expect(seen).toEqual(["add", "remove"]);
    expect(report.outcomes[0]!.state).toBe("completed");
    expect(report.outcomes[1]!.state).toBe("unconfirmed");
  });

  it("marks every later leg unsent once one leg's outcome could not be read", async () => {
    const client: VantaGroupWriteClient = {
      addPeopleToGroup: () =>
        Promise.resolve(err(VantaGroupWriteErrors.unreadable({ problems: ["a body this package cannot read"] }))),
      removePeopleFromGroup: () => Promise.resolve(ok({ results: [] })),
    };
    const report = await performVantaGroupPlan({
      client,
      plan: { add: [{ id: "p1" }], groupId: GROUP, remove: [{ id: "p2" }] },
    });
    expect(report.outcomes[0]!.state).toBe("unconfirmed");
    expect(report.outcomes[1]).toEqual({
      because: "the add leg did not complete, so this one was never sent — read the group back before approving again",
      direction: "remove",
      requestedIds: ["p2"],
      state: "not-attempted",
    });
  });

  it("refuses a response answering for the wrong people rather than reporting them moved", async () => {
    const client: VantaGroupWriteClient = {
      addPeopleToGroup: () => Promise.resolve(ok({ results: [{ id: "somebody-else", status: "SUCCESS" as const }] })),
      removePeopleFromGroup: () => Promise.resolve(ok({ results: [] })),
    };
    const report = await performVantaGroupPlan({ client, plan: { add: [{ id: "p1" }], groupId: GROUP, remove: [] } });
    expect(report.outcomes[0]!.state).toBe("unconfirmed");
  });

  it("calls a leg the token refresh stopped NOT ATTEMPTED, never sent-and-unreadable", async () => {
    // Property `partial-failure-is-never-success`: the add leg completes, the token
    // then fails to refresh, and the remove request is never dispatched. Folding that into `unconfirmed`
    // told an auditor to go and read back a group this run never wrote to. The two states are opposite
    // claims about the network, so the assertion below is on WHICH one, not merely on "it failed".
    const seen: string[] = [];
    const client: VantaGroupWriteClient = {
      addPeopleToGroup: (input) => {
        seen.push("add");
        return Promise.resolve(ok({ results: input.updates.map((u) => ({ id: u.id, status: "SUCCESS" as const })) }));
      },
      removePeopleFromGroup: () => {
        seen.push("remove");
        return Promise.resolve(
          err(VantaGroupWriteErrors.notDispatched({ problems: ["vanta token refresh failed with HTTP 503"] })),
        );
      },
    };
    const report = await performVantaGroupPlan({
      client,
      plan: { add: [{ id: "p1" }], groupId: GROUP, remove: [{ id: "p2" }] },
    });
    expect(seen).toEqual(["add", "remove"]);
    expect(report.outcomes[0]!.state).toBe("completed");
    expect(report.outcomes[1]).toEqual({
      because: "the remove leg was never sent: vanta token refresh failed with HTTP 503",
      direction: "remove",
      requestedIds: ["p2"],
      state: "not-attempted",
    });
  });

  it("stops the run on a never-sent FIRST leg, so the second is not spent learning the same thing", async () => {
    const seen: string[] = [];
    const client: VantaGroupWriteClient = {
      addPeopleToGroup: () => {
        seen.push("add");
        return Promise.resolve(
          err(VantaGroupWriteErrors.notDispatched({ problems: ["vanta token refresh failed with HTTP 503"] })),
        );
      },
      removePeopleFromGroup: () => {
        seen.push("remove");
        return Promise.resolve(ok({ results: [] }));
      },
    };
    const report = await performVantaGroupPlan({
      client,
      plan: { add: [{ id: "p1" }], groupId: GROUP, remove: [{ id: "p2" }] },
    });
    expect(seen).toEqual(["add"]);
    expect(report.outcomes[0]!.state).toBe("not-attempted");
    expect(report.outcomes[1]!.state).toBe("not-attempted");
  });
});
