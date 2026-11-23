/** Why a paired tab that is not cold is handed over, a pure cold-seat guard driven directly. */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pairedNotColdReason, unclaimedTabReason } from "../../../../../../cli/commands/fleet/resumeCold.js";
import { makeHome } from "../fleetKit.js";

let home = "";

beforeEach(() => {
  home = makeHome();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("pairedNotColdReason", () => {
  it("hands over a paired bare shell nothing saved a session for, and one whose session runs elsewhere", () => {
    expect([pairedNotColdReason({ why: "no-saved-session" }), pairedNotColdReason({ why: "live-elsewhere" })]).toEqual([
      "no saved session",
      "its saved session is already live in another tab, so this bare shell may be a stale duplicate",
    ]);
  });

  it("hands over a lone unknown process holding a saved session, paired or unclaimed", () => {
    const named =
      "one childless process it does not know as a shell holds a saved session, so nothing was typed into it";
    expect([
      pairedNotColdReason({ why: "unrecognised-prompt" }),
      unclaimedTabReason({ verdict: { kind: "not-cold", why: "unrecognised-prompt" } }),
    ]).toEqual([named, named]);
  });

  it("hands over a tab with nothing running in it, paired or unclaimed", () => {
    const named =
      "nothing was running in it when read — its shell had not started or had exited — so nothing was typed";
    expect([
      pairedNotColdReason({ why: "no-process" }),
      unclaimedTabReason({ verdict: { kind: "not-cold", why: "no-process" } }),
    ]).toEqual([named, named]);
  });

  it("hands over neither a live seat nor a tab running another program", () => {
    expect([pairedNotColdReason({ why: "live-session" }), pairedNotColdReason({ why: "not-a-bare-shell" })]).toEqual([
      undefined,
      undefined,
    ]);
  });
});
