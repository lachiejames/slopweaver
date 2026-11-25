import { describe, expect, it } from "vitest";

import { installedPathOf } from "../../../codexPlugin/syncEffects.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("installedPathOf", () => {
  it("reads where Codex says it installed", () => {
    const run = { status: 0, stderr: "", stdout: JSON.stringify({ installedPath: "/c/cache", version: "local" }) };
    expect(unwrap(installedPathOf({ run }))).toBe("/c/cache");
  });

  it("names a failed add by its first stderr line, or its exit when stderr is empty", () => {
    expect(unwrapErr(installedPathOf({ run: { status: 1, stderr: "error: one\ntwo\n", stdout: "" } })).message).toBe(
      "codex plugin add failed: error: one",
    );
    expect(unwrapErr(installedPathOf({ run: { status: 7, stderr: "", stdout: "" } })).message).toBe(
      "codex plugin add failed: exit 7",
    );
  });

  it("refuses output that is not JSON, and JSON naming no installed path", () => {
    expect(unwrapErr(installedPathOf({ run: { status: 0, stderr: "", stdout: "nope" } })).code).toBe("ADD_FAILED");
    expect(unwrapErr(installedPathOf({ run: { status: 0, stderr: "", stdout: "{}" } })).message).toBe(
      "codex plugin add failed: the --json output names no installedPath",
    );
  });
});
