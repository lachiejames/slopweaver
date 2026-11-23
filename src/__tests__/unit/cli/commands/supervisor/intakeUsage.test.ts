/**
 * The intake verbs' usage text: each opens on its own verb, and intake-mark's says that a mark on a voice relay
 * settles the relay's own row, which is what a chair reading `--help` needs before marking one.
 */
import { describe, expect, it } from "vitest";

import { INTAKE_USAGE, MARK_USAGE } from "../../../../../cli/commands/supervisor/intakeUsage.js";

describe("intake usage", () => {
  it("opens each usage on its own verb", () => {
    expect([
      INTAKE_USAGE.startsWith("usage: slopweaver supervisor intake ["),
      MARK_USAGE.startsWith("usage: slopweaver supervisor intake-mark --turn"),
    ]).toEqual([true, true]);
  });

  it("says a mark on a talk pointer settles the relay's own row", () => {
    expect(MARK_USAGE).toContain(
      "On a talk:<turnId> pointer the relay's own row is settled too: filed into a card's row slug, else answered.",
    );
  });
});
