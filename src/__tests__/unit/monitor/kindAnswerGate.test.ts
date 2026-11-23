/**
 * The kind answers, applied to an automatic raise: a muted kind or a held subject keeps the note down with a phrase
 * the pass prints, any other step raises as before, and a kept-down note reads `dismissed` rather than `absent`.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type HandStep, MONITOR_WITNESS } from "../../../hand/step.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { recordEscalationHold } from "../../../monitor/escalationHolds.js";
import { keptDownRaiser, monitorNoteStanding, noteKeptDown } from "../../../monitor/kindAnswerGate.js";
import { recordNoteMute } from "../../../monitor/noteMutes.js";
import type { NoteRaiser } from "../../../monitor/passPost.js";

const PRESSED = "2026-11-05T01:00:00.000Z";
const MUTED_PHRASE =
  "kept down — you muted chair-off-fable's note (`slopweaver hand mute remove chair-off-fable` brings it back); the card stands";
const HELD_PHRASE = "kept down until it reads worse — you asked to be told only then; the card stands";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kind-gate-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A step open under `id`, a monitor card unless `witness` says otherwise. */
function card({ id, witness = MONITOR_WITNESS }: { id: string; witness?: string }): HandStep {
  return { id, postedBy: "monitor", postedIso: PRESSED, unblocks: "u", what: "w", witness };
}

function muteChair(): void {
  unwrap(
    recordNoteMute({ home, mute: { from: { kind: "command" }, monitorId: "chair-off-fable", mutedIso: PRESSED } }),
  );
}

function holdFsev(): void {
  unwrap(
    recordEscalationHold({
      hold: {
        base: "mon-fsev-97860",
        monitorId: "fseventsd-bloated",
        pressedIso: PRESSED,
        state: { kind: "pending" },
        stepId: "mon-fsev-97860",
      },
      home,
    }),
  );
}

describe("noteKeptDown", () => {
  it("keeps a muted kind's note down, naming the command that brings it back", () => {
    muteChair();
    expect(noteKeptDown({ home, step: card({ id: "mon-chair-unpinned" }) })).toBe(MUTED_PHRASE);
  });

  it("keeps a held subject's note down on every occurrence of its card", () => {
    holdFsev();
    expect(noteKeptDown({ home, step: card({ id: "mon-fsev-97860.2" }) })).toBe(HELD_PHRASE);
    expect(noteKeptDown({ home, step: card({ id: "mon-fsev-11111" }) })).toBe(undefined);
  });

  it("keeps nothing down for another kind, or for a step that is no monitor's card", () => {
    muteChair();
    expect(noteKeptDown({ home, step: card({ id: "mon-fsev-97860" }) })).toBe(undefined);
    expect(noteKeptDown({ home, step: card({ id: "mon-chair-unpinned", witness: "slopweaver hand done x" }) })).toBe(
      undefined,
    );
  });
});

describe("a press no store has taken yet", () => {
  it("keeps down every card of its kind for a Never, and every card of its subject for a When it gets worse", () => {
    const dismiss = join(home, "hand-steps", "dismiss");
    mkdirSync(dismiss, { recursive: true });
    writeFileSync(join(dismiss, "mon-chair-unpinned.mute-kind"), `${PRESSED}\n`);
    writeFileSync(join(dismiss, "mon-fsev-97860.when-worse"), `${PRESSED}\n`);
    expect(noteKeptDown({ home, step: card({ id: "mon-chair-unpinned" }) })).toBe(
      "kept down — your Never for this kind on mon-chair-unpinned is not recorded yet (`slopweaver hand mute list` says why); the card stands",
    );
    expect(noteKeptDown({ home, step: card({ id: "mon-fsev-97860.2" }) })).toBe(
      "kept down — your When it gets worse on mon-fsev-97860 is not recorded yet (`slopweaver hand mute list` says why); the card stands",
    );
    expect(noteKeptDown({ home, step: card({ id: "mon-fsev-11111" }) })).toBe(undefined);
    expect(unwrap(monitorNoteStanding({ clock: () => PRESSED, home, id: "mon-fsev-97860.2" }))).toBe("dismissed");
  });
});

