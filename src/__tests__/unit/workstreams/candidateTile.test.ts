import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { STORY_OWED } from "../../../workstreams/candidates.js";
import { entryFromCandidate } from "../../../workstreams/candidateTile.js";
import { DONE_MILESTONE_ID } from "../../../workstreams/store/doneMilestoneId.js";
import { file } from "./candidatesHarness.js";
import { countingMintId, mintedId, seededStore } from "./storeRegisterFixture.js";

/** The fixture's one Slack piece of evidence, on c-002. */
const SLACK_EVIDENCE = "https://example.slack.com/archives/C0SYNINCIDENTS/p1782000000000100";

describe("entryFromCandidate", () => {
  it("makes a standing discovery workstream whose entries are the evidence in date order, the story owed", () => {
    const entry = unwrap(
      entryFromCandidate({
        candidate: file.candidates[1]!,
        definition: null,
        ending: null,
        mintId: countingMintId(),
        reactedOn: "2026-10-02",
        reactionAnchor: null,
        taken: new Set(["postmortems-that-happen"]),
      }),
    );
    expect(entry.id).toBe("postmortems-that-happen-2");
    expect(entry.kind).toBe("standing");
    expect(entry.status).toBe("discovery");
    expect(entry.workspace).toBe("team");
    const detail = entry.detail;
    expect(detail["initiative"]).toBe(null);
    expect(detail["agreedBy"]).toBe(STORY_OWED);
    expect(detail["team"]).toBe(STORY_OWED);
    expect(detail["numbers"]).toBe(STORY_OWED);
    expect(entry.entries).toEqual([
      {
        date: "2026-07-02",
        done: false,
        href: SLACK_EVIDENCE,
        id: mintedId({ n: 1 }),
        kind: "raised",
        milestoneId: null,
        position: 0,
        text: "postmortems keep slipping",
      },
      {
        date: "2026-07-09",
        done: false,
        href: null,
        id: mintedId({ n: 2 }),
        kind: "discussion",
        milestoneId: null,
        position: 1,
        text: "we never write them [owner-turn:owner-turn-12.txt]",
      },
    ]);
    // The evidence is cited on its entries; a workstream link names only what the store can identify exactly.
    expect(entry.links).toEqual([]);
    expect(detail["tags"]).toEqual(["mined", "mined:c-002", "reliability-incidents"]);
    expect(detail["people"]).toEqual([
      { part: "leads on-call, so owns whether a postmortem gets written", slack: "U0SYNTESTAAA1" },
    ]);
    expect(entry.outcome).toBe("Every incident gets a written postmortem");
    expect(entry.milestones).toEqual([
      {
        after: [],
        anchor: "candidate:c-002",
        id: DONE_MILESTONE_ID,
        name: "Every incident gets a written postmortem",
        position: 0,
      },
    ]);
    expect(detail["priority"]).toBe(null);
    expect(detail["waitingOn"]).toBe(null);
  });

  it("is accepted by the store beside the register, filed under the candidate's workspace", async () => {
    const entry = unwrap(
      entryFromCandidate({
        candidate: file.candidates[2]!,
        definition: null,
        ending: null,
        mintId: countingMintId(),
        reactedOn: "2026-10-02",
        reactionAnchor: null,
        taken: new Set(),
      }),
    );
    const store = await seededStore();
    const written = unwrap(
      await store.applyBatch({ deletes: [], home: "", writes: [{ aggregate: entry, expectedRevision: null }] }),
    );
    expect(written.written.map((one) => [one.id, one.workspace, one.revision])).toEqual([
      ["cloudflare-waf-rollout", "self", 1],
    ]);
  });
});
