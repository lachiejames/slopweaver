import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CodexDrawdownSample } from "../../../codex/drawdownAnomaly.js";
import { codexSamplesOf, parseCodexDrawdownLine, unseenCodexSamples } from "../../../codex/drawdownJournal.js";
import {
  appendCodexDrawdownJournal,
  type CodexEpisodeClaim,
  claimCodexDrawdownEpisode,
  codexDrawdownJournalPath,
  readCodexDrawdownClaims,
  readCodexDrawdownJournal,
} from "../../../codex/drawdownJournalStore.js";
import { unwrap } from "../../../lib/result.js";

const NOW = "2026-09-12T21:30:00.000Z";

/** One reading, as the journal holds it. */
function sample({
  observedAtIso,
  usedPercent,
  sourceEventId = `${observedAtIso}~codex~primary~${String(usedPercent)}`,
}: {
  observedAtIso: string;
  usedPercent: number;
  sourceEventId?: string;
}): CodexDrawdownSample {
  return {
    accountScope: "self_serve_business_prolite",
    kind: "sample",
    limitId: "codex",
    observedAtIso,
    resetAtIso: "2026-09-19T08:25:25.000Z",
    schemaVersion: 1,
    sourceEventId,
    usedPercent,
    windowMinutes: 10080,
  };
}

/** A claim's `kind`, unwrapped by throwing rather than by a conditional in an assertion. */
function claimPath({ claim }: { claim: CodexEpisodeClaim }): string {
  if (claim.kind !== "taken") {
    throw new Error(`expected a taken claim, got held: ${claim.reason}`);
  }
  return claim.path;
}

describe("the codex burn journal on disk", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /** A throwaway state home inside this file's own temp-root sandbox. */
  function home(): string {
    const dir = mkdtempSync(join(tmpdir(), "codex-burn-"));
    dirs.push(dir);
    return dir;
  }

  it("reads an ABSENT journal as empty history, not as a failure", () => {
    const read = unwrap(readCodexDrawdownJournal({ home: home() }));

    expect(read.events).toStrictEqual([]);
    expect(read.unreadable).toBe(0);
  });

  it("round-trips every reading it wrote", () => {
    const dir = home();
    const events = [
      sample({ observedAtIso: "2026-09-12T00:00:00.000Z", usedPercent: 10 }),
      sample({ observedAtIso: "2026-09-12T01:00:00.000Z", usedPercent: 20 }),
    ];

    expect(appendCodexDrawdownJournal({ events, home: dir }).isOk()).toBe(true);
    const read = unwrap(readCodexDrawdownJournal({ home: dir }));

    expect(codexSamplesOf({ events: read.events })).toStrictEqual(events);
  });

  it("COUNTS a line it cannot parse rather than dropping it, because a lost reading is a wrong baseline", () => {
    const dir = home();
    appendCodexDrawdownJournal({
      events: [sample({ observedAtIso: "2026-09-12T00:00:00.000Z", usedPercent: 10 })],
      home: dir,
    });
    writeFileSync(codexDrawdownJournalPath({ home: dir }), "not json at all\n", { flag: "a" });

    const read = unwrap(readCodexDrawdownJournal({ home: dir }));

    expect(read.events.length).toBe(1);
    expect(read.unreadable).toBe(1);
  });

  it("round-trips every investigation row through its own parser", () => {
    const dir = home();
    appendCodexDrawdownJournal({
      events: [
        { episodeId: "e1", kind: "episode-opened", openedAtIso: NOW, schemaVersion: 1, triggers: [] },
        { closedAtIso: NOW, episodeId: "e1", kind: "episode-closed", reason: "recovered", schemaVersion: 1 },
        { episodeId: "e1", kind: "investigation-opened", recordedAtIso: NOW, schemaVersion: 1, workspaceRef: "w:1" },
        {
          episodeId: "e1",
          kind: "investigation-failed",
          reason: "cmux refused",
          recordedAtIso: NOW,
          schemaVersion: 1,
          workspaceRef: "w:2",
        },
      ],
      home: dir,
    });

    const read = unwrap(readCodexDrawdownJournal({ home: dir }));

    expect(read.unreadable).toBe(0);
    expect(read.events.map((event) => event.kind)).toStrictEqual([
      "episode-opened",
      "episode-closed",
      "investigation-opened",
      "investigation-failed",
    ]);
  });
});

