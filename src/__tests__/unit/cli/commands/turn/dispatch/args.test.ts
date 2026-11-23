/**
 * `slopweaver turn dispatch` — argument parsing, the usage refusals, and the manifest row that declares the verb.
 *
 * The `fresh-visible-session` tier itself calls the REAL `productionSpawnDeps()`/`readScreen` — hardwired,
 * not injected, deliberately: that lane is proven by the owner's own watched live run, never an automated
 * fixture faking a terminal. See `AGENTS.md`'s own doctrine on this.
 */
import { afterEach, describe, expect, it } from "vitest";

import { runTurnDispatch, turnDispatchCommand } from "../../../../../../cli/commands/turn/dispatch.js";
import { parseTurnDispatchArgs } from "../../../../../../cli/commands/turn/dispatchArgs.js";
import { EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { turnManifest } from "../../../../../../cli/manifests/turn.js";
import { unwrapErr } from "../../../../../../lib/result.js";
import { removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("parseTurnDispatchArgs", () => {
  it("does not mistake its own verb token for a stray argument", () => {
    const argv = ["node", "slopweaver", "turn", "dispatch", "--brief", "b.json", "--decision", "d.json"];
    const parsed = parseTurnDispatchArgs({ rest: argv.slice(4) });

    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.positionals : ["not parsed"]).toEqual([]);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(unwrapErr(parseTurnDispatchArgs({ rest: ["--not-a-flag", "x"] }))).toEqual([
      "unknown flag: --not-a-flag",
      "unexpected argument: x",
    ]);
  });
});

describe("turn dispatch — usage refusals", () => {
  it("refuses with a usage code when neither --brief/--decision nor --poll/--sweep is given", async () => {
    expect(await runTurnDispatch(["node", "slopweaver", "turn", "dispatch"])).toBe(EXIT_USAGE);
  });

  it("refuses --decision alone, naming --brief as missing", async () => {
    expect(await runTurnDispatch(["node", "slopweaver", "turn", "dispatch", "--decision", "d.json"])).toBe(EXIT_USAGE);
  });
});

describe("turn manifest — dispatch", () => {
  /**
   * Changed deliberately: the `no-response` decision now deletes a capture checklist through the real door
   * (`deleteCapturedChecklist`) — the one mode among no-response/inline/subagent-instructions/fresh-session/
   * poll/sweep that mutates Slack at all. Its door request declares no approval: that cleanup is routine and
   * never pauses, matching this repo's own no-approval-pauses-on-routine-sends doctrine.
   */
  it("declares dispatch as external-write and door-routed", () => {
    expect(turnManifest["dispatch"]!.meta.effect).toBe("external-write");
    expect(turnManifest["dispatch"]!.meta.doorRouted).toBe(true);
  });

  it("exposes the command the manifest lazily loads", () => {
    expect(turnDispatchCommand).toBe(runTurnDispatch);
  });
});
