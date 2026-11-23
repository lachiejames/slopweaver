/**
 * The pure half of turn checkpointing — reading a round out of an archive filename, ordering the rounds a
 * turn spent, deciding whether this session is inheriting, and the two surfaces that say so.
 */
import { describe, expect, it } from "vitest";

import type { ReviewVerdict } from "../../../../admit/reviewVerdict.js";
import {
  type CheckpointSet,
  checkpointResumeLines,
  checkpointRounds,
  type DraftCheckpoint,
  draftRowsWithin,
  hasCheckpoint,
  parseDraftRow,
  parseSupersededVerdictName,
  resumingFromCheckpoint,
  resumingFromCheckpointDetail,
} from "../../../../live/turn/checkpoint.js";
import { supersededVerdictName } from "../../../../live/turn/reviewStore.js";

/** One draft row, with the fields a test cares about overridable. */
const draft = (over: Partial<DraftCheckpoint> = {}): DraftCheckpoint => ({
  answerDigest: "sha256:aaaa",
  dispatchId: '["C1","1.1","0.9"]',
  draftFile: "draft-sha256-aaaa.json",
  recordedAtIso: "2026-09-10T13:40:00.000Z",
  leaseExpiresAt: "2026-09-10T15:00:00.000Z",
  ...over,
});

/** One verdict, with its claims and outcome overridable. */
const verdict = (over: Partial<ReviewVerdict> = {}): ReviewVerdict => ({
  answerDigest: "sha256:aaaa",
  authorSession: "author",
  claims: [],
  outcome: "clean",
  reviewerSession: "reviewer",
  schemaVersion: 1,
  ...over,
});

describe("parseSupersededVerdictName", () => {
  it("round-trips exactly what supersededVerdictName wrote", () => {
    const name = supersededVerdictName({ reviewer: "workspace:231", spawnedAt: "2026-09-10T13:34:39.172Z" });

    const parsed = parseSupersededVerdictName({ name })!;

    expect(name).toBe("verdict-superseded-workspace-231-2026-09-10T13-34-39-172Z.json");
    expect(parsed.reviewer).toBe("workspace-231");
    expect(parsed.spawnedAt).toBe("2026-09-10T13:34:39.172Z");
    expect(parsed.standing).toBe(false);
  });

  it("reads a reviewer token that itself carries dashes and digits", () => {
    const parsed = parseSupersededVerdictName({
      name: "verdict-superseded-05A2D538-9A59-4688-991C-52748FA81D6F-2026-09-10T13-50-07-477Z.json",
    })!;

    expect(parsed.reviewer).toBe("05A2D538-9A59-4688-991C-52748FA81D6F");
    expect(parsed.spawnedAt).toBe("2026-09-10T13:50:07.477Z");
  });

  it("answers undefined for a name carrying no restorable instant, rather than guessing one", () => {
    expect(parseSupersededVerdictName({ name: "verdict-superseded-workspace-231-unknown-time.json" })).toBe(undefined);
  });

  it("answers undefined for every file that is not one of these", () => {
    expect(parseSupersededVerdictName({ name: "verdict.json" })).toBe(undefined);
    expect(parseSupersededVerdictName({ name: "answer-reviewed-sha256-aaaa.json" })).toBe(undefined);
    expect(parseSupersededVerdictName({ name: "verdict-superseded-2026-09-10T13-34-39-172Z.json" })).toBe(undefined);
  });
});

