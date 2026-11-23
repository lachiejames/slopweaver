/**
 * `slack status`'s SHELL, driven end to end through `runStatusWithDeps` with plain fakes — no mocks, no
 * network. What only the shell can be asked: that a dry run and a refusal reach Slack with nothing, that a
 * write is reported from Slack's READ-BACK, and that `show` passes no door.
 *
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { runStatusWithDeps } from "../../../../../cli/commands/slack/statusRun.js";
import { SLACK_STATUS_USAGE } from "../../../../../cli/commands/slack/statusUsage.js";
import type { StatusDeps } from "../../../../../cli/commands/slack/statusWiring.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { HeldPresence, HeldStatus, StatusWrite } from "../../../../../corpus/slack/writeApiProfile.js";
import { ok } from "../../../../../lib/result.js";
import { readExactVoiceRules } from "../../../../../profileStore.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

/** The fixture instant — 13:00 on a public holiday in Melbourne. */
const NOW_MS = Date.parse("2026-09-25T03:00:00Z");

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-status-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

interface Recorder {
  readonly calls: string[];
  readonly lines: string[];
}

/** A Slack that holds what it was last sent, unless told to answer something else or to throw. */
function deps({
  rec,
  door = memoryDoorLedger(),
  token = { value: "xoxp-fake" },
  failWith = { message: undefined },
  readFailWith = { message: undefined },
  heldOverride = { status: undefined },
  rules = ok([]),
}: {
  rec: Recorder;
  door?: { readonly port: DoorLedgerPort };
  token?: { value: string | undefined };
  failWith?: { message: string | undefined };
  readFailWith?: { message: string | undefined };
  heldOverride?: { status: HeldStatus | undefined };
  rules?: ReturnType<StatusDeps["voiceRules"]>;
}): StatusDeps {
  let status: HeldStatus = { emoji: "", expirationSeconds: 0, text: "" };
  let presence: HeldPresence = { manualAway: false, online: true, presence: "active" };
  return {
    doorLedger: door.port,
    emit: (line) => rec.lines.push(line),
    env: () => ({}),
    now: () => NOW_MS,
    profile: () => ({
      readPresence: async () => {
        rec.calls.push("users.getPresence");
        if (readFailWith.message !== undefined) {
          throw new Error(readFailWith.message);
        }
        return presence;
      },
      readProfileStatus: async () => {
        rec.calls.push("users.profile.get");
        if (heldOverride.status !== undefined) {
          return heldOverride.status;
        }
        return status;
      },
      setPresence: async ({ presence: next }) => {
        rec.calls.push(`users.setPresence:${next}`);
        if (failWith.message !== undefined) {
          throw new Error(failWith.message);
        }
        presence = { manualAway: next === "away", online: true, presence: next === "away" ? "away" : "active" };
      },
      setProfileStatus: async (write: StatusWrite) => {
        rec.calls.push(`users.profile.set:${write.statusText}|${write.statusEmoji}|${String(write.expirationSeconds)}`);
        if (failWith.message !== undefined) {
          throw new Error(failWith.message);
        }
        status = { emoji: write.statusEmoji, expirationSeconds: write.expirationSeconds, text: write.statusText };
      },
    }),
    recordVoicePainPoints: () => undefined,
    userToken: () => token.value,
    voiceRules: () => rules,
  };
}

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "slack", "status", ...tail, "--home", home];
}

const HOLIDAY = [
  "set",
  "--text",
  "Public holiday, back Monday",
  "--emoji",
  ":palm_tree:",
  "--until",
  "end-of-day",
  "--zone",
  "Australia/Melbourne",
];

