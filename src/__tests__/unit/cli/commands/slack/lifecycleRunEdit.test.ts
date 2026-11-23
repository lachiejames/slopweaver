/*
 * `slack edit`'s lane dispatch (`runEdit`), called directly. Every dependency a case does not hand over throws and
 * is recorded, so each case proves which edge the chosen lane reached first: the as-me lane goes straight to the
 * user token, and the bot lane reads the profile in its own home before any token, stdin or Slack edge.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { EditCardOptions, EditMeOptions } from "../../../../../cli/commands/slack/lifecycleCore.js";
import { runEdit } from "../../../../../cli/commands/slack/lifecycleRunEdit.js";
import type { LifecycleDeps } from "../../../../../cli/commands/slack/lifecycleRunTypes.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "edit-lane-"));
  fixtureDirs.push(dir);
  return dir;
}

/** The whole lifecycle world, every member throwing and recording its name unless a case supplies it. */
function landmineDeps({ touched, overrides }: { touched: string[]; overrides: Partial<LifecycleDeps> }): LifecycleDeps {
  const trip = ({ name }: { name: string }): never => {
    touched.push(name);
    throw new Error(`slack edit touched \`${name}\``);
  };
  return {
    bareRefContext: () => trip({ name: "bareRefContext" }),
    botToken: () => trip({ name: "botToken" }),
    cardChrome: () => trip({ name: "cardChrome" }),
    cardNames: () => trip({ name: "cardNames" }),
    doorEnv: () => trip({ name: "doorEnv" }),
    doorLedger: memoryDoorLedger().port,
    dripConfig: () => trip({ name: "dripConfig" }),
    highStakes: () => trip({ name: "highStakes" }),
    journalDraftDeletion: () => trip({ name: "journalDraftDeletion" }),
    standaloneProgressEventType: () => trip({ name: "standaloneProgressEventType" }),
    makeApi: () => trip({ name: "makeApi" }),
    makeTransport: () => trip({ name: "makeTransport" }),
    nowIso: () => trip({ name: "nowIso" }),
    nowMs: () => trip({ name: "nowMs" }),
    out: () => trip({ name: "out" }),
    pollEventType: () => trip({ name: "pollEventType" }),
    readMedia: async () => trip({ name: "readMedia" }),
    readStdin: async () => trip({ name: "readStdin" }),
    recordVoicePainPoints: () => trip({ name: "recordVoicePainPoints" }),
    resolveMentions: () => trip({ name: "resolveMentions" }),
    resolvePollPeople: () => trip({ name: "resolvePollPeople" }),
    taggedAccount: async () => trip({ name: "taggedAccount" }),
    userToken: () => trip({ name: "userToken" }),
    verifiedOwnDm: async () => trip({ name: "verifiedOwnDm" }),
    voiceRules: () => trip({ name: "voiceRules" }),
    ...overrides,
  };
}

function botOptions({ home }: { home: string }): EditCardOptions {
  return {
    actor: "bot",
    allowUnresolvedOwner: false,
    channel: "C0EDIT",
    dryRun: false,
    formJson: "-",
    home,
    json: false,
    kind: "edit",
    ts: "1700000000.000100",
  };
}

describe("runEdit", () => {
  it("sends --as me to the human lane, which exits 2 on a missing user token without a bot-lane read", async () => {
    const touched: string[] = [];
    const lanes: string[] = [];
    const options: EditMeOptions = {
      actor: "me",
      channel: "C0EDIT",
      dryRun: false,
      home: freshHome(),
      json: false,
      kind: "edit",
      source: { kind: "body", text: "-" },
      ts: "1700000000.000100",
    };
    const deps = landmineDeps({
      overrides: {
        userToken: () => {
          lanes.push("userToken");
          return undefined;
        },
      },
      touched,
    });

    expect(await runEdit({ deps, options })).toBe(2);
    expect(lanes).toEqual(["userToken"]);
    expect(touched).toEqual([]);
  });

  it("exits 1 for a bot edit over a corrupt profile in its own home, before the token, stdin or Slack", async () => {
    const touched: string[] = [];
    const home = freshHome();
    writeFileSync(join(home, "profile.json"), "{", "utf8");

    expect(await runEdit({ deps: landmineDeps({ overrides: {}, touched }), options: botOptions({ home }) })).toBe(1);
    expect(touched).toEqual([]);
  });

  it("reaches the bot token once the profile reads, exiting 2 when there is none — the near miss of the case above", async () => {
    const touched: string[] = [];
    const tokenHomes: string[] = [];
    const home = freshHome();
    const deps = landmineDeps({
      overrides: {
        botToken: (args) => {
          tokenHomes.push(args.home);
          return undefined;
        },
      },
      touched,
    });

    expect(await runEdit({ deps, options: botOptions({ home }) })).toBe(2);
    expect(tokenHomes).toEqual([home]);
    expect(touched).toEqual([]);
  });
});