describe("claimCodexDrawdownEpisode", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  function home(): string {
    const dir = mkdtempSync(join(tmpdir(), "codex-claim-"));
    dirs.push(dir);
    return dir;
  }

  it("gives the claim to the FIRST caller and refuses every later one, with no cooperation between them", () => {
    const dir = home();

    const first = unwrap(claimCodexDrawdownEpisode({ episodeId: "e1", home: dir, nowIso: NOW }));
    const second = unwrap(claimCodexDrawdownEpisode({ episodeId: "e1", home: dir, nowIso: NOW }));
    const third = unwrap(claimCodexDrawdownEpisode({ episodeId: "e1", home: dir, nowIso: NOW }));

    expect(first.kind).toBe("taken");
    expect(second.kind).toBe("held");
    expect(third.kind).toBe("held");
  });

  it("claims two different episodes independently", () => {
    const dir = home();

    expect(unwrap(claimCodexDrawdownEpisode({ episodeId: "e1", home: dir, nowIso: NOW })).kind).toBe("taken");
    expect(unwrap(claimCodexDrawdownEpisode({ episodeId: "e2", home: dir, nowIso: NOW })).kind).toBe("taken");
  });

  it("writes the REAL episode id into the claim, since the filename is sanitised and not reversible", () => {
    const dir = home();
    const episodeId = "self_serve_business_prolite~codex~10080~2026-09-19T08:25:25.000Z";

    const claim = unwrap(claimCodexDrawdownEpisode({ episodeId, home: dir, nowIso: NOW }));
    const written: unknown = JSON.parse(readFileSync(claimPath({ claim }), "utf8"));

    expect(written).toStrictEqual({ claimedAtIso: NOW, episodeId, pid: process.pid });
  });

  it("keeps a colon out of the filename, so a claim survives a filesystem that refuses one", () => {
    const dir = home();

    const claim = unwrap(
      claimCodexDrawdownEpisode({ episodeId: "a~b~2026-09-19T08:25:25.000Z", home: dir, nowIso: NOW }),
    );

    expect(claimPath({ claim }).includes(":")).toBe(false);
  });

  it("SURVIVES across reads — a claim is not released by the process that took it going away", () => {
    const dir = home();
    claimCodexDrawdownEpisode({ episodeId: "e1", home: dir, nowIso: NOW });

    expect(unwrap(readCodexDrawdownClaims({ home: dir })).length).toBe(1);
    expect(unwrap(claimCodexDrawdownEpisode({ episodeId: "e1", home: dir, nowIso: NOW })).kind).toBe("held");
  });

  it("reads an absent claim directory as nothing claimed", () => {
    expect(unwrap(readCodexDrawdownClaims({ home: home() }))).toStrictEqual([]);
  });
});

describe("unseenCodexSamples", () => {
  it("keeps only readings whose source event id is not already journalled", () => {
    const known = sample({ observedAtIso: "2026-09-12T00:00:00.000Z", usedPercent: 10 });
    const fresh = sample({ observedAtIso: "2026-09-12T01:00:00.000Z", usedPercent: 20 });

    expect(unseenCodexSamples({ journalled: [known], read: [known, fresh] })).toStrictEqual([fresh]);
  });

  it("deduplicates WITHIN the batch too, so one tick cannot record the same event twice", () => {
    const one = sample({ observedAtIso: "2026-09-12T01:00:00.000Z", usedPercent: 20 });

    expect(unseenCodexSamples({ journalled: [], read: [one, one, one] })).toStrictEqual([one]);
  });

  it("keeps two readings that differ only in PERCENTAGE, which are genuinely two observations", () => {
    const first = sample({ observedAtIso: "2026-09-12T01:00:00.000Z", usedPercent: 20 });
    const second = sample({ observedAtIso: "2026-09-12T01:00:00.000Z", usedPercent: 21 });

    expect(unseenCodexSamples({ journalled: [], read: [first, second] }).length).toBe(2);
  });
});

describe("parseCodexDrawdownLine", () => {
  it("refuses a line that is not JSON, naming the read rather than the shape", () => {
    const parsed = parseCodexDrawdownLine({ line: "{" });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().message).toContain("not readable JSON");
  });

  it("refuses a line naming an unknown kind, rather than silently dropping it", () => {
    const parsed = parseCodexDrawdownLine({ line: JSON.stringify({ kind: "something-else" }) });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().message).toContain("unknown kind: something-else");
  });

  it("refuses a sample whose usedPercent is not a finite number", () => {
    const parsed = parseCodexDrawdownLine({
      line: JSON.stringify({ ...sample({ observedAtIso: NOW, usedPercent: 1 }), usedPercent: "40" }),
    });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().message).toContain("not a finite number");
  });

  it("refuses an investigation-opened line with no workspace ref, which would name nothing to go and look at", () => {
    const parsed = parseCodexDrawdownLine({
      line: JSON.stringify({ episodeId: "e1", kind: "investigation-opened", recordedAtIso: NOW }),
    });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().message).toContain("workspaceRef");
  });

  it("reads an investigation-failed line that names NO workspace, which is the ordinary failure", () => {
    const parsed = parseCodexDrawdownLine({
      line: JSON.stringify({ episodeId: "e1", kind: "investigation-failed", reason: "no cmux", recordedAtIso: NOW }),
    });

    expect(unwrap(parsed)).toStrictEqual({
      episodeId: "e1",
      kind: "investigation-failed",
      reason: "no cmux",
      recordedAtIso: NOW,
      schemaVersion: 1,
      workspaceRef: undefined,
    });
  });
});
