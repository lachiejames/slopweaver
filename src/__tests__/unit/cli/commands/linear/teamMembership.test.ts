/**
 * `linear team-membership join|leave`: the token's own user joins or leaves one team, previewed unless
 * `--apply`, confirmed by reading the memberships back, and journalled under `--unasked` with the opposite
 * verb as its rollback.
 *
 * Pure functions are tested directly; the verb is driven end-to-end through plain injected functions. No mocks.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterAll, describe, expect, it } from "vitest";
import {
  membershipPreviewLines,
  membershipRollback,
  parseTeamMembershipArgs,
} from "../../../../../cli/commands/linear/teamMembershipCore.js";
import {
  runLinearTeamMembership,
  type TeamMembershipDeps,
} from "../../../../../cli/commands/linear/teamMembershipRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import {
  type LinearTeamMembershipWriteApi,
  makeLinearTeamMembershipWriteApi,
} from "../../../../../corpus/linear/writeTeamMembership.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { LinearLiveErrors } from "../../../../../live/linear/errors.js";
import { type LinearMembershipState, membershipIdFrom, viewerFrom } from "../../../../../live/linear/teamMembership.js";
import { heldAutonomyRecords, memoryAutonomyLedgerPort } from "../../../../autonomyLedgerFixture.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../../../../linearWritePrivacyFixture.js";

/** Every scratch home this file mints, removed in `afterAll` — see `.claude/rules/testing.md`. */
const homes: string[] = [];

afterAll(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-team-membership-"));
  homes.push(home);
  return home;
}

const TEAM = { id: "team-eng", key: "ENG", name: "Engineering" };
const VIEWER = { id: "user-ada", name: "Ada", url: "https://linear.test/profiles/ada" };

const NOT_MEMBER: LinearMembershipState = { membershipId: undefined, team: TEAM, viewer: VIEWER };
const MEMBER: LinearMembershipState = { membershipId: "membership-1", team: TEAM, viewer: VIEWER };

const NOTE = {
  bySession: "graduated-autonomy-294-46",
  said: "Joined Engineering, because the ticket you own moved there.",
  why: "the issue moved to ENG and they could no longer see its comments",
};

const UNASKED_FLAGS = ["--unasked", "--why", NOTE.why, "--said", NOTE.said, "--by-session", NOTE.bySession];

const TRANSPORT_ERROR: IngestError = {
  kind: "network",
  message: "socket hang up",
  operation: "linear.teamMembershipCreate",
  provider: "linear",
};

/** A harness whose memberships flip to `after` once a write is sent, and stay at `before` until then. */
function harness({
  before,
  after,
  writeFails = false,
}: {
  before: string | undefined;
  after: string | undefined;
  writeFails?: boolean;
}): {
  deps: TeamMembershipDeps;
  joins: { teamId: string; userId: string }[];
  leaves: string[];
  out: string[];
  err: string[];
} {
  const joins: { teamId: string; userId: string }[] = [];
  const leaves: string[] = [];
  const out: string[] = [];
  const errLines: string[] = [];
  const sent = (): boolean => joins.length + leaves.length > 0;
  const api: LinearTeamMembershipWriteApi = {
    join: (args) => {
      joins.push(args);
      return writeFails ? errAsync(TRANSPORT_ERROR) : okAsync({ id: "membership-new" });
    },
    leave: ({ membershipId }) => {
      leaves.push(membershipId);
      return writeFails ? errAsync(TRANSPORT_ERROR) : okAsync(true);
    },
  };
  return {
    deps: {
      autonomy: memoryAutonomyLedgerPort(),
      doorLedger: memoryDoorLedger().port,
      err: (line) => errLines.push(line),
      makeApi: () => api,
      nowIso: () => "2026-10-02T10:00:00.000Z",
      out: (line) => out.push(line),
      readMembershipId: async () => ok(sent() ? after : before),
      readState: async () => ok({ membershipId: before, team: TEAM, viewer: VIEWER }),
      resolveToken: () => "lin_api_test",
    },
    err: errLines,
    joins,
    leaves,
    out,
  };
}

