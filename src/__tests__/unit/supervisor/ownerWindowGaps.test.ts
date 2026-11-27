import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { supervisorPinPath, writeSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { ownerWindowGaps } from "../../../supervisor/ownerWindowGaps.js";

const scratch: string[] = [];

afterEach(() => {
  scratch.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A fresh state home, removed after the test. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "window-gaps-"));
  scratch.push(dir);
  return dir;
}

const REFUSAL = "chair codex:thread-1: CODEX_HOME_UNRECORDED: no Codex home is recorded for it";

describe("ownerWindowGaps", () => {
  it("names nothing when the pin, the archive and every Codex chair read", () => {
    expect(ownerWindowGaps({ chainProblems: [], codexRefusals: [], home: home(), rulingProblems: [] })).toBeUndefined();
  });

  it("names nothing for a readable Codex pin — a Codex chair is read now, not a blanket gap", () => {
    const dir = home();
    const record = { pinnedAtIso: "2026-09-05T03:00:00.000Z", workspaceId: "ws", workspaceRef: "workspace:1" };
    writeSupervisorPin({ home: dir, record: { ...record, session: { host: "codex", id: "thread-2" } } });

    expect(ownerWindowGaps({ chainProblems: [], codexRefusals: [], home: dir, rulingProblems: [] })).toBeUndefined();
  });

  it("names each Codex chair whose rollout would not read, after the archive's gap", () => {
    expect(
      ownerWindowGaps({
        chainProblems: [],
        codexRefusals: [REFUSAL, "chair codex:t2: x"],
        home: home(),
        rulingProblems: ["a.md: torn"],
      }),
    ).toBe(`ruling archive: a.md: torn; ${REFUSAL}; chair codex:t2: x`);
  });

  it("names a torn chain journal first without hiding the Codex chair that also refused", () => {
    expect(
      ownerWindowGaps({ chainProblems: ["line 2: torn"], codexRefusals: [REFUSAL], home: home(), rulingProblems: [] }),
    ).toBe(`the supervisor chain journal would not read cleanly: line 2: torn; ${REFUSAL}`);
  });

  it("names a pin that is there and will not read first", () => {
    const dir = home();
    const path = supervisorPinPath({ home: dir });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{torn");

    expect(ownerWindowGaps({ chainProblems: [], codexRefusals: [REFUSAL], home: dir, rulingProblems: [] })).toMatch(
      new RegExp(`^supervisor pin: .+; ${REFUSAL}$`),
    );
  });
});