describe("checkpointRounds", () => {
  it("orders archived rounds by their own spawn instant, oldest first, whatever order the listing gave", () => {
    const rounds = checkpointRounds({
      entries: [
        "packet.md",
        "verdict-superseded-b-2026-09-10T13-50-07-477Z.json",
        "answer-reviewed-sha256-aaaa.json",
        "verdict-superseded-a-2026-09-10T13-34-39-172Z.json",
      ],
      standing: undefined,
    });

    expect(rounds.map((round) => round.spawnedAt)).toEqual(["2026-09-10T13:34:39.172Z", "2026-09-10T13:50:07.477Z"]);
    expect(rounds.map((round) => round.standing)).toEqual([false, false]);
  });

  it("places the standing round by the reviewer record's own spawn instant", () => {
    const rounds = checkpointRounds({
      entries: ["verdict.json", "verdict-superseded-a-2026-09-10T13-34-39-172Z.json"],
      standing: { reviewer: "workspace:9", spawnedAt: "2026-09-10T14:56:41.260Z" },
    });

    expect(rounds).toHaveLength(2);
    expect(rounds[1]!.file).toBe("verdict.json");
    expect(rounds[1]!.reviewer).toBe("workspace:9");
    expect(rounds[1]!.standing).toBe(true);
  });

  it("leaves the standing verdict out when no record can place it in the ordering", () => {
    const rounds = checkpointRounds({ entries: ["verdict.json"], standing: undefined });

    expect(rounds).toEqual([]);
  });

  it("is empty for a review directory that never produced a verdict", () => {
    expect(checkpointRounds({ entries: ["packet.md", "record.json"], standing: undefined })).toEqual([]);
  });
});

describe("resumingFromCheckpoint", () => {
  it("is true when a draft was written under a different dispatch generation", () => {
    const set: CheckpointSet = { drafts: [draft({ leaseExpiresAt: "2026-09-10T15:00:00.000Z" })], rounds: [] };

    expect(resumingFromCheckpoint({ currentLease: "2026-09-10T17:00:00.000Z", set })).toBe(true);
  });

  it("is false for this session's own draft", () => {
    const set: CheckpointSet = { drafts: [draft({ leaseExpiresAt: "2026-09-10T15:00:00.000Z" })], rounds: [] };

    expect(resumingFromCheckpoint({ currentLease: "2026-09-10T15:00:00.000Z", set })).toBe(false);
  });

  it("is TRUE over rounds alone: no round of this generation can exist before its first draft", () => {
    const set: CheckpointSet = {
      drafts: [],
      rounds: [
        {
          round: { file: "verdict.json", reviewer: "w", spawnedAt: "2026-09-10T13:34:39.172Z", standing: true },
          verdict: verdict(),
        },
      ],
    };

    expect(resumingFromCheckpoint({ currentLease: "2026-09-10T17:00:00.000Z", set })).toBe(true);
  });

  it("stops saying resuming once every draft on disk is this generation's own", () => {
    const set: CheckpointSet = {
      drafts: [draft({ leaseExpiresAt: "2026-09-10T17:00:00.000Z", recordedAtIso: "2026-09-10T15:40:00.000Z" })],
      rounds: [],
    };

    expect(resumingFromCheckpoint({ currentLease: "2026-09-10T17:00:00.000Z", set })).toBe(false);
  });
});

