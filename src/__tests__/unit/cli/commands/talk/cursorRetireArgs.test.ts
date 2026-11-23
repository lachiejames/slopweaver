/**
 * What `talk cursor-retire` accepts: a preview with no digest or reason, an apply with both, refused before any read.
 */
import { describe, expect, it } from "vitest";

import {
  CursorRetireArgsErrors,
  parseCursorRetireArgs,
  TALK_CURSOR_RETIRE_FLAG_NAMES,
} from "../../../../../cli/commands/talk/cursorRetireArgs.js";
import { unwrap } from "../../../../../lib/result.js";

const DIGEST = "ab".repeat(32);

describe("parseCursorRetireArgs", () => {
  it("previews the supervisor cursor in the ambient home by default", () => {
    expect(unwrap(parseCursorRetireArgs({ rest: [] }))).toEqual({
      apply: undefined,
      cursor: "supervisor",
      home: undefined,
      json: false,
    });
  });

  it("reads an apply with its digest, reason, cursor, home and --json", () => {
    const rest = ["--apply", "--source-sha256", DIGEST, "--reason", "rewritten", "--cursor", "voice"];
    expect(unwrap(parseCursorRetireArgs({ rest: [...rest, "--home", "/h", "--json"] }))).toEqual({
      apply: { reason: "rewritten", sourceSha256: DIGEST },
      cursor: "voice",
      home: "/h",
      json: true,
    });
  });

  it.each([
    ["no digest", ["--apply", "--reason", "rewritten"]],
    ["no reason", ["--apply", "--source-sha256", DIGEST]],
    ["a blank reason", ["--apply", "--source-sha256", DIGEST, "--reason", "  "]],
  ])("refuses an apply with %s", (_label, rest) => {
    expect(parseCursorRetireArgs({ rest })._unsafeUnwrapErr()).toEqual(CursorRetireArgsErrors.applyIncomplete());
  });

  it.each([
    ["a digest", ["--source-sha256", DIGEST]],
    ["a reason", ["--reason", "rewritten"]],
  ])("refuses %s on a preview, which would ignore it", (_label, rest) => {
    expect(parseCursorRetireArgs({ rest })._unsafeUnwrapErr()).toEqual(CursorRetireArgsErrors.applyOnly());
  });

  it("refuses a digest that is not 64 lowercase hex characters", () => {
    const rest = ["--apply", "--source-sha256", "ABC", "--reason", "rewritten"];
    expect(parseCursorRetireArgs({ rest })._unsafeUnwrapErr()).toEqual(
      CursorRetireArgsErrors.digestShape({ given: "ABC" }),
    );
  });

  it("refuses a positional and a flag it does not know", () => {
    expect(parseCursorRetireArgs({ rest: ["supervisor"] })._unsafeUnwrapErr().code).toBe("CURSOR_RETIRE_FLAGS_INVALID");
    expect(parseCursorRetireArgs({ rest: ["--force"] })._unsafeUnwrapErr().code).toBe("CURSOR_RETIRE_FLAGS_INVALID");
  });

  it("declares exactly the flags it parses", () => {
    expect(TALK_CURSOR_RETIRE_FLAG_NAMES).toEqual([
      "--apply",
      "--cursor",
      "--home",
      "--json",
      "--reason",
      "--source-sha256",
    ]);
  });
});
