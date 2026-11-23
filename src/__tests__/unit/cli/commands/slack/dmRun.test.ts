/**
 * `slack dm open`'s SHELL, driven end to end through `runDmWithDeps` with plain fakes — no mocks, no
 * network, no clock.
 *
 * The one thing only the shell can be asked is whether a refusal reaches Slack with NOTHING. Everything
 * else about this verb is pure, and lives in `dmCore.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { type DmDeps, runDmWithDeps } from "../../../../../cli/commands/slack/dmRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { type IdentityRosterError, IdentityRosterErrors } from "../../../../../silver/identityRosterErrors.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-dm-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

interface Recorder {
  readonly calls: string[];
  readonly lines: string[];
}

function deps({
  rec,
  alreadyExisted = false,
  resolved = new Map<string, string>([["seth", "U01"]]),
  // An OBJECT default rather than `botToken = "xoxb-fake"`, and that is a correctness point rather than
  // style: a defaulted parameter given an explicit `undefined` falls back to its default, so the
  // no-token test would silently have run WITH a token and passed for the wrong reason.
  tokens = { bot: "xoxb-fake" },
  doorLedger = memoryDoorLedger().port,
  rosterOutage,
}: {
  rec: Recorder;
  alreadyExisted?: boolean;
  doorLedger?: DoorLedgerPort;
  rosterOutage?: IdentityRosterError;
  resolved?: ReadonlyMap<string, string>;
  tokens?: { bot: string | undefined };
}): DmDeps {
  return {
    botToken: () => tokens.bot,
    doorLedger,
    emit: (line) => rec.lines.push(line),
    openConversation: async ({ userIds }) => {
      rec.calls.push(`openConversation:${userIds.join(",")}`);
      return { alreadyExisted, id: "D0OPENED", name: undefined };
    },
    resolvePeople: async () => {
      if (rosterOutage !== undefined) {
        return err(rosterOutage);
      }
      return ok(resolved);
    },
    userToken: () => "xoxp-fake",
  };
}

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "slack", "dm", ...tail, "--home", home];
}

describe("runDmWithDeps", () => {
  it("opens the conversation on the bot lane by default and prints the id", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runDmWithDeps({ argv: argv({ tail: ["open", "--with", "seth"] }), deps: deps({ rec }) });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["openConversation:U01"]);
    expect(rec.lines[0]).toBe("opened a DM with 1 person(s): D0OPENED");
  });

  it("hands the conversation open the verb's --home, whose privacy policy judges it, never the ambient one", async () => {
    const written: string[] = [];
    const base = deps({ rec: { calls: [], lines: [] } });
    await runDmWithDeps({
      argv: argv({ tail: ["open", "--with", "seth"] }),
      deps: {
        ...base,
        openConversation: async (args) => {
          written.push(`open:${args.home}`);
          return base.openConversation(args);
        },
      },
    });

    expect(written).toEqual([`open:${home}`]);
  });

  it("says the conversation ALREADY EXISTED rather than claiming to have made one", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    await runDmWithDeps({
      argv: argv({ tail: ["open", "--with", "seth"] }),
      deps: deps({ alreadyExisted: true, rec }),
    });

    expect(rec.lines[0]).toBe("that DM already existed: D0OPENED");
  });

  it("opens nothing and exits with the error code when the door record cannot be written", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runDmWithDeps({
      argv: argv({ tail: ["open", "--with", "seth"] }),
      deps: deps({ doorLedger: unreachableDoorLedger(), rec }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual([]);
  });

  it("a dry run opens nothing", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runDmWithDeps({
      argv: argv({ tail: ["open", "--with", "seth", "--dry-run"] }),
      deps: deps({ rec }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual([]);
  });

  it("refuses an unresolvable person BEFORE resolving a token, and opens nothing", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runDmWithDeps({
      argv: argv({ tail: ["open", "--with", "ghost"] }),
      deps: deps({ rec, resolved: new Map(), tokens: { bot: undefined } }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.calls).toEqual([]);
  });

  it("refuses with the error code, not a usage error, when the store cannot say who anyone is, and opens nothing", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runDmWithDeps({
      argv: argv({ tail: ["open", "--with", "seth"] }),
      deps: deps({
        rec,
        rosterOutage: IdentityRosterErrors.storeUnavailable({ doing: "be opened", reason: "no database is selected" }),
      }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual([]);
  });

  it("refuses when the chosen lane has no token, and opens nothing", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runDmWithDeps({
      argv: argv({ tail: ["open", "--with", "seth"] }),
      deps: deps({ rec, tokens: { bot: undefined } }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.calls).toEqual([]);
  });
});
