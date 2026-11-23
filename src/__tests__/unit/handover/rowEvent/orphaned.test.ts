/**
 * `applyRowEvent` on an `orphaned` event: the reap's ending is appended only while the cycle still names the writer,
 * the last event and the event count it was decided over, and refused with nothing written otherwise. A genuine
 * `mkdtempSync` round trip, every directory removed after the case that minted it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../../handover/ledger.js";
import { applyRowEvent } from "../../../../handover/rowEvent.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { AT, LATER, runsDir, STARTED, seed, useRunsDirs } from "./harness.js";

useRunsDirs();

describe("applyRowEvent on an `orphaned` event", () => {
  const LAUNCHED: RunEvent = {
    atIso: LATER,
    host: "claude-code",
    kind: "launched",
    pid: 4242,
    sessionId: "session-dead",
    worktree: "/wt",
  };
  const orphan = ({ deadSessionId = "session-dead", lastEventIso = LATER, cycleEvents = 2 } = {}): RunEvent => ({
    atIso: "2026-09-07T12:00:00.000Z",
    cycleEvents,
    deadSessionId,
    kind: "orphaned",
    lastEventIso,
  });

  it("appends when the event still names the cycle's writer and its last event", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, LAUNCHED], slug: "a-row" });

    const written = applyRowEvent({ event: orphan(), runsDir: dir, slug: "a-row" });

    expect(unwrap(written).state.phase).toBe("closed");
  });

  /** "nobody" is a session id the schema accepts, so absence cannot be spelled as a placeholder string. */
  it("refuses an orphan over a cycle that names NO writer, whatever session the event claims died", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED], slug: "a-row" });

    const error = unwrapErr(
      applyRowEvent({
        event: orphan({ cycleEvents: 1, deadSessionId: "nobody", lastEventIso: AT }),
        runsDir: dir,
        slug: "a-row",
      }),
    );

    expect(error.code).toBe("FORBIDDEN_TRANSITION");
    expect(error.message).toContain("the cycle names no writer, so there is no session whose ending this could be");
    expect(readFileSync(join(dir, "a-row.jsonl"), "utf8")).not.toContain('"kind":"orphaned"');
  });

  /** The count is what sees a same-millisecond append, so a write may not opt out of it by omitting the field. */
  it("refuses an orphan that carries no cycle event count at all", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, LAUNCHED], slug: "a-row" });
    const legacy: RunEvent = {
      atIso: "2026-09-07T12:00:00.000Z",
      deadSessionId: "session-dead",
      kind: "orphaned",
      lastEventIso: LATER,
    };

    const error = unwrapErr(applyRowEvent({ event: legacy, runsDir: dir, slug: "a-row" }));

    expect(error.code).toBe("FORBIDDEN_TRANSITION");
    expect(error.message).toContain("this ending names no cycle event count");
    expect(readFileSync(join(dir, "a-row.jsonl"), "utf8")).not.toContain('"kind":"orphaned"');
  });

  it("refuses an orphan over a journal with undecodable lines, which cannot confirm what it claims", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, LAUNCHED], slug: "a-row" });
    writeFileSync(
      join(dir, "a-row.jsonl"),
      `${readFileSync(join(dir, "a-row.jsonl"), "utf8")}{"kind":"trunc\n`,
      "utf8",
    );

    const error = unwrapErr(applyRowEvent({ event: orphan({ cycleEvents: 2 }), runsDir: dir, slug: "a-row" }));

    expect(error.code).toBe("FORBIDDEN_TRANSITION");
    expect(error.message).toContain("the journal has undecodable line(s) 3");
    expect(readFileSync(join(dir, "a-row.jsonl"), "utf8")).not.toContain('"kind":"orphaned"');
  });

  it("refuses an orphan naming a session that is not the cycle's writer", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, LAUNCHED], slug: "a-row" });

    const error = unwrapErr(
      applyRowEvent({ event: orphan({ deadSessionId: "someone-else" }), runsDir: dir, slug: "a-row" }),
    );

    expect(error.code).toBe("FORBIDDEN_TRANSITION");
    expect(error.message).toContain("the cycle's writer is now session-dead, not someone-else");
  });

  /**
   * A timestamp is not an identity. Two valid events may carry the same instant, so this cycle grew while
   * both its writer and its last `atIso` stayed exactly as the reap recorded them. Only the count moved.
   */
  it("refuses an orphan when the cycle GREW in the same millisecond it was decided over", () => {
    const dir = runsDir();
    const probed: RunEvent = { atIso: LATER, failed: 0, kind: "probed", passed: 1 };
    seed({ dir, events: [STARTED, LAUNCHED, probed], slug: "a-row" });

    const error = unwrapErr(applyRowEvent({ event: orphan(), runsDir: dir, slug: "a-row" }));

    expect(error.code).toBe("FORBIDDEN_TRANSITION");
    expect(error.message).toContain("the cycle now holds 3 event(s), not the 2 the reap was decided over");
  });

  it("refuses an orphan decided before the cycle moved — a claim landing in between keeps the run open", () => {
    const dir = runsDir();
    const claimed: RunEvent = {
      atIso: "2026-09-07T11:30:00.000Z",
      host: "claude-code",
      kind: "launched",
      pid: 5151,
      sessionId: "session-dead",
      worktree: "/wt",
    };
    seed({ dir, events: [STARTED, LAUNCHED, claimed], slug: "a-row" });

    // The count MATCHES here, so the timestamp arm is the one under test rather than a second count check.
    const error = unwrapErr(applyRowEvent({ event: orphan({ cycleEvents: 3 }), runsDir: dir, slug: "a-row" }));

    expect(error.message).toContain(`the cycle's last event is now at 2026-09-07T11:30:00.000Z, not ${LATER}`);
    expect(readFileSync(join(dir, "a-row.jsonl"), "utf8")).not.toContain('"kind":"orphaned"');
  });
});
