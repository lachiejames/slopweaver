import { describe, expect, it } from "vitest";

import type { StoredInteractionSession } from "../../../../../browser/interactionSessionStore.js";
import type { BrowserReapVerdict } from "../../../../../browser/sessionReap.js";
import { type BrowserReapEffects, executeBrowserReap } from "../../../../../cli/commands/machine/reapBrowser.js";
import type { ProcessRow } from "../../../../../live/standing/processes.js";

const daemon = ({ name, pid }: { name: string; pid: number }): ProcessRow => ({
  argv: `/node /repo/node_modules/playwright-core/lib/entry/cliDaemon.js ${name} --browser=chrome --extension`,
  pid,
  ppid: 1,
});

/** One stored record whose client name is `slopweaver-<id>`. */
const stored = ({ id }: { id: string }): StoredInteractionSession => ({
  observation: null,
  session: {
    clientSession: `slopweaver-${id}`,
    id,
    openedAtIso: "2026-09-01T00:00:00.000Z",
    origins: [],
    owner: { cmuxWorkspace: null, pid: 7001, runSlug: null },
    ownerSessionId: `sess-${id}`,
    placement: "background",
    touchedAtIso: "2026-09-01T00:00:00.000Z",
    workspace: `/home/live/browser/sessions/${id}/client`,
  },
});

/** A verdict on `id`, closing through daemon 900 unless a test says otherwise. */
const verdict = ({
  id,
  action = "close",
  idleJudgedOn = null,
}: {
  id: string;
  action?: BrowserReapVerdict["action"];
  idleJudgedOn?: string | null;
}): BrowserReapVerdict => ({
  action,
  clientSession: `slopweaver-${id}`,
  daemonPids: [900],
  id,
  idleJudgedOn,
  owner: "dead",
  ownerWhy: "its opener pid 7001 is gone",
  url: null,
  why: "its opener pid 7001 is gone",
});

/** Effects over a fixed world, recording every act into `acts`. */
const effects = ({
  acts,
  processes,
  release = () => [],
  sessions = () => [],
  heldElsewhere = [],
}: {
  acts: string[];
  processes: readonly ProcessRow[];
  release?: BrowserReapEffects["release"];
  sessions?: BrowserReapEffects["sessions"];
  heldElsewhere?: readonly string[];
}): BrowserReapEffects => ({
  forget: ({ id }) => {
    acts.push(`forget ${id}`);
    return undefined;
  },
  hold: ({ id }) => {
    if (heldElsewhere.includes(id)) {
      return undefined;
    }
    acts.push(`hold ${id}`);
    return () => {
      acts.push(`unhold ${id}`);
    };
  },
  processes: () => processes,
  release: (input) => {
    acts.push(`release ${input.session.id}`);
    return release(input);
  },
  sessions,
  terminate: ({ pid }) => {
    acts.push(`SIGTERM ${String(pid)}`);
    return undefined;
  },
});

const TIMED_OUT = (): readonly string[] => ["tab-close timed out after 15000 ms"];

