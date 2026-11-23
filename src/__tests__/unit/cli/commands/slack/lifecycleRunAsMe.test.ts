/*
 * The human lane of `slack edit|delete --as me`, called directly. Every dependency a case does not hand over
 * throws and is recorded, so each case proves which of the world's edges the lane reached and in what order —
 * and a delete dry run proves it changed nothing under its home by comparing every file before and after.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DeleteOptions, EditMeOptions } from "../../../../../cli/commands/slack/lifecycleCore.js";
import {
  type AsMeLifecycleDeps,
  runDeleteAsMe,
  runEditAsMe,
} from "../../../../../cli/commands/slack/lifecycleRunAsMe.js";
import { dripConfigFromProfile } from "../../../../../cli/commands/slack/wiring.js";
import type { SlackWriteTransport } from "../../../../../corpus/slack/writeTransport.js";
import { ok } from "../../../../../lib/result.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "as-me-lane-"));
  fixtureDirs.push(dir);
  return dir;
}

/** Every path under `dir` with its bytes, sorted, so two snapshots compare the whole tree. */
function snapshot({ dir }: { dir: string }): readonly (readonly [string, string])[] {
  return readdirSync(dir, { recursive: true })
    .map((entry) => String(entry))
    .toSorted()
    .map((entry) => {
      const path = join(dir, entry);
      return [entry, statSync(path).isDirectory() ? "<dir>" : readFileSync(path, "utf8")] as const;
    });
}

/** The human lane's world, every member throwing and recording its name unless a case supplies it. */
function landmineDeps({
  touched,
  overrides,
}: {
  touched: string[];
  overrides: Partial<AsMeLifecycleDeps>;
}): AsMeLifecycleDeps {
  const trip = ({ name }: { name: string }): never => {
    touched.push(name);
    throw new Error(`the as-me lane touched \`${name}\``);
  };
  return {
    bareRefContext: () => trip({ name: "bareRefContext" }),
    doorEnv: () => trip({ name: "doorEnv" }),
    // A port, not a function: an in-memory one, which a lane that never reaches the door never writes to.
    doorLedger: memoryDoorLedger().port,
    dripConfig: () => trip({ name: "dripConfig" }),
    highStakes: () => trip({ name: "highStakes" }),
    journalDraftDeletion: () => trip({ name: "journalDraftDeletion" }),
    makeTransport: () => trip({ name: "makeTransport" }),
    nowIso: () => trip({ name: "nowIso" }),
    out: () => trip({ name: "out" }),
    readStdin: async () => trip({ name: "readStdin" }),
    recordVoicePainPoints: () => trip({ name: "recordVoicePainPoints" }),
    resolveMentions: () => trip({ name: "resolveMentions" }),
    taggedAccount: async () => trip({ name: "taggedAccount" }),
    userToken: () => trip({ name: "userToken" }),
    verifiedOwnDm: async () => trip({ name: "verifiedOwnDm" }),
    ...overrides,
  };
}

function editOptions({ home }: { home: string }): EditMeOptions {
  return {
    actor: "me",
    channel: "C0ASME",
    dryRun: false,
    home,
    json: false,
    kind: "edit",
    source: { kind: "body", text: "-" },
    ts: "1700000000.000100",
  };
}

function deleteOptions({ home, dryRun }: { home: string; dryRun: boolean }): DeleteOptions {
  return { actor: "me", channel: "C0ASME", dryRun, home, json: false, kind: "delete", ts: "1700000000.000100" };
}

describe("runEditAsMe", () => {
  it("exits 2 with no user token, having asked for the token and nothing after it", async () => {
    const touched: string[] = [];
    const tokenHomes: string[] = [];
    const home = freshHome();
    const deps = landmineDeps({
      overrides: {
        userToken: (args) => {
          tokenHomes.push(args.home);
          return undefined;
        },
      },
      touched,
    });

    expect(await runEditAsMe({ deps, options: editOptions({ home }) })).toBe(2);
    expect(tokenHomes).toEqual([home]);
    expect(touched).toEqual([]);
  });

  it("exits 1 over a corrupt profile with a token in hand, before stdin, mentions or a transport", async () => {
    const touched: string[] = [];
    const home = freshHome();
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    const deps = landmineDeps({
      overrides: { dripConfig: (args) => dripConfigFromProfile(args), userToken: () => "xoxp-fake" },
      touched,
    });

    expect(await runEditAsMe({ deps, options: editOptions({ home }) })).toBe(1);
    expect(touched).toEqual([]);
  });
});