describe("slack status set", () => {
  it("makes no Slack call on a dry run, and prints the expiry it would send", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runStatusWithDeps({ argv: argv({ tail: [...HOLIDAY, "--dry-run"] }), deps: deps({ rec }) });
    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual([]);
    expect(rec.lines).toEqual([
      "DRY RUN — nothing was changed. On YOUR Slack profile, slopweaver would:",
      '  users.profile.set status_text="Public holiday, back Monday" status_emoji=":palm_tree:" status_expiration=1790344800',
      "  expires: 2026-09-26 Sat 00:00 Australia/Melbourne (2026-09-25T14:00:00.000Z)",
    ]);
  });

  it("refuses a dry run the door would refuse, rather than saying it would write", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const tail = ["set", "--text", "Out — back Monday", "--dry-run"];
    const rules = [{ kind: "literal", value: "—" }] as const;
    const door = memoryDoorLedger();
    const code = await runStatusWithDeps({ argv: argv({ tail }), deps: deps({ door, rec, rules: ok([...rules]) }) });
    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual([]);
    expect(rec.lines).toEqual([]);
    expect(door.records()).toEqual([]);
  });

  it.each([
    ["a dry run", ["--dry-run"]],
    ["a real run", []],
  ])("refuses a status naming a dead Datadog host before the door, calling nothing (%s)", async (_label, extra) => {
    const rec: Recorder = { calls: [], lines: [] };
    const tail = ["set", "--text", "see https://app.ap1.datadoghq.com/monitors/1", ...extra];
    const door = memoryDoorLedger();
    const code = await runStatusWithDeps({ argv: argv({ tail }), deps: deps({ door, rec }) });
    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual([]);
    expect(rec.lines).toEqual([]);
    expect(door.records()).toEqual([]);
  });

  it("refuses a dry run with no user token, exactly as the real run would", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runStatusWithDeps({
      argv: argv({ tail: [...HOLIDAY, "--dry-run"] }),
      deps: deps({ rec, token: { value: undefined } }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(rec.lines).toEqual([]);
  });

  it("writes, reads back, and prints what Slack holds", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runStatusWithDeps({ argv: argv({ tail: HOLIDAY }), deps: deps({ rec }) });
    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual([
      "users.profile.set:Public holiday, back Monday|:palm_tree:|1790344800",
      "users.profile.get",
    ]);
    expect(rec.lines).toEqual([
      "your Slack status: :palm_tree: Public holiday, back Monday",
      "  expires: 2026-09-26 Sat 00:00 Australia/Melbourne (2026-09-25T14:00:00.000Z)",
    ]);
  });

  it("records the write in the door ledger, and never its text", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const door = memoryDoorLedger();
    await runStatusWithDeps({ argv: argv({ tail: HOLIDAY }), deps: deps({ door, rec }) });
    const ledger = door.text();
    expect(ledger).toContain('"action":"verb:slack.status"');
    expect(HOLIDAY).toContain("Public holiday, back Monday");
    expect(ledger).not.toContain("Public holiday");
  });

  it("changes nothing and exits with the error code when the door record cannot be written", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runStatusWithDeps({
      argv: argv({ tail: HOLIDAY }),
      deps: { ...deps({ rec }), doorLedger: unreachableDoorLedger() },
    });
    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual([]);
  });

  it("exits non-zero when Slack reads back something other than what was sent", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runStatusWithDeps({
      argv: argv({ tail: HOLIDAY }),
      deps: deps({ heldOverride: { status: { emoji: "", expirationSeconds: 0, text: "" } }, rec }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(rec.lines).toEqual([]);
  });

  it("stops at a missing scope after the one refused call", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runStatusWithDeps({
      argv: argv({ tail: HOLIDAY }),
      deps: deps({ failWith: { message: "An API error occurred: missing_scope" }, rec }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual(["users.profile.set:Public holiday, back Monday|:palm_tree:|1790344800"]);
  });

  it("makes no call with no user token", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runStatusWithDeps({
      argv: argv({ tail: HOLIDAY }),
      deps: deps({ rec, token: { value: undefined } }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(rec.calls).toEqual([]);
  });

  it("makes no call with a bot token in the user slot", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runStatusWithDeps({
      argv: argv({ tail: HOLIDAY }),
      deps: deps({ rec, token: { value: "xoxb-bot" } }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(rec.calls).toEqual([]);
  });
});

describe("slack status clear, presence and show", () => {
  it.each([
    ["a dry run", ["--dry-run"]],
    ["a real run", []],
  ])("refuses a status on a CORRUPT profile before the door, calling nothing (%s)", async (_label, extra) => {
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    const rec: Recorder = { calls: [], lines: [] };
    const rules = readExactVoiceRules({ home });
    const door = memoryDoorLedger();
    const code = await runStatusWithDeps({
      argv: argv({ tail: [...HOLIDAY, ...extra] }),
      deps: deps({ door, rec, rules }),
    });
    expect(rules.isErr()).toBe(true);
    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual([]);
    expect(rec.lines).toEqual([]);
    expect(door.records()).toEqual([]);
  });

  it("still clears a status on a CORRUPT profile, because a clear authors nothing to judge", async () => {
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    const rec: Recorder = { calls: [], lines: [] };
    const rules = readExactVoiceRules({ home });
    const code = await runStatusWithDeps({ argv: argv({ tail: ["clear"] }), deps: deps({ rec, rules }) });
    expect(rules.isErr()).toBe(true);
    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["users.profile.set:||0", "users.profile.get"]);
  });

  it("clears all three fields in one write", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runStatusWithDeps({ argv: argv({ tail: ["clear"] }), deps: deps({ rec }) });
    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["users.profile.set:||0", "users.profile.get"]);
    expect(rec.lines).toEqual(["your Slack status: none"]);
  });

  it("sets a manual away and prints how to undo it", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runStatusWithDeps({ argv: argv({ tail: ["presence", "--to", "away"] }), deps: deps({ rec }) });
    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["users.setPresence:away", "users.getPresence"]);
    expect(rec.lines).toEqual([
      "your Slack presence: away (manual — it stays away until you undo it)",
      "  undo: slopweaver slack status presence --to auto",
    ]);
  });

  it("exits non-zero and prints nothing when a manual away landed but could not be read back", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runStatusWithDeps({
      argv: argv({ tail: ["presence", "--to", "away"] }),
      deps: deps({ readFailWith: { message: "An API error occurred: missing_scope" }, rec }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual(["users.setPresence:away", "users.getPresence"]);
    expect(rec.lines).toEqual([]);
  });

  it("carries the undo in --json when a manual away landed", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runStatusWithDeps({
      argv: argv({ tail: ["presence", "--to", "away", "--json"] }),
      deps: deps({ rec }),
    });
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(rec.lines.join("\n"))).toEqual({
      operation: "presence",
      presence: {
        manualAway: true,
        online: true,
        presence: "away",
        undo: "slopweaver slack status presence --to auto",
      },
    });
  });

  it("exits non-zero without a read-back when a manual away's write failed in transport", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runStatusWithDeps({
      argv: argv({ tail: ["presence", "--to", "away"] }),
      deps: deps({ failWith: { message: "A request error occurred: ETIMEDOUT" }, rec }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual(["users.setPresence:away"]);
  });

  it("shows status and presence through no door, so no ledger is written", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const door = memoryDoorLedger();
    const code = await runStatusWithDeps({ argv: argv({ tail: ["show"] }), deps: deps({ door, rec }) });
    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["users.profile.get", "users.getPresence"]);
    expect(rec.lines).toEqual([
      "your Slack status: none",
      "your Slack presence: active (automatic — Slack sets it from your activity)",
    ]);
    expect(door.records()).toEqual([]);
  });

  it("refuses an unknown sub-command before any call", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runStatusWithDeps({ argv: argv({ tail: ["wipe"] }), deps: deps({ rec }) });
    expect(code).toBe(EXIT_USAGE);
    expect(rec.calls).toEqual([]);
    expect(SLACK_STATUS_USAGE).toContain("presence --to away|auto");
  });
});
