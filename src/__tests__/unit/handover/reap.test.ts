import { describe, expect, it } from "vitest";

import type { RunDisposition } from "../../../handover/boardTypes.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { planReap, type ReapCandidate, reapCandidateOf, reapSummary } from "../../../handover/reap.js";
import type { RunWriter, WriterLiveness } from "../../../handover/runOwner.js";

const WRITER: RunWriter = {
  atIso: "2026-09-01T00:00:00Z",
  host: "claude-code",
  pid: 4242,
  sessionId: "session-dead",
  worktree: "/tmp/wt",
};

const ACTIVE: RunDisposition = { kind: "active" };
const DEAD: WriterLiveness = { kind: "dead" };

const candidate = (over: Partial<ReapCandidate> = {}): ReapCandidate => ({
  cycleEvents: 3,
  disposition: ACTIVE,
  lastEventIso: "2026-09-02T10:00:00Z",
  liveness: DEAD,
  slug: "a-row",
  writer: WRITER,
  ...over,
});

describe("planReap", () => {
  it("reaps an open cycle whose writer the registry proved dead", () => {
    const plan = planReap({ candidates: [candidate()] });

    expect(plan.reapable.length).toBe(1);
    expect(plan.reapable[0]!.slug).toBe("a-row");
    expect(plan.reapable[0]!.deadSessionId).toBe("session-dead");
    expect(plan.reapable[0]!.lastEventIso).toBe("2026-09-02T10:00:00Z");
    expect(plan.skipped.length).toBe(0);
  });

  it("reaps a cycle waiting on the owner, because a stranded question is still stranded", () => {
    const waiting: RunDisposition = {
      action: undefined,
      actionUnreadable: false,
      askedIso: "2026-09-01T09:00:00.000Z",
      kind: "waiting-on-owner",
      question: "which base branch?",
      shape: undefined,
      shapeIso: undefined,
    };

    const plan = planReap({ candidates: [candidate({ disposition: waiting })] });

    expect(plan.reapable.length).toBe(1);
    expect(plan.reapable[0]!.deadSessionId).toBe("session-dead");
  });

  it("never reaps a cycle whose writer is still live", () => {
    const live: WriterLiveness = { kind: "live" };

    const plan = planReap({ candidates: [candidate({ liveness: live })] });

    expect(plan.reapable.length).toBe(0);
    expect(plan.skipped.length).toBe(1);
    expect(plan.skipped[0]!.why).toBe("session-dead is still in the live registry");
  });

  it("never reaps on an unknown verdict, and says which measurement fell short", () => {
    const unknown: WriterLiveness = { kind: "unknown", why: "2 registry file(s) would not decode" };

    const plan = planReap({ candidates: [candidate({ liveness: unknown })] });

    expect(plan.reapable.length).toBe(0);
    expect(plan.skipped[0]!.why).toBe("liveness could not be established — 2 registry file(s) would not decode");
  });

  it("skips a cycle that names no writer rather than guessing at one", () => {
    const plan = planReap({ candidates: [candidate({ writer: undefined })] });

    expect(plan.reapable.length).toBe(0);
    expect(plan.skipped[0]!.why).toBe("the cycle names no writer, so there is no session to judge");
  });

  it("skips a cycle that already has an ending, naming which one", () => {
    const finished: RunDisposition = { atIso: "2026-09-04T07:30:00.000Z", kind: "finished", residue: [] };
    const abandoned: RunDisposition = { kind: "abandoned", why: "superseded" };
    const orphaned: RunDisposition = {
      deadSessionId: "session-older",
      kind: "orphaned",
      lastEventIso: "2026-08-20T00:00:00Z",
    };

    const plan = planReap({
      candidates: [
        candidate({ disposition: finished, slug: "f" }),
        candidate({ disposition: abandoned, slug: "a" }),
        candidate({ disposition: orphaned, slug: "o" }),
      ],
    });

    expect(plan.reapable.length).toBe(0);
    expect(plan.skipped.map((skip) => skip.why)).toEqual([
      "the cycle is already finished",
      "the cycle is already abandoned",
      "the cycle is already orphaned",
    ]);
  });

  it("keeps the given order across both outcomes", () => {
    const live: WriterLiveness = { kind: "live" };

    const plan = planReap({
      candidates: [
        candidate({ slug: "first-dead" }),
        candidate({ liveness: live, slug: "middle-live" }),
        candidate({ slug: "last-dead" }),
      ],
    });

    expect(plan.reapable.map((row) => row.slug)).toEqual(["first-dead", "last-dead"]);
    expect(plan.skipped.map((row) => row.slug)).toEqual(["middle-live"]);
  });

  it("decides nothing when given nothing", () => {
    const plan = planReap({ candidates: [] });

    expect(plan.reapable.length).toBe(0);
    expect(plan.skipped.length).toBe(0);
  });
});