describe("runDeleteAsMe", () => {
  it("exits 2 with no user token, before a transport is built or anything is printed", async () => {
    const touched: string[] = [];
    const deps = landmineDeps({ overrides: { userToken: () => undefined }, touched });

    expect(await runDeleteAsMe({ deps, options: deleteOptions({ dryRun: false, home: freshHome() }) })).toBe(2);
    expect(touched).toEqual([]);
  });

  it("prints the would-delete line on a dry run, calls no transport method, and leaves the home's files as they were", async () => {
    const touched: string[] = [];
    const out: string[] = [];
    const transportArgs: { home: string; token: string }[] = [];
    const transportReads: string[] = [];
    const home = freshHome();
    writeFileSync(join(home, "seed.txt"), "seeded before the dry run", "utf8");
    const before = snapshot({ dir: home });
    const deps = landmineDeps({
      overrides: {
        makeTransport: (args) => {
          transportArgs.push(args);
          return new Proxy(
            {},
            {
              get: (_target, property) => {
                transportReads.push(String(property));
                throw new Error(`a dry run read transport member \`${String(property)}\``);
              },
            },
          ) as SlackWriteTransport;
        },
        out: (line) => {
          out.push(line);
        },
        userToken: () => "xoxp-fake",
      },
      touched,
    });

    expect(await runDeleteAsMe({ deps, options: deleteOptions({ dryRun: true, home }) })).toBe(0);
    expect(out).toEqual([
      "dry run — nothing was changed. would chat.delete (as me, no ownership check) C0ASME/1700000000.000100",
    ]);
    expect(transportArgs).toEqual([{ home, token: "xoxp-fake" }]);
    expect(transportReads).toEqual([]);
    expect(touched).toEqual([]);
    expect(snapshot({ dir: home })).toEqual(before);
    // The snapshot helper sees the seeded file, so the comparison above is not one over two empty lists.
    expect(before.length).toBe(1);
  });

  it("deletes nothing and exits 1 when the door record cannot be written", async () => {
    const touched: string[] = [];
    const deletes: string[] = [];
    const deps = landmineDeps({
      overrides: {
        doorLedger: unreachableDoorLedger(),
        makeTransport: () =>
          ({
            deleteMessage: async () => {
              deletes.push("deleteMessage");
              return true;
            },
          }) as unknown as SlackWriteTransport,
        userToken: () => "xoxp-fake",
      },
      touched,
    });

    expect(await runDeleteAsMe({ deps, options: deleteOptions({ dryRun: false, home: freshHome() }) })).toBe(1);
    expect(deletes).toEqual([]);
    expect(touched).toEqual([]);
  });

  it("journals a confirmed delete into the draft register once, and a delete Slack did not confirm not at all", async () => {
    const run = async ({ confirmed }: { confirmed: boolean }) => {
      const touched: string[] = [];
      const out: string[] = [];
      const journals: { channel: string; home: string; nowIso: string; ts: string }[] = [];
      const home = freshHome();
      const deps = landmineDeps({
        overrides: {
          journalDraftDeletion: (call) => {
            journals.push(call);
            return ok(["sd-asme0001"]);
          },
          makeTransport: () => ({ deleteMessage: async () => confirmed }) as unknown as SlackWriteTransport,
          nowIso: () => "2026-10-25T08:00:00.000Z",
          out: (line) => {
            out.push(line);
          },
          userToken: () => "xoxp-fake",
        },
        touched,
      });
      const code = await runDeleteAsMe({ deps, options: deleteOptions({ dryRun: false, home }) });
      return { code, home, journals, out, touched };
    };
    const confirmed = await run({ confirmed: true });
    const unconfirmed = await run({ confirmed: false });

    expect({ code: confirmed.code, out: confirmed.out, touched: confirmed.touched }).toEqual({
      code: 0,
      out: ["draft register: recorded deleted on sd-asme0001", "deleted — channel=C0ASME ts=1700000000.000100 (as me)"],
      touched: [],
    });
    expect(confirmed.journals).toEqual([
      { channel: "C0ASME", home: confirmed.home, nowIso: "2026-10-25T08:00:00.000Z", ts: "1700000000.000100" },
    ]);
    expect({ code: unconfirmed.code, journals: unconfirmed.journals, out: unconfirmed.out }).toEqual({
      code: 1,
      journals: [],
      out: [],
    });
  });
});
