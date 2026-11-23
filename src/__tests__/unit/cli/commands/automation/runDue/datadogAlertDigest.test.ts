/**
 * `slopweaver automation run-due` over a `datadog-alert-digest` row: a probe read that composes the card and a
 * door-routed post, a row aiming at a team channel, and every refusal and failure that posts nothing.
 */
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../../../lib/result.js";
import { readRecipeDefinitionRuns } from "../../../../../../live/automation/definitionRunStore.js";
import { defaultIntro, introFlagArgs } from "../../../../../../live/automation/firstFiring.js";
import { slotDeliveryKey } from "../../../../../../live/automation/slotLedger.js";
import { runDueUnderFake } from "../../../../../runDueSignalFake.js";
import { argvFor, DIGEST_FORM, digestRow, firingAt, PROMPT_CHANNEL } from "./fixtures.js";
import { deps, homeWith, removeHomes } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("recipe run-due", () => {
  it("runs a datadog-alert-digest row as a probe read that composes the card and a door-routed post", async () => {
    const home = homeWith({ rows: [digestRow()] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(0);
    expect(injected.digestReads).toEqual([
      [
        "--probes",
        '{"probes":[{"id":"sends","kind":"logs-count","query":"service:example-api status:error","severityWhenFiring":"orange","title":"send failures","why":"the outer send catch"}]}',
        "--label",
        "Knock",
        "--window",
        "24h",
        ...introFlagArgs({ intro: defaultIntro({ cadence: "30 12 * * *" }) }),
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
        DIGEST_FORM,
        "--home",
        home,
        "--idempotency-key",
        slotDeliveryKey({
          recipeId: "knock-alerts-digest",
          slotIso: firingAt({ cadence: "30 12 * * *", nowIso: "2026-09-08T12:05:00.000Z" }),
        }),
        "--dm-purpose",
        "investigation-finding",
      ],
    ]);
    expect(injected.out).toContain(
      `recipe knock-alerts-digest · ran · datadog alert-digest --label Knock → slack post --as bot --channel ${PROMPT_CHANNEL} · exit 0`,
    );
  });

  it("carries a digest row's own lead sentence into the probe read", async () => {
    const home = homeWith({
      rows: [
        digestRow({ params: { channel: PROMPT_CHANNEL, label: "Knock", lead: "first post since 2 sep.", probes: [] } }),
      ],
    });
    const injected = deps();
    await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(injected.digestReads[0]).toContain("--lead");
    expect(injected.digestReads[0]).toContain("first post since 2 sep.");
  });

  it("posts nothing and stamps nothing when the digest probe read fails", async () => {
    const home = homeWith({ rows: [digestRow()] });
    const injected = deps({ digestReadExitCode: 1 });
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.dispatched).toEqual([]);
    expect(injected.out.some((line) => line.includes("READ FAILED") && line.includes("nothing was posted"))).toBe(true);
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs).toEqual({});
  });

  it("posts nothing when the digest read emits anything other than exactly one document", async () => {
    const home = homeWith({ rows: [digestRow()] });
    const injected = deps({ digestReadLines: ["probe 1 of 5", DIGEST_FORM] });
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.dispatched).toEqual([]);
    expect(injected.out.some((line) => line.includes("emitted 2 document(s) on stdout"))).toBe(true);
  });

  it("REFUSES a digest row aiming at a team channel, before it counts anything", async () => {
    const home = homeWith({ rows: [digestRow({ params: { channel: "C0TEAM", label: "Knock", probes: [] } })] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.digestReads).toEqual([]);
    expect(injected.dispatched).toEqual([]);
    expect(injected.out.some((line) => line.includes("REFUSED") && line.includes("aims its card at C0TEAM"))).toBe(
      true,
    );
  });

  it("posts a digest into the team channel once the owner's approval for it is recorded on the row", async () => {
    const approved = {
      ...digestRow({ params: { channel: "C0TEAM", label: "Knock", probes: [] } }),
      channelApprovals: [
        { atIso: "2026-09-21T04:00:00.000Z", channel: "C0TEAM", dmChannel: PROMPT_CHANNEL, ts: "1789800000.000100" },
      ],
    };
    const home = homeWith({ rows: [approved] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(0);
    expect(injected.dispatched[0]![7]).toBe("C0TEAM");
  });

  it("refuses a read-only datadog-alert-digest row before it counts anything", async () => {
    const home = homeWith({ rows: [digestRow({ effect: "read" })] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.digestReads).toEqual([]);
    expect(injected.dispatched).toEqual([]);
    expect(injected.out.some((line) => line.includes("REFUSED") && line.includes("POSTS the card it builds"))).toBe(
      true,
    );
  });

  it("refuses a datadog-alert-digest row that names no channel", async () => {
    const home = homeWith({ rows: [digestRow({ params: { label: "Knock", probes: [] } })] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.digestReads).toEqual([]);
    expect(injected.out.some((line) => line.includes("not a runnable datadog-alert-digest row"))).toBe(true);
  });
});