describe("a notice is never kept down", () => {
  it("raises a notice's note, and reads it absent, even with a mute record standing for its kind", () => {
    // The verbs refuse to write this record; one that stands anyway must not take away the notice's only delivery.
    unwrap(
      recordNoteMute({ home, mute: { from: { kind: "command" }, monitorId: "recipe-repairing", mutedIso: PRESSED } }),
    );
    expect(noteKeptDown({ home, step: card({ id: "mon-repairing-abc" }) })).toBe(undefined);
    expect(
      unwrap(monitorNoteStanding({ clock: () => "2026-11-05T02:00:00.000Z", home, id: "mon-repairing-abc" })),
    ).toBe("absent");
  });
});

describe("keptDownRaiser", () => {
  it("answers ok with the phrase instead of raising a kept-down note, and raises any other", () => {
    muteChair();
    const raised: string[] = [];
    const raw: NoteRaiser = ({ step }) => {
      raised.push(step.id);
      return ok("the note is up");
    };
    const gated = keptDownRaiser({ home, raiseNote: raw });
    expect(unwrap(gated({ level: "ordinary", step: card({ id: "mon-chair-unpinned" }) }))).toBe(MUTED_PHRASE);
    expect(unwrap(gated({ level: "ordinary", step: card({ id: "mon-fsev-97860" }) }))).toBe("the note is up");
    expect(raised).toEqual(["mon-fsev-97860"]);
  });
});

describe("monitorNoteStanding", () => {
  const clock = (): string => "2026-11-05T02:00:00.000Z";

  it("reads a never-raised note of a muted kind or a held subject as dismissed, and any other as absent", () => {
    muteChair();
    holdFsev();
    expect(unwrap(monitorNoteStanding({ clock, home, id: "mon-chair-unpinned" }))).toBe("dismissed");
    expect(unwrap(monitorNoteStanding({ clock, home, id: "mon-fsev-97860.2" }))).toBe("dismissed");
    expect(unwrap(monitorNoteStanding({ clock, home, id: "mon-health-0a1b2c" }))).toBe("absent");
  });

  it("names a store that will not read, never passing it off as the owner's dismissal", () => {
    muteChair();
    const mutes = join(home, "hand-steps", "mutes");
    chmodSync(mutes, 0o000);
    try {
      const error = unwrapErr(monitorNoteStanding({ clock, home, id: "mon-health-0a1b2c" }));
      expect(error.code).toBe("STORE_UNREADABLE");
      expect(error.message).toContain(mutes);
    } finally {
      chmodSync(mutes, 0o700);
    }
  });

  it("names a marker directory that will not list, where a press may stand", () => {
    const dismiss = join(home, "hand-steps", "dismiss");
    mkdirSync(dismiss, { recursive: true });
    // A Never pressed on ANOTHER card of the kind: only a listing finds it, never a lookup by this step's own name.
    writeFileSync(join(dismiss, "mon-health-9f8e7d.mute-kind"), `${PRESSED}\n`);
    // Writable and searchable, never listable: a known name still reaches, a readdir is refused.
    chmodSync(dismiss, 0o300);
    try {
      const error = unwrapErr(monitorNoteStanding({ clock, home, id: "mon-health-0a1b2c" }));
      expect(error.code).toBe("STORE_UNREADABLE");
      expect(error.message).toContain(dismiss);
      expect(noteKeptDown({ home, step: card({ id: "mon-health-0a1b2c" }) })).toContain(
        "and a press of yours may stand there (`slopweaver hand mute list` names it); the card stands",
      );
    } finally {
      chmodSync(dismiss, 0o700);
    }
  });
});
