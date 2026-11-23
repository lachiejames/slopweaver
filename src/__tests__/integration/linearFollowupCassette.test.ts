/**
 * INTEGRATION test: the exact regression `cassette-followup-cursor-redaction-gap` diagnosed — a nested
 * connection that genuinely overflows its inline page, forcing the real `ParentConnection` follow-up query
 * (`collectNestedConnection` in `corpus/linear/nested.ts`) to fire and replay.
 *
 * **The connection changed with the SDK migration, and the reason is the whole point of this header.** This
 * cassette used to drive `comments`, because comments rode the issues document as a nested connection.
 * `@linear/sdk`'s `IssuesDocument` carries no connections at all, so comments now come from the ROOT
 * `comments` walk filtered to a page of issues (`queries.ts`, "the four joins that carry what its nested
 * connections used to") and there is no inline comments page left anywhere to overflow. The four connections
 * that ARE still inline are `ISSUE_ACTIVITY_CONNECTIONS`, and `stateHistory` is the only one of them a test
 * can drive past its page from the API: MEASURED live, `history` does not record a title change
 * at all (`yarn tsx .cache/linear-probe/probe-history-events.ts` reported 0 after five updates), while one
 * state move adds exactly one `stateHistory` entry and the create adds the first — five moves measured six
 * entries. Subscribers and attachments need people and uploads, not mutations.
 *
 * Recording this CREATES ONE REAL ISSUE and moves it between two workflow states `HISTORY_PAGE_SIZE` times,
 * leaving one more state-history entry than the inline page holds, then deletes it. A throwaway workspace
 * would prove nothing — see `linearWrite.test.ts` for the same reasoning applied to the write seam.
 *
 * Before the redaction fix, the follow-up query could never replay at all: record time computes its match key
 * from a real UUID `id` and a real cursor; replay time computes it from the parent response's redacted `id_N`
 * synthetic id and blanket `"[REDACTED]"` cursor, and the two are never equal. See
 * `docs/cassette-followup-redaction.md` for the mechanism and the fix.
 *
 * Run:
 *   yarn test:integration                                                    # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_HOME=… \
 *     SLOPWEAVER_RECORD_LINEAR_TOKEN=lin_api_… \
 *     SLOPWEAVER_RECORD_LINEAR_TEAM=<team uuid> \
 *     SLOPWEAVER_RECORD_LINEAR_STATES=<state uuid>,<other state uuid> yarn test:integration   # WRITES FOR REAL
 */
import { describe, expect, it } from "vitest";

import { collectNestedConnection, connectionPage } from "../../corpus/linear/nested.js";
import { HISTORY_PAGE_SIZE, ISSUE_ACTIVITY_CONNECTIONS, ISSUE_ACTIVITY_QUERY } from "../../corpus/linear/queries.js";
import { sharedLinearTransport } from "../../corpus/linear/transport.js";
import { makeLinearWriteApi } from "../../corpus/linear/write.js";
import { isRecord } from "../../lib/parsers.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../linearWritePrivacyFixture.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function linearToken(): string {
  if (!RECORD) {
    return "lin_api_replay-not-real";
  }
  const token = process.env["SLOPWEAVER_RECORD_LINEAR_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TOKEN to record the follow-up cassette");
  }
  return token;
}

/** A placeholder on replay, real when recording — the cassette matcher collapses identifiers positionally
 * (and, for this query, sentinels the follow-up's own id/cursor), so both produce the same match key. */
function linearTeam(): string {
  if (!RECORD) {
    return "00000000-0000-4000-8000-000000000001";
  }
  const team = process.env["SLOPWEAVER_RECORD_LINEAR_TEAM"];
  if (team === undefined || team.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TEAM to the team UUID to create the test issue in");
  }
  return team;
}

/**
 * The two workflow states the issue is moved between, on the same placeholder-vs-real footing as the team.
 *
 * They must be two DISTINCT states of the recording team: Linear records a state-history entry for a move to
 * a different state, so writing the same id twice would produce one entry rather than two and the connection
 * would never overflow. `slopweaver linear states --team <KEY> --json` prints the ids to record with.
 *
 * @returns the two state ids, in the order the test alternates between them
 */
