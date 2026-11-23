/**
 * A Codex-held pin reads no Claude chair: the pinned workspace's Claude tabs are not the chair then, so `claude
 * gauge` must never report one's plan as the chair's. Both reads refuse before cmux is asked.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readChairPlans } from "../../../claude/seatBootRead.js";
import { writeSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { CODEX_PIN_HAS_NO_CLAUDE_CHAIR, readPinnedChairSessionIds } from "../../../supervisor/chairRead.js";

const scratch: string[] = [];

afterEach(() => {
  scratch.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A fresh home whose supervisor pin names a Codex thread, removed after the test. */
function codexPinnedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "codex-pin-"));
  scratch.push(home);
  writeSupervisorPin({
    home,
    record: {
      pinnedAtIso: "2026-11-05T00:00:00.000Z",
      session: { host: "codex", id: "thread-1" },
      workspaceId: "WS-PINNED",
      workspaceRef: "workspace:1",
    },
  });
  return home;
}

describe("a Codex-held pin reads no Claude chair", () => {
  it("leaves the pinned chair's Claude sessions unresolved, saying why", async () => {
    const home = codexPinnedHome();

    await expect(readPinnedChairSessionIds({ claudeHome: home, home })).resolves.toStrictEqual({
      kind: "unresolved",
      why: CODEX_PIN_HAS_NO_CLAUDE_CHAIR,
    });
  });

  it("reads the chair's plan as unread in `claude gauge`, never a co-located Claude tab's", async () => {
    const home = codexPinnedHome();

    await expect(readChairPlans({ accounts: [], claudeHome: home, home })).resolves.toStrictEqual({
      lines: [`chair plan UNREAD — ${CODEX_PIN_HAS_NO_CLAUDE_CHAIR}`],
      sessions: [],
      unread: CODEX_PIN_HAS_NO_CLAUDE_CHAIR,
    });
  });
});