describe("executeBrowserReap", () => {
  it("closes then forgets a confirmed close, and leaves a keep untouched", () => {
    const acts: string[] = [];
    const result = executeBrowserReap({
      effects: effects({
        acts,
        processes: [daemon({ name: "slopweaver-a", pid: 900 })],
        sessions: () => [stored({ id: "a" }), stored({ id: "b" })],
      }),
      stored: [stored({ id: "a" }), stored({ id: "b" })],
      verdicts: [verdict({ id: "a" }), verdict({ action: "keep", id: "b" })],
    });
    expect(acts).toEqual(["hold a", "release a", "forget a", "unhold a"]);
    expect(result.closed).toEqual(["a"]);
  });

  it("ends the one daemon an unconfirmed close leaves, and defers every later close", () => {
    const acts: string[] = [];
    const result = executeBrowserReap({
      effects: effects({
        acts,
        processes: [daemon({ name: "slopweaver-a", pid: 900 })],
        release: TIMED_OUT,
        sessions: () => [stored({ id: "a" }), stored({ id: "b" })],
      }),
      stored: [stored({ id: "a" }), stored({ id: "b" })],
      verdicts: [verdict({ id: "a" }), verdict({ id: "b" })],
    });
    expect(acts).toEqual(["hold a", "release a", "SIGTERM 900", "forget a", "unhold a", "hold b", "unhold b"]);
    expect(result.terminated).toEqual([900]);
    expect(result.deferred).toEqual(["b"]);
  });

  it("signals nothing when a re-read finds another record carrying the name", () => {
    const acts: string[] = [];
    const twin = {
      ...stored({ id: "a2" }),
      session: { ...stored({ id: "a2" }).session, clientSession: "slopweaver-a" },
    };
    const result = executeBrowserReap({
      effects: effects({
        acts,
        processes: [daemon({ name: "slopweaver-a", pid: 900 })],
        release: TIMED_OUT,
        sessions: () => [stored({ id: "a" }), twin],
      }),
      stored: [stored({ id: "a" })],
      verdicts: [verdict({ id: "a" })],
    });
    expect(acts).toEqual(["hold a", "release a", "forget a", "unhold a"]);
    expect(result.failed).toEqual([
      { id: "a", why: "another record now carries slopweaver-a, so its daemon was not signalled" },
    ]);
  });

  it("acts on an idle verdict whose record is untouched since it was judged, holding the session's lock throughout", () => {
    const acts: string[] = [];
    const result = executeBrowserReap({
      effects: effects({
        acts,
        processes: [daemon({ name: "slopweaver-a", pid: 900 })],
        sessions: () => [stored({ id: "a" })],
      }),
      stored: [stored({ id: "a" })],
      verdicts: [verdict({ id: "a", idleJudgedOn: "2026-09-01T00:00:00.000Z" })],
    });
    expect(acts).toEqual(["hold a", "release a", "forget a", "unhold a"]);
    expect(result.closed).toEqual(["a"]);
  });

  it("LEAVES an idle verdict's session whose lock a command's claim holds right now", () => {
    const acts: string[] = [];
    const result = executeBrowserReap({
      effects: effects({
        acts,
        heldElsewhere: ["a"],
        processes: [daemon({ name: "slopweaver-a", pid: 900 })],
        sessions: () => [stored({ id: "a" })],
      }),
      stored: [stored({ id: "a" })],
      verdicts: [verdict({ id: "a", idleJudgedOn: "2026-09-01T00:00:00.000Z" })],
    });
    expect(acts).toEqual([]);
    expect(result.superseded).toEqual(["a"]);
  });

  it("LEAVES a dead opener's session whose lock a running command holds, so no close lands mid-command", () => {
    const acts: string[] = [];
    const result = executeBrowserReap({
      effects: effects({
        acts,
        heldElsewhere: ["a"],
        processes: [daemon({ name: "slopweaver-a", pid: 900 })],
        sessions: () => [stored({ id: "a" })],
      }),
      stored: [stored({ id: "a" })],
      verdicts: [verdict({ id: "a" })],
    });
    expect(acts).toEqual([]);
    expect(result.superseded).toEqual(["a"]);
  });

  it("LEAVES a dead opener's session whose record another closer already removed", () => {
    const acts: string[] = [];
    const result = executeBrowserReap({
      effects: effects({ acts, processes: [daemon({ name: "slopweaver-a", pid: 900 })] }),
      stored: [stored({ id: "a" })],
      verdicts: [verdict({ id: "a" })],
    });
    expect(acts).toEqual(["hold a", "unhold a"]);
    expect(result.superseded).toEqual(["a"]);
  });

  it("LEAVES an idle verdict's session a command touched after the judgement", () => {
    const acts: string[] = [];
    const touched = {
      ...stored({ id: "a" }),
      session: { ...stored({ id: "a" }).session, touchedAtIso: "2026-09-01T00:20:00.000Z" },
    };
    const result = executeBrowserReap({
      effects: effects({ acts, processes: [daemon({ name: "slopweaver-a", pid: 900 })], sessions: () => [touched] }),
      stored: [stored({ id: "a" })],
      verdicts: [verdict({ id: "a", idleJudgedOn: "2026-09-01T00:00:00.000Z" })],
    });
    expect(acts).toEqual(["hold a", "unhold a"]);
    expect(result.superseded).toEqual(["a"]);
  });

  it("LEAVES an idle verdict's session whose record is already gone — somebody closed it", () => {
    const acts: string[] = [];
    const result = executeBrowserReap({
      effects: effects({ acts, processes: [daemon({ name: "slopweaver-a", pid: 900 })] }),
      stored: [stored({ id: "a" })],
      verdicts: [verdict({ action: "forget", id: "a", idleJudgedOn: "2026-09-01T00:00:00.000Z" })],
    });
    expect(acts).toEqual(["hold a", "unhold a"]);
    expect(result.superseded).toEqual(["a"]);
  });

  it("signals nothing when the daemon now carrying the name is not the one judged", () => {
    const acts: string[] = [];
    const result = executeBrowserReap({
      effects: effects({
        acts,
        processes: [daemon({ name: "slopweaver-a", pid: 901 })],
        release: TIMED_OUT,
        sessions: () => [stored({ id: "a" })],
      }),
      stored: [stored({ id: "a" })],
      verdicts: [verdict({ id: "a" })],
    });
    expect(acts).toEqual(["hold a", "release a", "forget a", "unhold a"]);
    expect(result.failed).toEqual([
      { id: "a", why: "the daemon now carrying slopweaver-a (901) is not the one judged, so it was not signalled" },
    ]);
  });
});