describe("resumingFromCheckpointDetail", () => {
  it("names both halves when both are there, and never a claim's text", () => {
    const set: CheckpointSet = {
      drafts: [draft()],
      rounds: [
        {
          round: { file: "verdict.json", reviewer: "w", spawnedAt: "2026-09-10T13:34:39.172Z", standing: true },
          verdict: verdict({ claims: [{ impact: "high", support: "unsupported", text: "the cross-service claim" }] }),
        },
      ],
    };

    expect(resumingFromCheckpointDetail({ currentLease: "2026-09-10T17:00:00.000Z", set })).toBe(
      "resuming from checkpoint — a draft answer and 1 review round recovered from the last session",
    );
  });

  it("counts only what was INHERITED, never a round this session ran itself", () => {
    const round = ({ spawnedAt }: { spawnedAt: string }) => ({
      round: { file: `verdict-${spawnedAt}.json`, reviewer: "w", spawnedAt, standing: false },
      verdict: verdict(),
    });
    const set: CheckpointSet = {
      drafts: [
        draft({ leaseExpiresAt: "2026-09-10T15:00:00.000Z", recordedAtIso: "2026-09-10T13:40:00.000Z" }),
        draft({
          answerDigest: "sha256:mine",
          leaseExpiresAt: "2026-09-10T17:00:00.000Z",
          recordedAtIso: "2026-09-10T15:40:00.000Z",
        }),
      ],
      rounds: [
        round({ spawnedAt: "2026-09-10T13:34:39.172Z" }),
        round({ spawnedAt: "2026-09-10T13:50:07.477Z" }),
        round({ spawnedAt: "2026-09-10T15:56:41.260Z" }),
      ],
    };

    expect(resumingFromCheckpointDetail({ currentLease: "2026-09-10T17:00:00.000Z", set })).toBe(
      "resuming from checkpoint — a draft answer and 2 review rounds recovered from the last session",
    );
  });

  it("pluralises the rounds it counts", () => {
    const rounds = ["a", "b"].map((reviewer) => ({
      round: { file: `verdict-${reviewer}.json`, reviewer, spawnedAt: "2026-09-10T13:34:39.172Z", standing: false },
      verdict: verdict(),
    }));

    expect(
      resumingFromCheckpointDetail({ currentLease: "2026-09-10T17:00:00.000Z", set: { drafts: [], rounds } }),
    ).toBe("resuming from checkpoint — 2 review rounds recovered from the last session");
  });

  it("is undefined when there is nothing to resume from", () => {
    expect(
      resumingFromCheckpointDetail({ currentLease: "2026-09-10T17:00:00.000Z", set: { drafts: [], rounds: [] } }),
    ).toBe(undefined);
    expect(hasCheckpoint({ set: { drafts: [], rounds: [] } })).toBe(false);
  });
});

describe("checkpointResumeLines", () => {
  it("names the newest draft's absolute path, its instant and its digest", () => {
    const lines = checkpointResumeLines({
      checkpointDir: "/home/live/slack/checkpoints/C1-1.1",
      reviewDir: "/home/live/slack/reviews/C1-1.1",
      set: {
        drafts: [
          draft({
            answerDigest: "sha256:old",
            draftFile: "draft-sha256-old.json",
            recordedAtIso: "2026-09-10T13:40:00.000Z",
          }),
          draft({
            answerDigest: "sha256:new",
            draftFile: "draft-sha256-new.json",
            recordedAtIso: "2026-09-10T13:55:00.000Z",
          }),
        ],
        rounds: [],
      },
    });

    expect(lines).toContain(
      "  draft: /home/live/slack/checkpoints/C1-1.1/draft-sha256-new.json — validated " +
        "2026-09-10T13:55:00.000Z, digest sha256:new",
    );
    expect(lines).toContain("  rounds: none — no reviewer ever returned a verdict on this ask");
  });

  it("splits each round's claims into what it settled and what a re-run must not carry forward", () => {
    const lines = checkpointResumeLines({
      checkpointDir: "/home/live/slack/checkpoints/C1-1.1",
      reviewDir: "/home/live/slack/reviews/C1-1.1",
      set: {
        drafts: [],
        rounds: [
          {
            round: {
              file: "verdict-superseded-a-2026-09-10T13-34-39-172Z.json",
              reviewer: "a",
              spawnedAt: "2026-09-10T13:34:39.172Z",
              standing: false,
            },
            verdict: verdict({
              answerDigest: "sha256:c73ef2b7",
              claims: [
                { impact: "low", support: "supported", text: "the lead answers both halves" },
                { impact: "high", support: "unsupported", text: "the cross-service spread" },
              ],
              outcome: "broken",
            }),
          },
        ],
      },
    });

    expect(lines).toContain("  rounds: 1 already returned a verdict");
    expect(lines).toContain(
      "    round 1 (2026-09-10T13:34:39.172Z): " +
        "/home/live/slack/reviews/C1-1.1/verdict-superseded-a-2026-09-10T13-34-39-172Z.json",
    );
    expect(lines).toContain("      outcome broken, bound to answer digest sha256:c73ef2b7");
    expect(lines).toContain("      settled: 1 claim(s) this reviewer verified — do not re-verify them");
    expect(lines).toContain("        [high impact, unsupported] the cross-service spread");
    expect(lines).toContain("  draft: none — no answer of that session's ever passed validate");
  });

  it("calls a round whose verdict will not parse unspent, rather than settled or absent", () => {
    const lines = checkpointResumeLines({
      checkpointDir: "/c",
      reviewDir: "/r",
      set: {
        drafts: [],
        rounds: [
          {
            round: { file: "verdict.json", reviewer: "a", spawnedAt: "2026-09-10T13:34:39.172Z", standing: true },
            verdict: undefined,
          },
        ],
      },
    });

    expect(lines).toContain(
      "      unreadable — the verdict file is absent or does not parse; treat this round as unspent",
    );
  });

  it("says nothing at all when there is no checkpoint, so a clean dispatch reads an identical brief", () => {
    expect(checkpointResumeLines({ checkpointDir: "/c", reviewDir: "/r", set: { drafts: [], rounds: [] } })).toEqual(
      [],
    );
  });
});