describe("reapSummary", () => {
  it("says the writers were all judgeable when none was skipped for liveness", () => {
    const plan = planReap({ candidates: [candidate()] });

    expect(reapSummary({ plan })).toBe("1 cycle(s) reaped; every open cycle's writer was judgeable");
  });

  it("never reaps a cycle whose last event carries no readable instant — the ending could not be written", () => {
    const plan = planReap({ candidates: [candidate({ lastEventIso: "not-an-instant" })] });

    expect(plan.reapable.length).toBe(0);
    expect(plan.skipped[0]!.why).toBe(
      'the cycle\'s last event carries no readable instant ("not-an-instant"), so no ending could be written',
    );
  });

  it("names the unreachable count, so a quiet pass is not read as a clean board", () => {
    const unknown: WriterLiveness = { kind: "unknown", why: "the registry could not be read" };

    const plan = planReap({ candidates: [candidate({ liveness: unknown })] });

    expect(reapSummary({ plan })).toBe(
      "0 cycle(s) reaped; 1 left because their writer's liveness could not be established",
    );
  });

  it("says WOULD BE reaped for a dry run, so a log line never claims an act that did not happen", () => {
    const plan = planReap({ candidates: [candidate()] });

    expect(reapSummary({ applied: false, plan })).toBe(
      "1 cycle(s) would be reaped; every open cycle's writer was judgeable",
    );
  });

  it("does not count a live or writerless skip as an unreachable measurement", () => {
    const live: WriterLiveness = { kind: "live" };

    const plan = planReap({
      candidates: [candidate({ liveness: live }), candidate({ writer: undefined })],
    });

    expect(reapSummary({ plan })).toBe("0 cycle(s) reaped; every open cycle's writer was judgeable");
  });
});

const STARTED: RunEvent = { atIso: "2026-09-04T21:52:38.002Z", branch: "a-row", docHash: "ed23d7fc", kind: "started" };
const LAUNCHED: RunEvent = {
  atIso: "2026-09-04T21:52:38.500Z",
  host: "claude-code",
  kind: "launched",
  pid: 92015,
  sessionId: "session-dead",
  worktree: "/tmp/wt",
};

/** The three liveness edges, as plain fakes: the registry answers `absent`, every pid is gone, no Codex file is held. */
const GONE = {
  codexThread: () => ({ kind: "not-observed", why: "no Codex process holds this thread" }) as const,
  processAlive: (): boolean => false,
  selfSessionIds: [] as readonly string[],
  sessionLive: () => ({ known: true, value: false }) as const,
};