function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "linear", "team-membership", ...rest];
}

describe("parseTeamMembershipArgs", () => {
  it("parses a join as a preview unless --apply is given", () => {
    const parsed = unwrap(parseTeamMembershipArgs({ argv: ["join", "--team", "ENG"] }));

    expect(parsed).toEqual({ action: "join", apply: false, home: undefined, teamKey: "ENG", unasked: undefined });
  });

  it("carries --apply and the three unasked accounts on a leave", () => {
    const parsed = unwrap(parseTeamMembershipArgs({ argv: ["leave", "--team", "ENG", "--apply", ...UNASKED_FLAGS] }));

    expect(parsed.action).toBe("leave");
    expect(parsed.apply).toBe(true);
    expect(parsed.unasked).toEqual(NOTE);
  });

  it("refuses an action that is neither join nor leave", () => {
    const parsed = parseTeamMembershipArgs({ argv: ["add", "--team", "ENG"] });

    expect(parsed._unsafeUnwrapErr().message).toContain("team-membership <join|leave>");
  });

  it("refuses a missing team", () => {
    const parsed = parseTeamMembershipArgs({ argv: ["join"] });

    expect(parsed._unsafeUnwrapErr().code).toBe("FLAG_MISSING");
  });

  it("refuses --unasked without all three accounts", () => {
    const parsed = parseTeamMembershipArgs({ argv: ["join", "--team", "ENG", "--unasked", "--why", "w"] });

    expect(parsed._unsafeUnwrapErr().message).toContain("--why, --said and --by-session are all required");
  });
});

describe("membershipIdFrom", () => {
  const page = ({ nodes, hasNextPage }: { nodes: unknown[]; hasNextPage: boolean }): unknown => ({
    viewer: { teamMemberships: { nodes, pageInfo: { hasNextPage } } },
  });

  it("finds the viewer's membership on the team", () => {
    const value = page({
      hasNextPage: false,
      nodes: [
        { id: "m-other", team: { id: "team-ops" } },
        { id: "m-eng", team: { id: "team-eng" } },
      ],
    });

    expect(unwrap(membershipIdFrom({ teamId: "team-eng", value }))).toBe("m-eng");
  });

  it("answers undefined when the whole list holds no membership on the team", () => {
    const value = page({ hasNextPage: false, nodes: [{ id: "m-other", team: { id: "team-ops" } }] });

    expect(unwrap(membershipIdFrom({ teamId: "team-eng", value }))).toBe(undefined);
  });

  it("refuses a page that has more, because absence from it proves nothing", () => {
    const value = page({ hasNextPage: true, nodes: [] });

    expect(membershipIdFrom({ teamId: "team-eng", value })._unsafeUnwrapErr().message).toContain(
      "absence from one page proves nothing",
    );
  });

  it("refuses two memberships on one team rather than guessing", () => {
    const value = page({
      hasNextPage: false,
      nodes: [
        { id: "m-1", team: { id: "team-eng" } },
        { id: "m-2", team: { id: "team-eng" } },
      ],
    });

    expect(membershipIdFrom({ teamId: "team-eng", value })._unsafeUnwrapErr().code).toBe("AMBIGUOUS_ADDRESS");
  });
});

