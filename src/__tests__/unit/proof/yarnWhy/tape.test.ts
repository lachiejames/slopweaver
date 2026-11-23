/**
 * The VHS tape builder and its frame picker — asserted on the properties measured live against `vhs`
 * 0.11.0 that are the reason this path replaced the AppleScript one (see `tape.ts`'s own doc): the tape
 * opens no window, waits for a REAL completion rather than sleeping a guess, records frames rather than
 * relying on VHS's flaky deferred `Screenshot`, and REFUSES anything it cannot carry instead of writing a
 * mangled tape.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { yarnWhyErrorLines } from "../../../../proof/yarnWhy/errors.js";
import { buildCaptureTape, isPackageName, isTapeStringSafe, lastTextFrame } from "../../../../proof/yarnWhy/tape.js";

const FRAMES = "/var/folders/2g/T/slopweaver-golden-proof-abc/before-frames";

describe("isTapeStringSafe", () => {
  it("accepts a real temp path, punctuation and all", () => {
    expect(isTapeStringSafe({ value: "/var/folders/2g/5d+kp 6y/T/frames" })).toBe(true);
  });

  it("rejects a double quote, which would end the tape's own string", () => {
    expect(isTapeStringSafe({ value: '/tmp/a"b' })).toBe(false);
  });

  it("rejects a backslash, which VHS does not honour as an escape", () => {
    expect(isTapeStringSafe({ value: "/tmp/a\\b" })).toBe(false);
  });

  it("rejects a newline, which would end the tape's own line", () => {
    expect(isTapeStringSafe({ value: "/tmp/a\nEnter\nb" })).toBe(false);
  });

  it("rejects an empty value", () => {
    expect(isTapeStringSafe({ value: "" })).toBe(false);
  });
});

describe("isPackageName", () => {
  it("accepts a plain package name", () => {
    expect(isPackageName({ value: "neverthrow" })).toBe(true);
  });

  it("accepts a scoped package name", () => {
    expect(isPackageName({ value: "@datadog/datadog-api-client" })).toBe(true);
  });

  it("rejects a shell separator that would run a second command in the pty", () => {
    expect(isPackageName({ value: "left-pad; rm -rf /" })).toBe(false);
  });

  it("rejects a command substitution", () => {
    expect(isPackageName({ value: "$(whoami)" })).toBe(false);
  });
});

describe("lastTextFrame", () => {
  it("picks the highest-numbered terminal frame", () => {
    expect(lastTextFrame({ names: ["frame-text-00003.png", "frame-text-00001.png", "frame-text-00002.png"] })).toBe(
      "frame-text-00003.png",
    );
  });

  it("ignores the cursor frames VHS writes beside the terminal ones", () => {
    expect(lastTextFrame({ names: ["frame-text-00001.png", "frame-cursor-00009.png"] })).toBe("frame-text-00001.png");
  });

  it("orders by frame NUMBER, not by name, so a five-digit rollover still picks the last", () => {
    expect(lastTextFrame({ names: ["frame-text-99999.png", "frame-text-100000.png"] })).toBe("frame-text-100000.png");
  });

  it("returns undefined when the recording produced no terminal frames", () => {
    expect(lastTextFrame({ names: [] })).toBe(undefined);
  });
});

describe("buildCaptureTape", () => {
  const tape = unwrap(buildCaptureTape({ dependency: "@datadog/datadog-api-client", framesDir: FRAMES }));

  it("runs yarn why against the given dependency", () => {
    expect(tape).toContain(`Type "yarn why @datadog/datadog-api-client"`);
  });

  it("records frames into the given directory rather than using VHS's deferred Screenshot", () => {
    expect(tape).toContain(`Output "${FRAMES}/"`);
    expect(tape).not.toContain("Screenshot");
  });

  it("waits for a real completion signal rather than sleeping a guess for the command", () => {
    expect(tape).toContain("Set WaitTimeout 120s");
    expect(tape.split("\n").filter((line) => line === "Wait").length).toBe(2);
  });

  it("holds the settled output on camera, so the last frame is never a mid-redraw one", () => {
    const lines = tape.split("\n");
    expect(lines.at(-2)).toBe("Sleep 1s");
    expect(lines.at(-3)).toBe("Wait");
  });

  it("hides the setup command from the recording and shows the real one", () => {
    const lines = tape.split("\n");
    expect(lines.indexOf("Hide")).toBeLessThan(lines.indexOf(`Type "clear"`));
    expect(lines.indexOf("Show")).toBeLessThan(lines.indexOf(`Type "yarn why @datadog/datadog-api-client"`));
  });

  it("carries no worktree path — the pty inherits it from VHS's own cwd", () => {
    expect(tape).not.toContain("cd ");
  });

  it("refuses a dependency that is not a package name, rather than typing it", () => {
    const result = buildCaptureTape({ dependency: "left-pad && curl evil", framesDir: FRAMES });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("INPUT_REFUSED");
    expect(yarnWhyErrorLines({ error: unwrapErr(result) })).toEqual([
      "not a package name, so it will not be typed: left-pad && curl evil",
    ]);
  });

  it("refuses a relative frames directory, which VHS would resolve against its own cwd", () => {
    const result = buildCaptureTape({ dependency: "neverthrow", framesDir: "before-frames" });

    expect(result.isErr()).toBe(true);
    expect(yarnWhyErrorLines({ error: unwrapErr(result) })).toEqual([
      "frames directory must be absolute, got before-frames",
    ]);
  });

  it("reports every refusal at once when both inputs are wrong", () => {
    const result = buildCaptureTape({ dependency: "a b", framesDir: 'x"y' });

    expect(yarnWhyErrorLines({ error: unwrapErr(result) })).toEqual([
      "not a package name, so it will not be typed: a b",
      'frames directory must be absolute, got x"y',
      'frames directory cannot be written into a VHS tape: x"y',
    ]);
  });
});
