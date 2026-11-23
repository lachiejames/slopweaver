/**
 * `underCallFence` — the approval runs only on a fenced read matching the first, with no covered write announced,
 * and the fence is released on every path.
 */
import { describe, expect, it } from "vitest";

import { underCallFence } from "../../../../../cli/commands/slack/draftApproveFence.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";

const ANCHOR = "call:a0000041-0000-4000-8000-000000000044#s-1";

/**
 * Run the fence with the fenced read answering `fenced`, the recheck answering `announced`, and the fence refusing
 * when `refused` is set.
 *
 * @returns the exit code and every step taken, in order
 */
function fenceWith({
  announced,
  fenced,
  refused,
}: {
  announced?: string;
  fenced: Result<string>;
  refused?: string;
}): readonly [number, readonly string[]] {
  const steps: string[] = [];
  const code = underCallFence({
    anchor: ANCHOR,
    atIso: "2026-10-08T00:10:00.000Z",
    deps: {
      fenceCallWrites: () => {
        if (refused !== undefined) {
          return err(refused);
        }
        steps.push("fence");
        return ok({
          recheck: () => announced,
          release: () => {
            steps.push("release");
          },
        });
      },
    },
    first: "send it",
    home: "/nonexistent-home",
    read: () => {
      steps.push("read");
      return fenced;
    },
    run: (approval) => {
      steps.push(`run ${approval}`);
      return 0;
    },
  });
  return [code, steps];
}

describe("underCallFence", () => {
  it("runs the approval on a fenced read matching the first, then releases the fence", () => {
    expect(fenceWith({ fenced: ok("send it") })).toEqual([0, ["fence", "read", "run send it", "release"]]);
  });

  it("refuses before any read when the fence cannot be taken", () => {
    expect(fenceWith({ fenced: ok("send it"), refused: "the call could not be held still" })).toEqual([EXIT_USAGE, []]);
  });

  it("refuses, releasing the fence, a read that failed, changed, or ran while a covered write was announced", () => {
    expect([
      fenceWith({ fenced: err(["the call file does not read"]) }),
      fenceWith({ fenced: ok("send it, no wait") }),
      fenceWith({ announced: "1 transcript or landing write(s) were announced", fenced: ok("send it") }),
    ]).toEqual([
      [EXIT_USAGE, ["fence", "read", "release"]],
      [EXIT_USAGE, ["fence", "read", "release"]],
      [EXIT_USAGE, ["fence", "read", "release"]],
    ]);
  });
});
