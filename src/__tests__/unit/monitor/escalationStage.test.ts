/**
 * The escalation stage: a pending hold takes its baseline from the first fired reading, a STRICTLY worse reading raises
 * the subject's newest open card and forgets the hold, a failed raise keeps it, and a clear reading forgets it. A
 * pass that did not read the monitor, or read it partially and missed the subject, leaves the hold exactly where it is.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type HandStep, MONITOR_WITNESS } from "../../../hand/step.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import {
  type EscalationHold,
  escalationDir,
  readEscalationHolds,
  recordEscalationHold,
} from "../../../monitor/escalationHolds.js";
import { judgeEscalation, runEscalationStage, runFiredEscalations } from "../../../monitor/escalationStage.js";
import { recordNoteMute } from "../../../monitor/noteMutes.js";
import type { NoteRaiser } from "../../../monitor/passPost.js";
import type { MonitorReading } from "../../../monitor/types.js";

const PRESSED = "2026-11-05T01:00:00.000Z";
const NOW = "2026-11-05T01:10:00.000Z";
const GB = 1_000_000_000;

const PENDING: EscalationHold = {
  base: "mon-fsev-97860",
  monitorId: "fseventsd-bloated",
  pressedIso: PRESSED,
  state: { kind: "pending" },
  stepId: "mon-fsev-97860",
};

const HOLDING: EscalationHold = { ...PENDING, state: { baseline: 3 * GB, kind: "holding", measuredIso: PRESSED } };

/** fseventsd read firing at `bytes`, under pid `key`. */
function firing({
  bytes,
  key = "97860",
  blindSpot,
}: {
  bytes: number;
  key?: string;
  blindSpot?: string;
}): MonitorReading {
  return {
    blindSpot,
    monitorId: "fseventsd-bloated",
    state: "firing",
    subjects: [{ footprintBytes: bytes, id: "fseventsd", key, label: "x GB" }],
  };
}

const CLEAR: MonitorReading = { monitorId: "fseventsd-bloated", state: "clear" };

/** The fence of a pass that holds its lease throughout. */
const HELD = (): boolean => true;

describe("judgeEscalation", () => {
  it("keeps the hold when the pass did not read its monitor, or read it steered or unmeasurable", () => {
    expect(judgeEscalation({ hold: HOLDING, reading: undefined })).toEqual({ kind: "keep" });
    expect(
      judgeEscalation({
        hold: HOLDING,
        reading: { because: "a call is live", monitorId: "fseventsd-bloated", state: "unmeasurable" },
      }),
    ).toEqual({ kind: "keep" });
  });

  it("forgets the hold when the monitor reads clear", () => {
    expect(judgeEscalation({ hold: HOLDING, reading: CLEAR })).toEqual({
      kind: "forget",
      why: "the monitor reads clear",
    });
  });

  it("forgets the hold when a complete read no longer carries the subject, and keeps it on a partial one", () => {
    expect(judgeEscalation({ hold: HOLDING, reading: firing({ bytes: 9 * GB, key: "11111" }) })).toEqual({
      kind: "forget",
      why: "the subject is no longer read firing",
    });
    expect(
      judgeEscalation({
        hold: HOLDING,
        reading: firing({ blindSpot: "one source unread", bytes: 9 * GB, key: "11111" }),
      }),
    ).toEqual({
      kind: "keep",
    });
  });

  it("takes a pending hold's baseline from the first reading of its subject", () => {
    expect(judgeEscalation({ hold: PENDING, reading: firing({ bytes: 3 * GB }) })).toEqual({
      baseline: 3 * GB,
      kind: "measure",
    });
  });

  it("calls a holding hold worse only on a strictly worse reading", () => {
    expect(judgeEscalation({ hold: HOLDING, reading: firing({ bytes: 3 * GB }) })).toEqual({ kind: "keep" });
    expect(judgeEscalation({ hold: HOLDING, reading: firing({ bytes: 2.5 * GB }) })).toEqual({ kind: "keep" });
    expect(judgeEscalation({ hold: HOLDING, reading: firing({ bytes: 3 * GB + 1 }) })).toEqual({
      baseline: 3 * GB,
      kind: "worse",
      measure: 3 * GB + 1,
    });
  });
});

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "escalation-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A monitor card open under `id`. */
function card({ id }: { id: string }): HandStep {
  return { id, postedBy: "monitor", postedIso: PRESSED, unblocks: "u", what: "w", witness: MONITOR_WITNESS };
}

