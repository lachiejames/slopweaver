/*
 * `classifyRawCommand` on a raw `cmux` call: a covered subcommand is pointed at its verb, an uncovered one says so,
 * a bare `cmux` passes, and the process-wide break-glass waves it through.
 */
import { describe, expect, it } from "vitest";

import { classifyRawCommand } from "../../../../admit/rawTools.js";

describe("raw cmux", () => {
  it("blocks a cmux subcommand a governed verb covers, and points at that verb", () => {
    const verdict = classifyRawCommand({ allowRaw: false, command: "cmux events --after 1" });

    expect(verdict.blocked).toBe(true);
    expect(verdict.blocked ? verdict.message : "").toContain("slopweaver cmux");
  });

  it("blocks a cmux subcommand nothing wraps yet, and says so honestly rather than naming a verb", () => {
    const verdict = classifyRawCommand({ allowRaw: false, command: "cmux feed tui" });

    expect(verdict.blocked).toBe(true);
    expect(verdict.blocked ? verdict.message : "").toContain("has none yet");
  });

  it("reads `workspace list` as covered — the governed verb is `slopweaver cmux list`", () => {
    const verdict = classifyRawCommand({ allowRaw: false, command: "cmux workspace list --json" });

    expect(verdict.blocked ? verdict.message : "").toContain("slopweaver catalog");
  });

  it("lets a bare `cmux` through, since it only prints its own help", () => {
    expect(classifyRawCommand({ allowRaw: false, command: "cmux" }).blocked).toBe(false);
  });

  it("still catches a cmux call hidden after a && in a compound command", () => {
    expect(classifyRawCommand({ allowRaw: false, command: "cd /tmp && cmux send --workspace w 'x'" }).blocked).toBe(
      true,
    );
  });

  it("is waved through by the process-wide break-glass", () => {
    expect(classifyRawCommand({ allowRaw: true, command: "cmux events" }).blocked).toBe(false);
  });
});