describe("draftRowsWithin", () => {
  /** One log row, written exactly as `writeDraftCheckpoint` writes it. */
  const row = ({ digest, when }: { digest: string; when: string }): string =>
    JSON.stringify({
      answerDigest: digest,
      dispatchId: '["C1","1.1","0.9"]',
      draftFile: `draft-${digest.replace(":", "-")}.json`,
      leaseExpiresAt: "2026-09-10T15:00:00.000Z",
      recordedAtIso: when,
      schemaVersion: 1,
    });

  const LOG = [
    row({ digest: "sha256:aaaa", when: "2026-09-10T13:40:00.000Z" }),
    row({ digest: "sha256:bbbb", when: "2026-09-10T13:55:00.000Z" }),
    row({ digest: "sha256:cccc", when: "2026-09-10T14:56:00.000Z" }),
  ].join("\n");

  it("keeps the rows inside the window and names exactly their own draft files", () => {
    const within = draftRowsWithin({ logText: LOG, notAfterIso: "2026-09-10T14:06:00.000Z" });

    expect(within.keptLines).toHaveLength(2);
    expect(within.keptFiles).toEqual(["draft-sha256-aaaa.json", "draft-sha256-bbbb.json"]);
  });

  it("keeps everything when no instant closes the window", () => {
    const within = draftRowsWithin({ logText: LOG, notAfterIso: undefined });

    expect(within.keptFiles).toEqual(["draft-sha256-aaaa.json", "draft-sha256-bbbb.json", "draft-sha256-cccc.json"]);
  });

  it("keeps a row it cannot parse or cannot date, and names no file for it", () => {
    const within = draftRowsWithin({
      logText: [LOG, "not json at all", JSON.stringify({ draftFile: "draft-x.json" })].join("\n"),
      notAfterIso: "2026-09-10T14:06:00.000Z",
    });

    expect(within.keptLines).toHaveLength(4);
    expect(within.keptFiles).toEqual(["draft-sha256-aaaa.json", "draft-sha256-bbbb.json"]);
  });
});

describe("parseDraftRow", () => {
  it("reads back exactly the five fields the log row carries", () => {
    const parsed = parseDraftRow({
      line: JSON.stringify({
        answerDigest: "sha256:aaaa",
        dispatchId: '["C1","1.1","0.9"]',
        draftFile: "draft-sha256-aaaa.json",
        leaseExpiresAt: "2026-09-10T15:00:00.000Z",
        recordedAtIso: "2026-09-10T13:40:00.000Z",
        schemaVersion: 1,
      }),
    })!;

    expect(parsed.answerDigest).toBe("sha256:aaaa");
    expect(parsed.draftFile).toBe("draft-sha256-aaaa.json");
    expect(parsed.recordedAtIso).toBe("2026-09-10T13:40:00.000Z");
    expect(parsed.leaseExpiresAt).toBe("2026-09-10T15:00:00.000Z");
  });

  it("refuses a row missing any one of them, rather than half-populating a draft", () => {
    expect(parseDraftRow({ line: JSON.stringify({ answerDigest: "sha256:aaaa" }) })).toBe(undefined);
    expect(parseDraftRow({ line: "not json" })).toBe(undefined);
    expect(parseDraftRow({ line: "[1,2,3]" })).toBe(undefined);
  });
});