describe("makeLinearTeamMembershipWriteApi", () => {
  it("sends a join as teamMembershipCreate for the given team and user, and reads the id it returns", async () => {
    const sent: Record<string, unknown>[] = [];
    const api = makeLinearTeamMembershipWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      request: async ({ variables }) => {
        sent.push(variables);
        return { teamMembershipCreate: { success: true, teamMembership: { id: "m-new" } } };
      },
      token: "lin_api_test",
    });

    const written = await api.join({ teamId: "team-eng", userId: "user-ada" });

    expect(unwrap(written)).toEqual({ id: "m-new" });
    expect(sent).toEqual([{ input: { teamId: "team-eng", userId: "user-ada" } }]);
  });

  it("sends a leave as teamMembershipDelete by membership id, and fails a payload that reports no success", async () => {
    const sent: Record<string, unknown>[] = [];
    const api = makeLinearTeamMembershipWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      request: async ({ variables }) => {
        sent.push(variables);
        return { teamMembershipDelete: { success: false } };
      },
      token: "lin_api_test",
    });

    const left = await api.leave({ membershipId: "membership-1" });

    expect(sent).toEqual([{ id: "membership-1" }]);
    expect(left._unsafeUnwrapErr().message).toBe(
      "linear.teamMembershipDelete: teamMembershipDelete did not report success",
    );
  });
});

describe("viewerFrom", () => {
  it("shapes the token's own user", () => {
    const value = { viewer: { id: VIEWER.id, name: VIEWER.name, url: VIEWER.url } };

    expect(unwrap(viewerFrom({ value }))).toEqual(VIEWER);
  });

  it("refuses a viewer with no URL to name in a ledger row", () => {
    expect(viewerFrom({ value: { viewer: { id: "u", name: "n" } } })._unsafeUnwrapErr().code).toBe("READ_FAILED");
  });
});

describe("membershipPreviewLines", () => {
  it("previews a join the viewer has not made", () => {
    expect(membershipPreviewLines({ action: "join", apply: false, state: NOT_MEMBER })).toEqual([
      "team:    ENG — Engineering (team-eng)",
      "viewer:  Ada (user-ada), the token's own user",
      "now:     not a member",
      "would:   join ENG",
      "preview only: --apply sends it",
    ]);
  });

  it("says a leave of a team the viewer is not on sends nothing", () => {
    const lines = membershipPreviewLines({ action: "leave", apply: true, state: NOT_MEMBER });

    expect(lines.at(-1)).toBe("nothing to leave: the viewer is already not a member. Nothing was sent.");
  });

  it("says a join of a team the viewer is already on sends nothing, naming the membership", () => {
    const lines = membershipPreviewLines({ action: "join", apply: true, state: MEMBER });

    expect(lines.at(-1)).toBe(
      "nothing to join: the viewer is already a member (membership membership-1). Nothing was sent.",
    );
  });

  it("names the leave it is sending under --apply", () => {
    const lines = membershipPreviewLines({ action: "leave", apply: true, state: MEMBER });

    expect(lines.slice(2)).toEqual(["now:     a member (membership membership-1)", "sending: leave ENG"]);
  });

  it("names the opposite verb as the rollback", () => {
    expect(membershipRollback({ action: "join", teamKey: "ENG" })).toBe(
      "rollback: slopweaver linear team-membership leave --team ENG --apply",
    );
  });
});