/** A raiser that records every step it was asked to raise and answers as `answer` says. */
function raiser({ answer }: { answer: "up" | "fails" }): { raised: string[]; raiseNote: NoteRaiser } {
  const raised: string[] = [];
  return {
    raiseNote: ({ step }) => {
      raised.push(step.id);
      return answer === "up" ? ok("the note is up") : err("open: the panel would not launch");
    },
    raised,
  };
}

describe("runEscalationStage", () => {
  it("records a pending hold's baseline as holding, raising nothing", () => {
    unwrap(recordEscalationHold({ hold: PENDING, home }));
    const { raised, raiseNote } = raiser({ answer: "up" });
    const ran = runEscalationStage({
      home,
      nowIso: NOW,
      open: [card({ id: "mon-fsev-97860" })],
      raiseNote,
      readings: [firing({ bytes: 3 * GB })],
      stillHeld: HELD,
    });
    expect(ran).toEqual({ actions: [], fenced: false, problems: [] });
    expect(raised).toEqual([]);
    expect(readEscalationHolds({ home }).records).toEqual([
      { ...PENDING, state: { baseline: 3 * GB, kind: "holding", measuredIso: NOW } },
    ]);
  });

  it("raises the subject's newest open card when it reads worse, and forgets the hold", () => {
    unwrap(recordEscalationHold({ hold: HOLDING, home }));
    const { raised, raiseNote } = raiser({ answer: "up" });
    const ran = runEscalationStage({
      home,
      nowIso: NOW,
      open: [card({ id: "mon-fsev-97860.3" }), card({ id: "mon-fsev-97860.2" })],
      raiseNote,
      readings: [firing({ bytes: 4 * GB })],
      stillHeld: HELD,
    });
    expect(raised).toEqual(["mon-fsev-97860.3"]);
    expect(ran).toEqual({
      actions: [
        {
          detail: "it got worse (3000000000 → 4000000000 bytes): the note is up",
          kind: "noted",
          monitorId: "fseventsd-bloated",
          stepId: "mon-fsev-97860.3",
        },
      ],
      fenced: false,
      problems: [],
    });
    expect(readEscalationHolds({ home }).records).toEqual([]);
  });

  it("raises nothing when the subject reads worse but its kind is muted, and forgets the hold the mute covers", () => {
    unwrap(recordEscalationHold({ hold: HOLDING, home }));
    unwrap(
      recordNoteMute({ home, mute: { from: { kind: "command" }, monitorId: "fseventsd-bloated", mutedIso: PRESSED } }),
    );
    const { raised, raiseNote } = raiser({ answer: "up" });
    const ran = runEscalationStage({
      home,
      nowIso: NOW,
      open: [card({ id: "mon-fsev-97860" })],
      raiseNote,
      readings: [firing({ bytes: 4 * GB })],
      stillHeld: HELD,
    });
    expect(raised).toEqual([]);
    expect(ran.actions).toEqual([
      {
        detail:
          "it read worse, but you muted fseventsd-bloated's note — no note comes up, the hold is forgotten; the card stands",
        kind: "settled",
        monitorId: "fseventsd-bloated",
        stepId: "mon-fsev-97860",
      },
    ]);
    expect(readEscalationHolds({ home }).records).toEqual([]);
  });

  it("keeps the hold when the raise fails, so the next pass retries", () => {
    unwrap(recordEscalationHold({ hold: HOLDING, home }));
    const { raiseNote } = raiser({ answer: "fails" });
    const ran = runEscalationStage({
      home,
      nowIso: NOW,
      open: [card({ id: "mon-fsev-97860" })],
      raiseNote,
      readings: [firing({ bytes: 4 * GB })],
      stillHeld: HELD,
    });
    expect(ran.actions).toEqual([
      {
        detail: "it read worse, but the floating note did not come up: open: the panel would not launch",
        kind: "refused",
        monitorId: "fseventsd-bloated",
        stepId: "mon-fsev-97860",
      },
    ]);
    expect(readEscalationHolds({ home }).records).toEqual([HOLDING]);
  });

  it("forgets the hold when the monitor reads clear", () => {
    unwrap(recordEscalationHold({ hold: HOLDING, home }));
    const { raised, raiseNote } = raiser({ answer: "up" });
    const ran = runEscalationStage({ home, nowIso: NOW, open: [], raiseNote, readings: [CLEAR], stillHeld: HELD });
    expect(raised).toEqual([]);
    expect(ran.actions).toEqual([
      {
        detail: 'the "when it gets worse" hold is forgotten: the monitor reads clear',
        kind: "settled",
        monitorId: "fseventsd-bloated",
        stepId: "mon-fsev-97860",
      },
    ]);
    expect(readEscalationHolds({ home }).records).toEqual([]);
  });

  it("skips a hold the owner re-answered while the stage ran, so the newer pending hold survives", () => {
    unwrap(recordEscalationHold({ hold: HOLDING, home }));
    const { raised, raiseNote } = raiser({ answer: "up" });
    const repressed: EscalationHold = { ...PENDING, pressedIso: NOW };
    const ran = runEscalationStage({
      home,
      nowIso: NOW,
      open: [card({ id: "mon-fsev-97860" })],
      raiseNote,
      readings: [firing({ bytes: 4 * GB })],
      stillHeld: () => {
        unwrap(recordEscalationHold({ hold: repressed, home }));
        return true;
      },
    });
    expect([ran, raised]).toEqual([{ actions: [], fenced: false, problems: [] }, []]);
    expect(readEscalationHolds({ home }).records).toEqual([repressed]);
  });

  it("raises, yet keeps a hold the owner re-answered while the note was launching", () => {
    unwrap(recordEscalationHold({ hold: HOLDING, home }));
    const repressed: EscalationHold = { ...PENDING, pressedIso: NOW };
    const raised: string[] = [];
    const ran = runEscalationStage({
      home,
      nowIso: NOW,
      open: [card({ id: "mon-fsev-97860" })],
      raiseNote: ({ step }) => {
        raised.push(step.id);
        unwrap(recordEscalationHold({ hold: repressed, home }));
        return ok("the note is up");
      },
      readings: [firing({ bytes: 4 * GB })],
      stillHeld: HELD,
    });
    expect([ran.actions.map((action) => action.kind), raised]).toEqual([["noted"], ["mon-fsev-97860"]]);
    expect(readEscalationHolds({ home }).records).toEqual([repressed]);
  });

  it("raises, yet leaves the hold to the new holder when the lease is taken over during the launch", () => {
    unwrap(recordEscalationHold({ hold: HOLDING, home }));
    let held = true;
    const ran = runEscalationStage({
      home,
      nowIso: NOW,
      open: [card({ id: "mon-fsev-97860" })],
      raiseNote: () => {
        held = false;
        return ok("the note is up");
      },
      readings: [firing({ bytes: 4 * GB })],
      stillHeld: () => held,
    });
    expect(ran.actions.map((action) => action.kind)).toEqual(["noted"]);
    expect(readEscalationHolds({ home }).records).toEqual([HOLDING]);
  });

  it("leaves a hold untouched by a pass that did not read its monitor", () => {
    unwrap(recordEscalationHold({ hold: HOLDING, home }));
    const { raiseNote } = raiser({ answer: "up" });
    expect(runEscalationStage({ home, nowIso: NOW, open: [], raiseNote, readings: [], stillHeld: HELD })).toEqual({
      actions: [],
      fenced: false,
      problems: [],
    });
    expect(readEscalationHolds({ home }).records).toEqual([HOLDING]);
  });
});

