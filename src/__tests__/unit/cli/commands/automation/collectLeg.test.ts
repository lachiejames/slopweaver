/**
 * `teeLeg` and `collectLeg` — an in-process recipe leg's stderr is this process's stderr, so the tee is the only
 * thing that keeps a leg's reason; a leg that THROWS after writing it must not lose it to the bare exception message.
 */
import { describe, expect, it } from "vitest";

import { collectLeg, teeLeg } from "../../../../../cli/commands/automation/collectLeg.js";

describe("teeLeg", () => {
  it("hands back the leg's value and what it wrote to stderr", async () => {
    const teed = await teeLeg({
      run: () => {
        process.stderr.write("leg: warming up\n");
        return Promise.resolve(7);
      },
    });
    expect(teed).toEqual({ text: "leg: warming up\n", value: 7 });
  });

  it("rethrows a leg that threw with its stderr tail closing the message, the original as its cause", async () => {
    const original = new Error("socket closed");
    const thrown = await teeLeg({
      run: () => {
        process.stderr.write("slack read: connection reset\n");
        return Promise.reject(original);
      },
    }).then(
      () => new Error("the leg resolved"),
      (error: unknown) => error as Error,
    );
    expect(thrown.message).toBe("socket closed · why: slack read: connection reset");
    expect(thrown.cause).toBe(original);
  });

  it("rethrows a leg that threw before writing anything with only its own message", async () => {
    const thrown = await teeLeg({ run: () => Promise.reject(new Error("socket closed")) }).then(
      () => new Error("the leg resolved"),
      (error: unknown) => error as Error,
    );
    expect(thrown.message).toBe("socket closed");
  });
});

describe("collectLeg", () => {
  it("collects the leg's stdout lines beside its exit and its stderr tail", async () => {
    const collected = await collectLeg({
      run: ({ writeOut }) => {
        writeOut('{"kind":"form"}');
        process.stderr.write("read: 1 document\n");
        return Promise.resolve(0);
      },
    });
    expect(collected).toEqual({ diagnostics: "read: 1 document\n", exitCode: 0, lines: ['{"kind":"form"}'] });
  });
});
