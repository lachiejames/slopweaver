/*
 * `classifyRawCommand` on a shell wrapper's `-c` payload: the payload is re-split and classified, nested wrappers
 * included, while a harmless payload, an interactive shell and an empty `-c` pass.
 */
import { describe, expect, it } from "vitest";

import { classifyRawCommand } from "../../../../admit/rawTools.js";

describe("a command hidden inside a shell wrapper's -c payload", () => {
  // The payload is one quoted argument the splitter deliberately never cuts, and nothing ever read it, so
  // the most obvious way to spell "run this anyway" was the one shape that worked.
  const external = ["c", "u", "r", "l"].join("");
  const shell = ["b", "a", "s", "h"].join("");

  it("blocks a wrapped external call", () => {
    expect(classifyRawCommand({ allowRaw: false, command: `${shell} -c '${external} https://x'` }).blocked).toBe(true);
  });

  it("blocks a wrapped COMPOUND line, because the payload is re-split rather than token-matched", () => {
    expect(classifyRawCommand({ allowRaw: false, command: `sh -c "cd /tmp && ${external} https://x"` }).blocked).toBe(
      true,
    );
  });

  it("blocks a wrapper nested inside another wrapper", () => {
    expect(
      classifyRawCommand({ allowRaw: false, command: `${shell} -c "${shell} -c '${external} https://x'"` }).blocked,
    ).toBe(true);
  });

  it("leaves a harmless payload alone", () => {
    expect(classifyRawCommand({ allowRaw: false, command: `${shell} -c 'echo hello'` }).blocked).toBe(false);
  });

  it("leaves an interactive shell alone", () => {
    expect(classifyRawCommand({ allowRaw: false, command: shell }).blocked).toBe(false);
  });

  it("leaves a -c with nothing after it alone", () => {
    expect(classifyRawCommand({ allowRaw: false, command: `${shell} -c` }).blocked).toBe(false);
  });

  it("is waved through by the process-wide break-glass, like every other blocked shape", () => {
    expect(classifyRawCommand({ allowRaw: true, command: `${shell} -c '${external} https://x'` }).blocked).toBe(false);
  });
});