/** A fence that answers each of `answers` in turn, then false: the lease taken over after that many checks. */
function fenceAnswering({ answers }: { answers: readonly boolean[] }): () => boolean {
  let asked = 0;
  return () => {
    asked += 1;
    return answers[asked - 1] === true;
  };
}

describe("runEscalationStage's reread", () => {
  it("names a hold that turned unreadable between the stage's read and its reread, never skipping it silently", () => {
    unwrap(recordEscalationHold({ hold: HOLDING, home }));
    const { raised, raiseNote } = raiser({ answer: "up" });
    const path = join(escalationDir({ home }), "mon-fsev-97860.json");
    // The lease fence runs between the first read and the reread: another process takes the file's read bit there.
    const stillHeld = (): boolean => {
      chmodSync(path, 0o000);
      return true;
    };
    try {
      const ran = runEscalationStage({
        home,
        nowIso: NOW,
        open: [card({ id: "mon-fsev-97860" })],
        raiseNote,
        readings: [firing({ bytes: 4 * GB })],
        stillHeld,
      });
      expect(raised).toEqual([]);
      expect(ran.actions).toEqual([]);
      expect(ran.problems.map((problem) => problem.code)).toEqual(["KIND_ANSWER_STORE"]);
      expect(ran.problems[0]!.message).toContain(`the kind answer store at ${path} failed`);
    } finally {
      chmodSync(path, 0o600);
    }
  });

  it("names, once, a hold that appeared torn mid-stage beside one that still reads, though the loop never visits it", () => {
    unwrap(recordEscalationHold({ hold: HOLDING, home }));
    const { raised, raiseNote } = raiser({ answer: "up" });
    const torn = join(escalationDir({ home }), "mon-fsev-11111.json");
    const stillHeld = (): boolean => {
      writeFileSync(torn, "{");
      return true;
    };
    const ran = runEscalationStage({
      home,
      nowIso: NOW,
      open: [card({ id: "mon-fsev-97860" })],
      raiseNote,
      readings: [firing({ bytes: 4 * GB })],
      stillHeld,
    });
    expect(raised).toEqual(["mon-fsev-97860"]);
    expect(ran.problems.map((problem) => problem.code)).toEqual(["KIND_ANSWER_STORE"]);
    expect(ran.problems[0]!.message).toContain(`the kind answer store at ${torn} failed`);
  });
});

