/**
 * `drainStdio` over in-process `Writable`s: it settles only after every chunk written BEFORE it has been
 * flushed, and a stream that fails settles it rather than rejecting or throwing. The real-descriptor half —
 * a pipe, and `EPIPE` behind a closed reader — is `src/__tests__/subprocess/lib/drainStdio.test.ts`.
 */
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { drainStdio } from "../../../lib/drainStdio.js";

describe("drainStdio", () => {
  it("settles only once a chunk written before it has been flushed", async () => {
    const events: string[] = [];
    let flushFirst: () => void = () => undefined;
    const stream = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        const text = chunk.toString("utf8");
        if (text === "verdict") {
          // Held open until the test releases it, so the drain cannot settle ahead of it.
          flushFirst = () => {
            events.push("flushed verdict");
            callback();
          };
          return;
        }
        callback();
      },
    });

    stream.write("verdict");
    const drained = (async (): Promise<void> => {
      await drainStdio({ streams: [stream] });
      events.push("drained");
    })();
    // A whole event-loop turn, so a drain that did not wait for the held chunk would have settled by now.
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(events).toEqual([]);

    flushFirst();
    await drained;
    expect(events).toEqual(["flushed verdict", "drained"]);
  });

  it("settles rather than rejecting when the stream fails the write", async () => {
    const stream = new Writable({
      write: (_chunk, _encoding, callback) => {
        callback(new Error("write EPIPE"));
      },
    });

    await expect(drainStdio({ streams: [stream] })).resolves.toBe(undefined);
    expect(stream.destroyed).toBe(true);
  });
});
