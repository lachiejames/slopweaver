/**
 * `AtlasCommandErrors` and `atlasCommandErrorLines` — the typed failures the top of the `atlas` noun authors,
 * and the one-line-per-problem printing every runner here does with them.
 */
import { describe, expect, it } from "vitest";

import { AtlasCommandErrors, atlasCommandErrorLines } from "../../../../../cli/commands/atlas/errors.js";

describe("AtlasCommandErrors", () => {
  it("names the expected confirmation word and what was typed instead", () => {
    const error = AtlasCommandErrors.confirmMismatch({ confirm: "archiv", expected: "archive" });

    expect(error).toEqual({
      code: "CONFIRM_MISMATCH",
      confirm: "archiv",
      expected: "archive",
      message: '--confirm must be exactly "archive", not "archiv"',
    });
  });

  it("tells a reset with no confirmation that it replaces the live generation with an empty one", () => {
    const error = AtlasCommandErrors.resetEmptyConfirmRequired({ word: "archive" });

    expect(error.code).toBe("RESET_EMPTY_CONFIRM_REQUIRED");
    expect(error.message).toBe("reset needs --confirm archive: it replaces the current generation with an empty one");
  });

  it("says a HARD reset archives before it installs, and how to confirm it", () => {
    const error = AtlasCommandErrors.resetConfirmRequired();

    expect(error.code).toBe("RESET_CONFIRM_REQUIRED");
    expect(error.message).toBe(
      "reset is a HARD reset: it archives the current generation and installs an empty one in its place. Re-run with --confirm archive; the success line prints the exact command that restores what it archived, before any sync is needed",
    );
  });

  it("carries what a read threw after the path it could not read", () => {
    const error = AtlasCommandErrors.walkDocumentUnreadable({ cause: new Error("ENOENT"), path: "/tmp/walk.json" });

    expect(error.message).toBe("/tmp/walk.json could not be read: ENOENT");
  });

  it("stringifies a thrown value that is not an Error when a screenshot cannot be read", () => {
    const error = AtlasCommandErrors.screenshotUnreadable({ cause: "disk gone", path: "/admin/settings" });

    expect(error.message).toBe("could not read the screenshot for /admin/settings: disk gone");
  });

  it("names the Chrome pin's own sentence and nothing else", () => {
    const error = AtlasCommandErrors.chromePinUnresolved({ detail: "no work profile is pinned" });

    expect(error).toEqual({
      code: "CHROME_PIN_UNRESOLVED",
      detail: "no work profile is pinned",
      message: "no work profile is pinned",
    });
  });
});

describe("atlasCommandErrorLines", () => {
  it("prints a walk document's problems one per line, then says nothing was published", () => {
    const error = AtlasCommandErrors.walkDocumentInvalid({ problems: ["pages[0].path is missing", "bad workspace"] });

    expect(atlasCommandErrorLines({ error })).toEqual([
      "pages[0].path is missing",
      "bad workspace",
      "nothing was published — a surface is not filled by a document that will not parse",
    ]);
    expect(error.message).toBe(
      "pages[0].path is missing; bad workspace; nothing was published — a surface is not filled by a document that will not parse",
    );
  });

  it("closes an unavailable SDK with the install remedy on its own line", () => {
    const error = AtlasCommandErrors.sdkTypingsUnavailable({
      problems: ["cannot read the installed @slack/web-api typings: ENOENT"],
    });

    expect(atlasCommandErrorLines({ error })).toEqual([
      "cannot read the installed @slack/web-api typings: ENOENT",
      "run `yarn install` — the API surface is read from the installed SDK, never a stored list",
    ]);
  });

  it("puts the usage after every flag problem a Linear sync was refused for", () => {
    const error = AtlasCommandErrors.linearPlanInvalid({
      problems: ["unknown flag: --nope"],
      usage: "usage: slopweaver atlas linear sync",
    });

    expect(atlasCommandErrorLines({ error })).toEqual(["unknown flag: --nope", "usage: slopweaver atlas linear sync"]);
  });

  it("passes a verified writer's own lines through unchanged", () => {
    const error = AtlasCommandErrors.artifactWriteFailed({ reasons: ["read-back digest differs"] });

    expect(atlasCommandErrorLines({ error })).toEqual(["read-back digest differs"]);
  });

  it("prints a single-sentence failure as its message", () => {
    const error = AtlasCommandErrors.readLimitInvalid({ max: 1000, min: 1, raw: "0" });

    expect(atlasCommandErrorLines({ error })).toEqual(["--limit must be a whole number from 1 to 1000, got: 0"]);
  });
});
