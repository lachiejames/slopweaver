/**
 * {@link decideTalkSeat} — the one route `talk offer` and the call widget's Plan left read share. Its ranking is
 * `codex/seatDecision.ts`'s and tested there; this holds down that a home whose register cannot be read is that
 * read's own failure, never a quiet fall back to the ambient Codex store.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrapErr } from "../../../lib/result.js";
import { absoluteTalkSeat, decideTalkSeat } from "../../../talk/talkSeat.js";

describe("decideTalkSeat", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "talk-seat-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses as an unreadable register on a home with no store", async () => {
    const routed = await decideTalkSeat({ home, nowIso: "2026-11-06T00:00:00.000Z" });
    expect(unwrapErr(routed).code).toBe("REGISTER_UNREADABLE");
  });
});

describe("absoluteTalkSeat", () => {
  it("resolves a relative routed home against the routing directory, so the launch names the same store", () => {
    const route = { destination: { alias: "codex-one", codexHome: "relative/store" }, why: "ranked first" };
    expect(absoluteTalkSeat({ cwd: "/work/offer", route })).toStrictEqual({
      destination: { alias: "codex-one", codexHome: "/work/offer/relative/store" },
      why: "ranked first",
    });
  });

  it("leaves an absolute routed home unchanged", () => {
    const route = { destination: { alias: "codex-one", codexHome: "/stores/codex-one" }, why: "ranked first" };
    expect(absoluteTalkSeat({ cwd: "/work/offer", route })).toBe(route);
  });
});
