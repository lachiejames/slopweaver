import { describe, expect, it } from "vitest";

import { emitOnly } from "../../../../../../cli/commands/listen/emit.js";
import { type ListenDeps, runListenLoop } from "../../../../../../cli/commands/listen/loop.js";
import { harness, mentionFrame } from "./harness.js";

/**
 * `--follow`'s whole point at the loop level: `once: false` never exits after the first handled mention, so
 * a connection that hands over several tags keeps handling every one of them instead of stopping at the
 * first. This is exactly the existing `once: false` path — proven here with a JSON-emitting handler and
 * MULTIPLE mentions in one connection, which none of the pre-existing `once: false` cases exercised.
 */
describe("runListenLoop under once: false, with an emit-json handler", () => {
  it("emits one JSON line per mention across a connection, and never sends the --once close", async () => {
    const sinkLines: string[] = [];
    const fixture = harness({
      script: [
        [
          mentionFrame({ envelopeId: "e-1", eventId: "Ev1" }),
          mentionFrame({ envelopeId: "e-2", eventId: "Ev2", ts: "1785114460.557100" }),
        ],
      ],
    });
    const deps: ListenDeps = {
      ...fixture.deps,
      handler: emitOnly({ json: true, sink: ({ line }) => sinkLines.push(line) }),
    };

    await runListenLoop({ appToken: "xapp-app", deps, once: false });

    expect(sinkLines.length).toBe(2);
    expect(sinkLines.every((line) => JSON.parse(line).channel === "C0LISTEN")).toBe(true);
    expect(fixture.lines.some((line) => line.startsWith("--once:"))).toBe(false);
  });
});