describe("reapCandidateOf", () => {
  it("judges a Claude Code writer the registry no longer lists as dead, stamped with the cycle's last event", () => {
    const judged = reapCandidateOf({ events: [STARTED, LAUNCHED], slug: "a-row", unreadableLines: [], ...GONE });

    expect(judged!.slug).toBe("a-row");
    expect(judged!.disposition).toEqual({ kind: "active" });
    expect(judged!.writer!.sessionId).toBe("session-dead");
    expect(judged!.liveness).toEqual({ kind: "dead" });
    expect(judged!.lastEventIso).toBe("2026-09-04T21:52:38.500Z");
    expect(judged!.cycleEvents).toBe(2);
    expect(planReap({ candidates: [judged!] }).reapable.length).toBe(1);
  });

  it("holds EVERY id the caller could be, so an ambiguous environment still protects its own run", () => {
    const judged = reapCandidateOf({
      events: [STARTED, LAUNCHED],
      ...GONE,
      selfSessionIds: ["a-codex-thread", "session-dead"],
      slug: "a-row",
      unreadableLines: [],
    });

    expect(judged!.liveness).toEqual({ kind: "live" });
    expect(planReap({ candidates: [judged!] }).reapable.length).toBe(0);
  });

  it("judges the CALLING session live even when the registry reads it absent, so a caller never reaps itself", () => {
    const judged = reapCandidateOf({
      events: [STARTED, LAUNCHED],
      ...GONE,
      selfSessionIds: ["session-dead"],
      slug: "a-row",
      unreadableLines: [],
    });

    expect(judged!.liveness).toEqual({ kind: "live" });
    expect(planReap({ candidates: [judged!] }).reapable.length).toBe(0);
  });

  it("is unknown, never dead, when the registry could not be read — so the reap skips it", () => {
    const judged = reapCandidateOf({
      codexThread: GONE.codexThread,
      events: [STARTED, LAUNCHED],
      processAlive: () => false,
      selfSessionIds: [],
      sessionLive: () => ({ known: false, why: "a registry file would not decode" }) as const,
      slug: "a-row",
      unreadableLines: [],
    });

    expect(judged!.liveness).toEqual({ kind: "unknown", why: "a registry file would not decode" });
    expect(planReap({ candidates: [judged!] }).reapable.length).toBe(0);
  });

  it("never reaps a Codex writer no open file shows, since absence proves no death", () => {
    const codex: RunEvent = { ...LAUNCHED, host: "codex", sessionId: "a0000065-0000-4000-8000-000000000071" };

    const judged = reapCandidateOf({ events: [STARTED, codex], slug: "a-row", unreadableLines: [], ...GONE });

    expect(judged!.liveness).toEqual({ kind: "unknown", why: "no Codex process holds this thread" });
    expect(planReap({ candidates: [judged!] }).reapable.length).toBe(0);
  });

  it("judges a Codex writer live when a Codex process holds its thread open", () => {
    const codex: RunEvent = { ...LAUNCHED, host: "codex", sessionId: "a0000065-0000-4000-8000-000000000071" };
    const held = { kind: "live", path: "/Users/acme/.codex/thread-writer-locks/x.lock", pid: 7 } as const;

    const judged = reapCandidateOf({
      events: [STARTED, codex],
      ...GONE,
      codexThread: () => held,
      slug: "a-row",
      unreadableLines: [],
    });

    expect(judged!.liveness).toEqual({ kind: "live" });
  });

  it("judges a hostless legacy writer by its pid alone", () => {
    const hostless: RunEvent = {
      atIso: LAUNCHED.atIso,
      kind: "launched",
      pid: 92015,
      sessionId: "session-old",
      worktree: undefined,
    };

    const judged = reapCandidateOf({ events: [STARTED, hostless], slug: "a-row", unreadableLines: [], ...GONE });

    expect(judged!.liveness).toEqual({ kind: "dead" });
  });

  it("names no writer for a cycle nobody launched, which the reap then skips by that reason", () => {
    const judged = reapCandidateOf({ events: [STARTED], slug: "a-row", unreadableLines: [], ...GONE });

    expect(judged!.writer).toBe(undefined);
    expect(judged!.liveness).toEqual({ kind: "unknown", why: "the cycle names no writer" });
    expect(planReap({ candidates: [judged!] }).skipped[0]!.why).toBe(
      "the cycle names no writer, so there is no session to judge",
    );
  });

  it("is undefined for an empty journal, which has no cycle to close", () => {
    expect(reapCandidateOf({ events: [], slug: "a-row", unreadableLines: [], ...GONE })).toBe(undefined);
  });

  it("reads an undecodable line as unreadable, which the reap never closes", () => {
    const judged = reapCandidateOf({ events: [STARTED, LAUNCHED], slug: "a-row", unreadableLines: [3], ...GONE });

    expect(judged!.disposition.kind).toBe("unreadable");
    expect(planReap({ candidates: [judged!] }).reapable.length).toBe(0);
  });
});
