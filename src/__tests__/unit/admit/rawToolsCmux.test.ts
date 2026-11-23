/**
 * How the raw-command gate classifies a RETIRED raw `cmux` sidebar write — beside `rawTools/cmux.test.ts`'s own
 * `raw cmux` cases rather than inside them, so each file sits under the size cap.
 */
import { describe, expect, it } from "vitest";

import { classifyRawCommand } from "../../../admit/rawTools.js";

/** Assert a command is blocked and return its message (throws otherwise — keeps assertions unconditional). */
function blockedMessage({ command }: { command: string }): string {
  const verdict = classifyRawCommand({ allowRaw: false, command });
  if (!verdict.blocked) {
    throw new Error(`expected blocked for: ${command}`);
  }
  return verdict.message;
}

describe("raw cmux sidebar writes", () => {
  // The owner reads no sidebar checklist, lane or progress bar, so no verb writes one, and a seat
  // still carrying the old instruction is told the write is retired rather than pointed at break-glass.
  it.each([
    "cmux todo set",
    "cmux todo check ID-1",
    "cmux workspace status set review",
    "cmux set-progress 0.5 --label half",
    "cmux clear-progress",
    "cmux 'todo' set '[]'",
    'cmux workspace "status" set review',
    "cmux t'odo' set '[]'",
    "cmux set-pro\\gress 0.5",
  ])("blocks `%s` as retired — the hint says drop the instruction, not break glass", (command) => {
    const message = blockedMessage({ command });
    expect([message.includes("are retired, so drop that instruction"), message.includes("has none yet")]).toEqual([
      true,
      false,
    ]);
  });

  it("keeps the process-wide override for a retired write, as for every raw class — every refusal keeps a hatch", () => {
    expect(classifyRawCommand({ allowRaw: true, command: "cmux workspace status set review" }).blocked).toBe(false);
  });

  it("leaves `workspace` subcommands other than status as ungoverned, not retired", () => {
    expect(blockedMessage({ command: "cmux workspace rename x" })).toContain("has none yet");
  });
});
