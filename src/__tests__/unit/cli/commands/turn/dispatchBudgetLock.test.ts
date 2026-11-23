/**
 * The budget warn's read-check-append runs under the ask's operation lock, aged by the wall clock — the fixes
 * for two Codex review rounds on this change. Round one: two concurrent writers both read an empty log and
 * both appended. Round two: the lock was aged by the sweep's caller-controlled `--now`, so a sweep judged
 * twenty minutes later stole a live writer's lock.
 *
 * A true two-process race cannot be scheduled deterministically, so the witness is the lock itself: this
 * process takes it first, exactly as a concurrent writer would be holding it, and the budget pass must then
 * record NOTHING and say why. Released, the same pass records its one warn — so the absence is a refusal,
 * not a pass that had nothing to do. Every instant is pinned; no test here reads the real clock.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import { sweepBudgetLines } from "../../../../../cli/commands/turn/dispatchBudget.js";
import { progressLogPath } from "../../../../../live/turn/progressLog.js";
import { materialiseFixture } from "../../../../replayFixture.js";

/** The judged instant, just past the fixture's warn mark. */
const PAST_MARK = "2026-09-12T05:50:00.000Z";
/**
 * The wall clock the first writer took the lock at — the round-two counterexample's writer A, judged and
 * locked at the same instant — and the wall clock one minute later, when writer B arrives.
 */
const LOCKED_AT = PAST_MARK;
const A_MINUTE_LATER = "2026-09-12T05:51:00.000Z";

const workspaces: string[] = [];
afterEach(() => {
  for (const dir of workspaces.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A throwaway home holding the frozen dispatch.
 *
 * @returns the home and the fixture ask
 */
function fixtureHome(): { home: string; askIdentity: { channel: string; messageTs: string; threadTs: string } } {
  const workspace = mkdtempSync(join(tmpdir(), "slop-budget-lock-"));
  workspaces.push(workspace);
  const home = join(workspace, "home");
  const manifest = materialiseFixture({ into: home, slug: "long-dispatch-no-warn-12sep" });
  return { askIdentity: manifest.ask, home };
}

/**
 * Take the warn lock as a concurrent writer would be holding it.
 *
 * @param askIdentity the fixture ask
 * @param home the fixture home
 * @returns the held lock
 */
function holdWarnLock({ askIdentity, home }: { askIdentity: { channel: string; messageTs: string }; home: string }): {
  release: () => void;
} {
  return unwrap(
    acquireOperationLock({
      home,
      key: `budget-warn:${askIdentity.channel}-${askIdentity.messageTs}`,
      nowIso: LOCKED_AT,
    }),
  );
}

describe("sweepBudgetLines under the warn lock", () => {
  it("records nothing, and says so, while another writer holds the lock", () => {
    const { askIdentity, home } = fixtureHome();
    const held = holdWarnLock({ askIdentity, home });
    const lines = sweepBudgetLines({ askIdentity, home, lockNowIso: A_MINUTE_LATER, nowIso: PAST_MARK });
    held.release();
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("no warn recorded this pass: another budget warn write holds the lock");
    expect(existsSync(progressLogPath({ askIdentity, home }))).toBe(false);
  });

  it("does not steal a live writer's lock when only the judged instant is later", () => {
    const { askIdentity, home } = fixtureHome();
    const held = holdWarnLock({ askIdentity, home });
    // The round-two counterexample: judged twenty minutes past the first writer, one wall-clock minute later.
    const lines = sweepBudgetLines({
      askIdentity,
      home,
      lockNowIso: A_MINUTE_LATER,
      nowIso: "2026-09-12T06:10:00.000Z",
    });
    held.release();
    expect(lines[0]).toContain("another budget warn write holds the lock");
    expect(existsSync(progressLogPath({ askIdentity, home }))).toBe(false);
  });

  it("records its one clock warn once the lock is free", () => {
    const { askIdentity, home } = fixtureHome();
    const lines = sweepBudgetLines({ askIdentity, home, lockNowIso: A_MINUTE_LATER, nowIso: PAST_MARK });
    expect(lines[0]).toBe(
      `budget warn raised (clock): ${askIdentity.channel}/${askIdentity.messageTs} — the warn mark was crossed`,
    );
    const rows = readFileSync(progressLogPath({ askIdentity, home }), "utf8").trim().split("\n");
    expect(rows.length).toBe(1);
  });
});
