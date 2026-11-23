/**
 * "Since you last looked" on the Automations page: only breaks after the mark count, the mark's own instant does
 * not, and a mark that is not a time counts nothing rather than every failure on disk.
 */
import { describe, expect, it } from "vitest";

import { breaksSince } from "../../lib/automationsLooked";

const BREAKS = ["2026-10-03T04:00:00.000Z", "2026-10-02T22:00:00.000Z", "2026-10-01T10:00:00.000Z"];

describe("breaksSince", () => {
  it("counts only the breaks after the mark", () => {
    expect(breaksSince({ brokeAtIsos: BREAKS, lookedIso: "2026-10-02T12:00:00.000Z" })).toBe(2);
  });

  it("does not count a break at the mark's own instant", () => {
    expect(breaksSince({ brokeAtIsos: BREAKS, lookedIso: "2026-10-03T04:00:00.000Z" })).toBe(0);
  });

  it("counts nothing for a row with no breaks", () => {
    expect(breaksSince({ brokeAtIsos: [], lookedIso: "2026-10-01T00:00:00.000Z" })).toBe(0);
  });

  it("counts nothing for a mark that is not a time", () => {
    expect(breaksSince({ brokeAtIsos: BREAKS, lookedIso: "yesterday" })).toBe(0);
  });
});
