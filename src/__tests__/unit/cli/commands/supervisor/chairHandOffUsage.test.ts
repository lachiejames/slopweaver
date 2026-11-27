/**
 * `supervisor hand-off`'s usage text: it opens on the verb's own line, and names the note verb the outgoing chair
 * runs, which is what that chair reads before recording its note.
 */
import { describe, expect, it } from "vitest";

import { CHAIR_HAND_OFF_USAGE } from "../../../../../cli/commands/supervisor/chairHandOffUsage.js";

describe("supervisor hand-off usage", () => {
  it("opens on the verb's own line", () => {
    expect(CHAIR_HAND_OFF_USAGE.split("\n")[0]).toBe(
      'usage: slopweaver supervisor hand-off [--home <dir>] [--plan <alias>] [--now --reason "<why>"] [--note-wait <seconds>]',
    );
  });

  it("names the note verb the outgoing chair runs", () => {
    expect(CHAIR_HAND_OFF_USAGE.split("\n")[2]).toBe(
      "       slopweaver supervisor hand-off note --episode <id> --file <path> [--home <dir>]",
    );
  });
});
