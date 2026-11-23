/**
 * The Claude Code version readers: a transcript's newest record, `claude --version`'s output and the installed
 * directory's newest entry, all compared numerically and never as text.
 */
import { describe, expect, it } from "vitest";

import {
  compareClaudeCodeVersions,
  newestClaudeCodeVersion,
  parseClaudeVersionOutput,
  readClaudeCodeVersion,
} from "../../../claude/claudeCodeVersion.js";

describe("the version readers", () => {
  it("reads the newest top-level version in file order, skipping a torn first line", () => {
    const text = [
      'on":"2.1.279","type":"user"}',
      JSON.stringify({ type: "user", version: "2.1.279" }),
      JSON.stringify({ message: { version: "9.9.9" }, type: "assistant" }),
      JSON.stringify({ type: "assistant", version: "2.1.280" }),
    ].join("\n");

    expect(readClaudeCodeVersion({ text })).toStrictEqual({ kind: "measured", version: "2.1.280" });
  });

  it("is unmeasured when a record after the first is torn mid-write, never an older one", () => {
    const torn = [
      JSON.stringify({ type: "assistant", version: "2.1.280" }),
      '{"type":"assistant","version":"2.1.283"',
    ].join("\n");
    const healed = [torn, JSON.stringify({ type: "assistant", version: "2.1.283" }), ""].join("\n");

    expect(readClaudeCodeVersion({ text: torn })).toStrictEqual({
      kind: "unmeasured",
      why: "the newest transcript record is torn mid-write, so its Claude Code version is unread",
    });
    expect(readClaudeCodeVersion({ text: healed })).toStrictEqual({ kind: "measured", version: "2.1.283" });
  });

  it("is unmeasured when the newest record names a malformed version, never an older one", () => {
    const text = [
      JSON.stringify({ type: "user", version: "2.1.280" }),
      JSON.stringify({ type: "user", version: "2.1.284-beta.1" }),
    ].join("\n");

    expect(readClaudeCodeVersion({ text })).toStrictEqual({
      kind: "unmeasured",
      why: 'the newest transcript record names Claude Code "2.1.284-beta.1", outside the strict dotted shape',
    });
  });

  it("is unmeasured when no record names a version", () => {
    expect(readClaudeCodeVersion({ text: JSON.stringify({ type: "user" }) })).toStrictEqual({
      kind: "unmeasured",
      why: "no transcript record in what was read names a Claude Code version",
    });
  });

  it("compares numerically, part by part, never as text", () => {
    expect(compareClaudeCodeVersions({ left: "2.1.280", right: "2.1.283" })).toBe("before");
    expect(compareClaudeCodeVersions({ left: "2.1.99", right: "2.1.100" })).toBe("before");
    expect(compareClaudeCodeVersions({ left: "2.1.283", right: "2.1.283" })).toBe("equal");
    expect(compareClaudeCodeVersions({ left: "3.0.0", right: "2.9.999" })).toBe("after");
    expect(compareClaudeCodeVersions({ left: "2.1", right: "2.1.0" })).toBe("unmeasured");
  });

  it("never rounds a part past 2^53 into its neighbour", () => {
    expect(compareClaudeCodeVersions({ left: "2.1.9007199254740992", right: "2.1.9007199254740993" })).toBe("before");
  });

  it("picks the newest installed version from an unsorted listing, ignoring what is not one", () => {
    expect(newestClaudeCodeVersion({ names: ["2.1.281", ".DS_Store", "2.1.283", "2.1.280", "2.1.99"] })).toBe(
      "2.1.283",
    );
    expect(newestClaudeCodeVersion({ names: [".DS_Store"] })).toBe(undefined);
  });

  it("reads `claude --version` output, and names what it printed when it is not a version", () => {
    expect(parseClaudeVersionOutput({ output: "2.1.283 (Claude Code)\n" })).toStrictEqual({
      kind: "measured",
      version: "2.1.283",
    });
    expect(parseClaudeVersionOutput({ output: "command not found" })).toStrictEqual({
      kind: "unmeasured",
      why: '`claude --version` printed no version ("command not found")',
    });
  });
});
