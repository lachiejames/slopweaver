/**
 * `profile voice`'s three shapes — read, import, measure — and the tails each refuses.
 */
import { describe, expect, it } from "vitest";

import { parseProfileVoiceArgs } from "../../../../../cli/commands/profile/voiceArgs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseProfileVoiceArgs", () => {
  it("reads the register on a bare tail", () => {
    expect(unwrap(parseProfileVoiceArgs({ rest: [] }))).toStrictEqual({ json: false, kind: "read" });
    expect(unwrap(parseProfileVoiceArgs({ rest: ["--json"] }))).toStrictEqual({ json: true, kind: "read" });
  });

  it("imports when --file names a path", () => {
    expect(unwrap(parseProfileVoiceArgs({ rest: ["--file", "c.json"] }))).toStrictEqual({
      file: "c.json",
      json: false,
      kind: "import",
    });
  });

  it("refuses an empty --file", () => {
    expect(unwrapErr(parseProfileVoiceArgs({ rest: ["--file", ""] }))).toStrictEqual(["--file <path> is required"]);
  });

  it("measures, defaulting to a write against the environment's home", () => {
    expect(unwrap(parseProfileVoiceArgs({ rest: ["measure"] }))).toStrictEqual({
      dryRun: false,
      home: undefined,
      json: false,
      kind: "measure",
    });
  });

  it("measures with every flag it takes", () => {
    expect(unwrap(parseProfileVoiceArgs({ rest: ["measure", "--dry-run", "--json", "--home", "/h"] }))).toStrictEqual({
      dryRun: true,
      home: "/h",
      json: true,
      kind: "measure",
    });
  });

  it("refuses --file on measure, --dry-run on a read, and an unknown subverb", () => {
    expect(unwrapErr(parseProfileVoiceArgs({ rest: ["measure", "--file", "c.json"] })).join(" ")).toContain("file");
    expect(unwrapErr(parseProfileVoiceArgs({ rest: ["--dry-run"] })).join(" ")).toContain("dry-run");
    expect(unwrapErr(parseProfileVoiceArgs({ rest: ["set"] })).join(" ")).toContain("set");
  });
});
