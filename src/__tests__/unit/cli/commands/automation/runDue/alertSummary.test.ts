/**
 * `slopweaver automation run-due` over an `alert-summary` row: a read that composes the card and a door-routed
 * post, where that post lands, and every refusal and failure that posts nothing.
 */
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../../../lib/result.js";
import {
  readRecipeDefinitionRuns,
  recordRecipeDefinitionRun,
} from "../../../../../../live/automation/definitionRunStore.js";
import { defaultIntro, introFlagArgs } from "../../../../../../live/automation/firstFiring.js";
import { slotDeliveryKey } from "../../../../../../live/automation/slotLedger.js";
import { runDueUnderFake } from "../../../../../runDueSignalFake.js";
import { alertRow, argvFor, firingAt, PROMPT_CHANNEL, READ_FORM } from "./fixtures.js";
import { deps, homeWith, removeHomes } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("recipe run-due", () => {
  it("runs an alert-summary row as a read that composes the card and a door-routed post", async () => {
    const home = homeWith({ rows: [alertRow()] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(0);
    expect(injected.reads).toEqual([
      [
        "--channel",
        "C0ALERTS",
        "--window",
        "24h",
        "--label",
        "Knock alerts",
        ...introFlagArgs({ intro: defaultIntro({ cadence: "0 * * * *" }) }),
        "--home",
        home,
        "--form",
      ],
    ]);
    expect(injected.dispatched).toEqual([
      [
        "node",
        "slopweaver",
        "slack",
        "post",
        "--as",
        "bot",
        "--channel",
        PROMPT_CHANNEL,
        "--form",
        READ_FORM,
        "--home",
        home,
        "--idempotency-key",
        slotDeliveryKey({
          recipeId: "knock-alerts",
          slotIso: firingAt({ cadence: "0 * * * *", nowIso: "2026-09-08T12:05:00.000Z" }),
        }),
        "--dm-purpose",
        "investigation-finding",
      ],
    ]);
    expect(injected.out).toContain(
      `recipe knock-alerts · ran · slack alert-summary --channel C0ALERTS → slack post --as bot --channel ${PROMPT_CHANNEL} · exit 0`,
    );
  });

  it("READS the team channel and posts the card into the owner's DM, which is the whole shape of the standing rule", async () => {
    const home = homeWith({ rows: [alertRow()] });
    const injected = deps();
    await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(injected.reads[0]![1]).toBe("C0ALERTS");
    expect(injected.dispatched[0]![7]).toBe(PROMPT_CHANNEL);
  });

  it("REFUSES a row aiming its card at a channel it carries no approval for, and posts nothing", async () => {
    const home = homeWith({ rows: [alertRow({ params: { channel: "C0ALERTS", postTo: "C0TEAM" } })] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.dispatched).toEqual([]);
    expect(injected.reads).toEqual([]);
    expect(injected.out.some((line) => line.includes("REFUSED") && line.includes("aims its card at C0TEAM"))).toBe(
      true,
    );
  });

  it("posts into the channel once the owner's approval for it is recorded on the row", async () => {
    const approved = {
      ...alertRow({ params: { channel: "C0ALERTS", postTo: "C0TEAM" } }),
      channelApprovals: [
        { atIso: "2026-09-21T04:00:00.000Z", channel: "C0TEAM", dmChannel: PROMPT_CHANNEL, ts: "1789800000.000100" },
      ],
    };
    const home = homeWith({ rows: [approved] });
    const injected = deps();
    await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(injected.dispatched[0]![7]).toBe("C0TEAM");
  });

  it("opens no day-one intro once a firing of the row has settled", async () => {
    const home = homeWith({ rows: [alertRow()] });
    const path = join(home, "live", "recipe", "definition-runs.json");
    unwrap(
      recordRecipeDefinitionRun({
        home,
        nowIso: "2026-09-08T10:00:04.000Z",
        path,
        recipeId: "knock-alerts",
        run: { exitCode: 0, lastRunAtIso: "2026-09-08T10:00:04.000Z", watermarkIso: "2026-09-08T10:00:00.000Z" },
      }),
    );
    const injected = deps();
    await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(injected.reads).toEqual([
      ["--channel", "C0ALERTS", "--window", "24h", "--label", "Knock alerts", "--home", home, "--form"],
    ]);
  });

  it("carries the row's own lead sentence into the read that validates it", async () => {
    const home = homeWith({
      rows: [alertRow({ params: { channel: "C0ALERTS", lead: "Two monitors carried the whole window." } })],
    });
    const injected = deps();
    await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(injected.reads[0]).toContain("--lead");
    expect(injected.reads[0]).toContain("Two monitors carried the whole window.");
  });

  it("renders an alert-summary card through the real send path under --dry-run, and stamps nothing", async () => {
    const home = homeWith({ rows: [alertRow()] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home, tail: ["--dry-run"] }), deps: injected });
    expect(code).toBe(0);
    expect(injected.reads.length).toBe(1);
    expect(injected.dispatched[0]!.at(-1)).toBe("--dry-run");
    expect(injected.out).toContain(
      `recipe knock-alerts · would post · slack alert-summary --channel C0ALERTS → slack post --as bot --channel ${PROMPT_CHANNEL} --dry-run · exit 0`,
    );
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs).toEqual({});
  });

  it("posts nothing and stamps nothing when the alert-summary read leg fails", async () => {
    const home = homeWith({ rows: [alertRow()] });
    const injected = deps({ readExitCode: 1 });
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.dispatched).toEqual([]);
    expect(injected.out.some((line) => line.includes("READ FAILED") && line.includes("nothing was posted"))).toBe(true);
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs).toEqual({});
  });

  it("refuses a read-only alert-summary row before it reads anything", async () => {
    const home = homeWith({ rows: [alertRow({ effect: "read" })] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.reads).toEqual([]);
    expect(injected.dispatched).toEqual([]);
    expect(injected.out.some((line) => line.includes("REFUSED") && line.includes("POSTS the card it builds"))).toBe(
      true,
    );
  });

  it("refuses an alert-summary row that names no channel", async () => {
    const home = homeWith({ rows: [alertRow({ params: { window: "24h" } })] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.reads).toEqual([]);
    expect(injected.out.some((line) => line.includes("not a runnable alert-summary row"))).toBe(true);
  });

  it("posts nothing when the read leg emits anything other than exactly one document", async () => {
    const home = homeWith({ rows: [alertRow()] });
    const injected = deps({ readLines: ["reading C0ALERTS: page 1", READ_FORM] });
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.dispatched).toEqual([]);
    expect(injected.out.some((line) => line.includes("emitted 2 document(s) on stdout, expected exactly 1"))).toBe(
      true,
    );
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs).toEqual({});
  });
});
