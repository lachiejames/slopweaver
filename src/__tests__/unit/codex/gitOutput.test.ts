import { describe, expect, it } from "vitest";
import { asIoError, decodeStrict } from "../../../codex/gitOutput.js";

describe("asIoError", () => {
  it("names the bound a child was killed at, never an exit code it does not have", () => {
    const killed = Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT", signal: "SIGKILL" });

    const error = asIoError({ error: killed, label: "git worktree remove", timeoutMs: 10 * 60_000 });

    expect(error.message).toBe("git worktree remove timed out: still running after 10 minutes");
  });

  it("carries the exit code and stderr of an ordinary failure, with no status field for a ledger to misread", () => {
    const failed = Object.assign(new Error("Command failed"), { status: 128, stderr: Buffer.from("fatal: bad ref\n") });

    const error = asIoError({ error: failed, label: "git rev-parse", timeoutMs: 2 * 60_000 });

    expect(error.message).toBe("git rev-parse failed (exit 128): fatal: bad ref");
    expect(Object.keys(error)).toEqual([]);
  });

  it("passes a refused decode through unchanged", () => {
    const refusal = (() => {
      try {
        decodeStrict({ bytes: Buffer.from([0xff, 0xfe]), label: "git diff" });
      } catch (thrown: unknown) {
        return thrown as Error;
      }
      throw new Error("decodeStrict accepted invalid UTF-8");
    })();

    expect(asIoError({ error: refusal, label: "git diff", timeoutMs: 2 * 60_000 })).toBe(refusal);
  });
});

describe("decodeStrict", () => {
  it("decodes valid UTF-8, including a literal replacement character", () => {
    expect(decodeStrict({ bytes: Buffer.from("café �"), label: "git show" })).toBe("café �");
  });

  it("refuses malformed bytes rather than substituting for them", () => {
    expect(() => decodeStrict({ bytes: Buffer.from([0xc3, 0x28]), label: "git show" })).toThrow(
      "git show produced bytes that are not valid UTF-8",
    );
  });
});