function linearStates(): readonly [string, string] {
  if (!RECORD) {
    return ["00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012"];
  }
  const raw = process.env["SLOPWEAVER_RECORD_LINEAR_STATES"];
  const ids = raw === undefined ? [] : raw.split(",").map((id) => id.trim());
  const first = ids[0];
  const second = ids[1];
  if (ids.length !== 2 || first === undefined || second === undefined || first === second || first.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_STATES to two DISTINCT state UUIDs of that team, comma-separated");
  }
  return [first, second];
}

/**
 * State moves to perform.
 *
 * One entry per move, plus the create's own, so `HISTORY_PAGE_SIZE` moves leaves `HISTORY_PAGE_SIZE + 1`
 * entries — the minimal count that forces exactly one follow-up page. Derived from the constant rather than
 * restated, so a page-size change moves this with it instead of quietly under-filling the connection.
 */
const STATE_MOVES = HISTORY_PAGE_SIZE;

/** The throwaway issue. Fixed literal id, so record and replay send the same outbound variables. */
const ISSUE_ID = "00000000-0000-4000-8000-000000000e10";

const STATE_HISTORY_CONN = ISSUE_ACTIVITY_CONNECTIONS.find((conn) => conn.key === "stateHistory")!;

describe("linear state-history follow-up (integration — real Linear via Polly cassette)", () => {
  it("pages a genuinely overflowing nested connection through the real ParentConnection follow-up", async () => {
    const writeApi = makeLinearWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      scheduler: (task) => task(),
      token: linearToken(),
    });
    const states = linearStates();

    const created = await writeApi.createIssue({
      id: ISSUE_ID,
      input: {
        description: "Filed only to prove a genuinely overflowing nested connection replays. Auto-deleted.",
        stateId: states[0],
        teamId: linearTeam(),
        title: "[slopweaver integration test] state-history follow-up probe (auto-deleted)",
      },
    });
    expect(created.isOk()).toBe(true);

    for (let n = 1; n <= STATE_MOVES; n++) {
      const moved = await writeApi.updateIssue({ id: ISSUE_ID, input: { stateId: states[n % 2]! } });
      expect(moved.isOk()).toBe(true);
    }

    // The exact production read seam every refresh uses (`fetchJoins.ts`'s `issueActivityFor`), asked for the
    // one issue this test made so the response stays small.
    const readTransport = sharedLinearTransport({ token: linearToken() });
    const page = await readTransport.request({
      query: ISSUE_ACTIVITY_QUERY,
      variables: { first: 1, ids: [ISSUE_ID] },
    });
    expect(isRecord(page)).toBe(true);
    const issues = isRecord(page) ? page["issues"] : undefined;
    const node = isRecord(issues) && Array.isArray(issues["nodes"]) ? issues["nodes"][0] : undefined;
    expect(node === undefined).toBe(false);

    const inline = connectionPage({ holder: node, key: "stateHistory" });
    // Proves this genuinely overflowed rather than happening to avoid it — the whole point of this cassette.
    expect(inline.hasNext).toBe(true);
    expect(inline.nodes.length).toBe(HISTORY_PAGE_SIZE);

    // THE call under test: this is exactly what fires the `ParentConnection` follow-up query in production.
    const allEntries = await collectNestedConnection({
      call: readTransport.request,
      conn: STATE_HISTORY_CONN,
      id: ISSUE_ID,
      inline,
      parent: "issue",
      warnings: [],
    });
    expect(allEntries.length).toBe(STATE_MOVES + 1);

    // Cleanup, asserted rather than fired and forgotten. The state history lives inside the issue, so
    // deleting the issue takes every entry with it — there is nothing else to tear down.
    const deletedIssue = await writeApi.deleteIssue({ id: ISSUE_ID });
    expect(deletedIssue.isOk()).toBe(true);
    expect(deletedIssue._unsafeUnwrap()).toBe(true);
  });
});
