/*
 * One in-process run's output collected for it alone: stdout whole through every logger door, stderr as a tail,
 * two scopes never crossing, and the real stream put back however the run ends.
 */
import { describe, expect, it } from "vitest";

import { logger, outExact } from "#lib/logger.js";
import { collectedErr, collectedOut, collectOutput } from "#lib/outputCollect.js";

describe("collectOutput", () => {
  it("collects stdout from logger.out and outExact, in order, and hands back the run's value", async () => {
    const ran = await collectOutput({
      keepErrChars: 100,
      run: async () => {
        logger.out({ line: "first" });
        outExact({ text: "second" });
        return 7;
      },
    });
    expect(ran).toEqual({ err: "", out: "first\nsecond", value: 7 });
  });

  it("collects what a run writes with process.stdout.write itself, a byte write's split character included", async () => {
    const euro = Buffer.from("€");
    const ran = await collectOutput({
      keepErrChars: 100,
      run: async () => {
        process.stdout.write("raw ");
        process.stdout.write(euro.subarray(0, 1));
        process.stdout.write(euro.subarray(1));
        logger.out({ line: " then logged" });
        return 0;
      },
    });
    expect(ran.out).toBe("raw € then logged\n");
  });

  it("puts process.stdout.write back once the run has finished", async () => {
    const before = process.stdout.write;
    await collectOutput({ keepErrChars: 100, run: async () => 0 });
    expect(process.stdout.write).toBe(before);
  });

  it("collects stderr written to the stream, and keeps only its tail", async () => {
    const ran = await collectOutput({
      keepErrChars: 6,
      run: async () => {
        process.stderr.write("abcdef");
        process.stderr.write(Buffer.from("ghi"));
        return 0;
      },
    });
    expect(ran.err).toBe("defghi");
  });

  it("fires a stderr write's callback, as the real stream would", async () => {
    let called = false;
    await collectOutput({
      keepErrChars: 100,
      run: async () => {
        await new Promise<void>((resolve) => {
          process.stderr.write("x", () => {
            called = true;
            resolve();
          });
        });
        return 0;
      },
    });
    expect(called).toBe(true);
  });

  it("keeps two scopes open at once apart", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = collectOutput({
      keepErrChars: 100,
      run: async () => {
        logger.out({ line: "a1" });
        await gate;
        logger.out({ line: "a2" });
        return 1;
      },
    });
    const second = collectOutput({
      keepErrChars: 100,
      run: async () => {
        logger.out({ line: "b1" });
        release();
        return 2;
      },
    });
    const [a, b] = await Promise.all([first, second]);
    expect([a.out, b.out]).toEqual(["a1\na2\n", "b1\n"]);
  });

  it("puts the stream back after a run that throws, and passes the throw on", async () => {
    const before = process.stderr.write;
    const beforeOut = process.stdout.write;
    const failing = collectOutput({
      keepErrChars: 100,
      run: async () => {
        throw new Error("boom");
      },
    });
    await expect(failing).rejects.toThrow("boom");
    expect(process.stderr.write).toBe(before);
    expect(process.stdout.write).toBe(beforeOut);
  });
});

describe("collectedOut and collectedErr outside every scope", () => {
  it("take nothing, so the caller writes to the real stream", () => {
    expect([collectedOut({ text: "x" }), collectedErr({ text: "y" })]).toEqual([false, false]);
  });
});