describe("runFiredEscalations", () => {
  it("judges nothing in a pass that lost its fired-pass lease, so a stale reading never meets a newer baseline", () => {
    unwrap(recordEscalationHold({ hold: HOLDING, home }));
    const { raised, raiseNote } = raiser({ answer: "up" });
    const lines: string[] = [];
    const { actions: rows, faulted } = runFiredEscalations({
      home,
      nowIso: NOW,
      raiseNote,
      readings: [firing({ bytes: 4 * GB })],
      stillHeld: () => false,
      writeDiagnostic: (line) => lines.push(line),
    });
    expect([rows, faulted, raised, lines]).toEqual([
      [],
      false,
      [],
      ["monitor check: escalation holds not judged — another fired pass took the lease"],
    ]);
    expect(readEscalationHolds({ home }).records).toEqual([HOLDING]);
  });

  it("raises nothing and keeps the hold when the lease is taken over after the entry check", () => {
    unwrap(recordEscalationHold({ hold: HOLDING, home }));
    const { raised, raiseNote } = raiser({ answer: "up" });
    const lines: string[] = [];
    const { actions: rows, faulted } = runFiredEscalations({
      home,
      nowIso: NOW,
      raiseNote,
      readings: [firing({ bytes: 4 * GB })],
      stillHeld: fenceAnswering({ answers: [true] }),
      writeDiagnostic: (line) => lines.push(line),
    });
    expect([rows, faulted, raised, lines]).toEqual([
      [],
      false,
      [],
      ["monitor check: escalation holds not all judged — another fired pass took the lease mid-stage"],
    ]);
    expect(readEscalationHolds({ home }).records).toEqual([HOLDING]);
  });

  it("judges over the register as it stands when the pass still holds the lease", () => {
    unwrap(recordEscalationHold({ hold: HOLDING, home }));
    const { raiseNote } = raiser({ answer: "up" });
    const lines: string[] = [];
    const { actions: rows, faulted } = runFiredEscalations({
      home,
      nowIso: NOW,
      raiseNote,
      readings: [firing({ bytes: 4 * GB })],
      stillHeld: () => true,
      writeDiagnostic: (line) => lines.push(line),
    });
    expect([rows, faulted, lines]).toEqual([
      [
        {
          detail: "it read worse, but no card for it is open — the hold is forgotten",
          kind: "settled",
          monitorId: "fseventsd-bloated",
          stepId: "mon-fsev-97860",
        },
      ],
      false,
      [],
    ]);
  });

  it("reports faulted when a hold it must forget will not go, so the verb exits 1 while it stands", () => {
    unwrap(recordEscalationHold({ hold: HOLDING, home }));
    const { raiseNote } = raiser({ answer: "up" });
    const lines: string[] = [];
    // Readable and searchable, never writable: the hold lists, and its unlink is refused.
    chmodSync(escalationDir({ home }), 0o500);
    try {
      const { actions, faulted } = runFiredEscalations({
        home,
        nowIso: NOW,
        raiseNote,
        readings: [firing({ bytes: 4 * GB })],
        stillHeld: () => true,
        writeDiagnostic: (line) => lines.push(line),
      });
      expect(faulted).toBe(true);
      expect(actions).toEqual([]);
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain(join(escalationDir({ home }), "mon-fsev-97860.json"));
      expect(readEscalationHolds({ home }).records).toEqual([HOLDING]);
    } finally {
      chmodSync(escalationDir({ home }), 0o700);
    }
  });
});