describe("runLinearTeamMembership", () => {
  it("reads and previews without --apply, and sends nothing", async () => {
    const h = harness({ after: "membership-new", before: undefined });

    const code = await runLinearTeamMembership({
      argv: argv({ rest: ["join", "--team", "ENG", "--home", tempHome()] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.joins.length).toBe(0);
    expect(h.out).toContain("would:   join ENG");
  });

  it("sends nothing when the viewer is already where the action would put it", async () => {
    const h = harness({ after: "membership-1", before: "membership-1" });

    const code = await runLinearTeamMembership({
      argv: argv({ rest: ["join", "--team", "ENG", "--apply", "--home", tempHome()] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.joins.length).toBe(0);
  });

  it("joins as the token's own user under --apply, confirmed by the read-back", async () => {
    const h = harness({ after: "membership-new", before: undefined });

    const code = await runLinearTeamMembership({
      argv: argv({ rest: ["join", "--team", "ENG", "--apply", "--home", tempHome()] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.joins).toEqual([{ teamId: "team-eng", userId: "user-ada" }]);
    expect(h.out).toContain("joined ENG, confirmed by reading the viewer's memberships back");
  });

  it("leaves by the membership id the read found", async () => {
    const h = harness({ after: undefined, before: "membership-1" });

    const code = await runLinearTeamMembership({
      argv: argv({ rest: ["leave", "--team", "ENG", "--apply", "--home", tempHome()] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.leaves).toEqual(["membership-1"]);
  });

  it("journals an --unasked join with the leave as its rollback", async () => {
    const home = tempHome();
    const h = harness({ after: "membership-new", before: undefined });

    const code = await runLinearTeamMembership({
      argv: argv({ rest: ["join", "--team", "ENG", "--apply", "--home", home, ...UNASKED_FLAGS] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    const rows = await heldAutonomyRecords({ port: h.deps.autonomy });
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ kind: "linear-team-join", said: NOTE.said, subject: VIEWER.url, why: NOTE.why });
    expect(row.actionId).toMatch(/^linear-team-eng-join-[0-9a-f]{12}$/u);
    expect((row as { witness: string }).witness).toBe(
      "slopweaver linear team-membership join -> joined ENG, confirmed by reading the viewer's memberships back; " +
        "rollback: slopweaver linear team-membership leave --team ENG --apply",
    );
  });

  it("calls a write the read-back cannot see unconfirmed, and journals it under that kind", async () => {
    const home = tempHome();
    const h = harness({ after: undefined, before: undefined });

    const code = await runLinearTeamMembership({
      argv: argv({ rest: ["join", "--team", "ENG", "--apply", "--home", home, ...UNASKED_FLAGS] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect((await heldAutonomyRecords({ port: h.deps.autonomy }))[0]).toMatchObject({
      kind: "linear-team-join-unconfirmed",
    });
  });

  it("calls a transport error that the read-back shows landed a landed join", async () => {
    const h = harness({ after: "membership-new", before: undefined, writeFails: true });

    const code = await runLinearTeamMembership({
      argv: argv({ rest: ["join", "--team", "ENG", "--apply", "--home", tempHome()] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.out).toContain("joined ENG despite a transport error, confirmed by the read-back");
  });

  it("calls a transport error that changed nothing failed, and journals nothing", async () => {
    const home = tempHome();
    const h = harness({ after: undefined, before: undefined, writeFails: true });

    const code = await runLinearTeamMembership({
      argv: argv({ rest: ["join", "--team", "ENG", "--apply", "--home", home, ...UNASKED_FLAGS] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(await heldAutonomyRecords({ port: h.deps.autonomy })).toEqual([]);
  });

  it("refuses a said the ledger would refuse before anything is read or sent", async () => {
    const h = harness({ after: "membership-new", before: undefined });
    const flags = ["--unasked", "--why", NOTE.why, "--said", "x".repeat(500), "--by-session", NOTE.bySession];

    const code = await runLinearTeamMembership({
      argv: argv({ rest: ["join", "--team", "ENG", "--apply", "--home", tempHome(), ...flags] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.joins.length).toBe(0);
    expect(h.err[0]).toContain("--unasked refused before writing");
  });

  it("reports a missing token without reading", async () => {
    const h = harness({ after: undefined, before: undefined });
    const deps: TeamMembershipDeps = { ...h.deps, resolveToken: () => undefined };

    const code = await runLinearTeamMembership({
      argv: argv({ rest: ["join", "--team", "ENG", "--home", tempHome()] }),
      deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err[0]).toContain("no Linear token for this home");
  });

  it("stops on a failed read and sends nothing", async () => {
    const h = harness({ after: undefined, before: undefined });
    const missing = LinearLiveErrors.notFound({ identity: "ENG", kind: "team with that key" });
    const deps: TeamMembershipDeps = { ...h.deps, readState: async () => err(missing) };

    const code = await runLinearTeamMembership({
      argv: argv({ rest: ["join", "--team", "ENG", "--apply", "--home", tempHome()] }),
      deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.joins.length).toBe(0);
    expect(h.err).toEqual([missing.message]);
  });
});
