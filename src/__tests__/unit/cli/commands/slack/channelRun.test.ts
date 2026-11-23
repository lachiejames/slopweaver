/**
 * `slack channel`'s SHELL, driven end to end through `runChannelWithDeps` with plain fakes — no mocks, no
 * network, no clock (`.claude/rules/testing.md`: an injected seam is not a mock).
 *
 * The shell is where the irreversible ordering lives, so what is asserted here is ORDER and RESTRAINT: that
 * a refusal reaches Slack with NOTHING, that a create which then fails to describe the channel reports a
 * PARTIAL SUCCESS rather than a failure, and that an invite refusal Slack would not attribute is still said
 * out loud. None of those is reachable from the pure core.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { runChannelWithDeps } from "../../../../../cli/commands/slack/channelRun.js";
import type { ChannelDeps } from "../../../../../cli/commands/slack/channelWiring.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { InviteOutcome, OpenedConversation } from "../../../../../corpus/slack/writeApiConversations.js";
import { err, ok } from "../../../../../lib/result.js";
import type { ExactVoiceRule } from "../../../../../outbound/voice/exactRules.js";
import { readExactVoiceRules } from "../../../../../profileStore.js";
import { type IdentityRosterError, IdentityRosterErrors } from "../../../../../silver/identityRosterErrors.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

/** Every call the fake transport received, in order — the assertion surface for "nothing was created". */
interface Recorder {
  readonly calls: string[];
  readonly lines: string[];
}

function recorder(): Recorder {
  return { calls: [], lines: [] };
}

function deps({
  rec,
  doorLedger = memoryDoorLedger().port,
  created = { alreadyExisted: false, id: "C0NEW", name: "design-review" },
  invite = { landed: 1, refused: [], requested: ["U01"], unattributed: [] },
  purposeThrows = false,
  resolved = new Map<string, string>(),
  tokens = { bot: "xoxb-fake", user: "xoxp-fake" },
  voiceRules = ok([]),
  rosterOutage,
}: {
  rec: Recorder;
  rosterOutage?: IdentityRosterError;
  doorLedger?: DoorLedgerPort;
  created?: OpenedConversation;
  invite?: InviteOutcome;
  purposeThrows?: boolean;
  resolved?: ReadonlyMap<string, string>;
  tokens?: { bot: string | undefined; user: string | undefined };
  voiceRules?: ReturnType<ChannelDeps["voiceRules"]>;
}): ChannelDeps {
  return {
    archiveChannel: async ({ channel }) => {
      rec.calls.push(`archiveChannel:${channel}`);
      return true;
    },
    botToken: () => tokens.bot,
    doorLedger,
    createChannel: async ({ name, isPrivate }) => {
      rec.calls.push(`createChannel:${name}:${String(isPrivate)}`);
      return created;
    },
    emit: (line) => rec.lines.push(line),
    inviteToChannel: async ({ userIds }) => {
      rec.calls.push(`inviteToChannel:${userIds.join(",")}`);
      return invite;
    },
    resolvePeople: async () => {
      if (rosterOutage !== undefined) {
        return err(rosterOutage);
      }
      return ok(resolved);
    },
    setPurpose: async ({ purpose }) => {
      rec.calls.push(`setPurpose:${purpose}`);
      if (purposeThrows) {
        throw new Error("missing_scope");
      }
      return purpose;
    },
    setTopic: async ({ topic }) => {
      rec.calls.push(`setTopic:${topic}`);
      return topic;
    },
    env: () => ({}),
    recordVoicePainPoints: ({ findings, lane }) => {
      for (const finding of findings) {
        rec.calls.push(`painPoint:${lane}:${finding.path}`);
      }
    },
    userToken: () => tokens.user,
    voiceRules: () => voiceRules,
  };
}

/**
 * A throwaway state home, minted per test.
 *
 * Every path that reaches the door writes a ledger entry, and the ambient-home guard fails the individual
 * test that writes into the real `~/.slopweaver`. So the home is explicit on every argv, not just the ones
 * that obviously persist something.
 */
let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-channel-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The full argv the router hands a verb: `[node, script, noun, verb, ...tail]`, under the throwaway home. */
function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "slack", "channel", ...tail, "--home", home];
}

describe("runChannelWithDeps", () => {
  it("creates, invites, describes and reports — in that order", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({
        tail: ["create", "--name", "design-review", "--invite", "seth", "--purpose", "why", "--topic", "what"],
      }),
      deps: deps({ rec, resolved: new Map([["seth", "U01"]]) }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual([
      "createChannel:design-review:false",
      "inviteToChannel:U01",
      "setPurpose:why",
      "setTopic:what",
    ]);
  });

  it("hands every channel write the verb's --home, whose privacy policy judges it, never the ambient one", async () => {
    const written: string[] = [];
    const base = deps({ rec: recorder(), resolved: new Map([["seth", "U01"]]) });
    const recording: ChannelDeps = {
      ...base,
      archiveChannel: async ({ home: at }) => {
        written.push(`archive:${at}`);
        return true;
      },
      createChannel: async (args) => {
        written.push(`create:${args.home}`);
        return base.createChannel(args);
      },
      inviteToChannel: async (args) => {
        written.push(`invite:${args.home}`);
        return base.inviteToChannel(args);
      },
      setPurpose: async ({ home: at, purpose }) => {
        written.push(`purpose:${at}`);
        return purpose;
      },
      setTopic: async ({ home: at, topic }) => {
        written.push(`topic:${at}`);
        return topic;
      },
    };
    await runChannelWithDeps({
      argv: argv({
        tail: ["create", "--name", "design-review", "--invite", "seth", "--purpose", "why", "--topic", "what"],
      }),
      deps: recording,
    });
    await runChannelWithDeps({ argv: argv({ tail: ["archive", "--channel", "C0NEW"] }), deps: recording });

    expect(written).toEqual([
      `create:${home}`,
      `invite:${home}`,
      `purpose:${home}`,
      `topic:${home}`,
      `archive:${home}`,
    ]);
  });

  it("a dry run touches NOTHING — not even the token resolvers' verbs", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["create", "--name", "design-review", "--dry-run"] }),
      deps: deps({ rec }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual([]);
  });

  it("refuses a name Slack would rewrite BEFORE resolving a token, and creates nothing", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["create", "--name", "Design Review"] }),
      deps: deps({ rec, tokens: { bot: undefined, user: undefined } }),
    });

    // EXIT_USAGE rather than an auth error: the name is judged first, so a bad name is reported even on a
    // machine with no Slack token at all.
    expect(code).toBe(EXIT_USAGE);
    expect(rec.calls).toEqual([]);
  });

  it("refuses an unresolvable invitee and creates nothing — a channel cannot be un-minted", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["create", "--name", "eng", "--invite", "ghost"] }),
      deps: deps({ rec }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.calls).toEqual([]);
  });

  it("refuses with the error code when the store cannot say who anyone is, and creates nothing", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["create", "--name", "eng", "--invite", "seth"] }),
      deps: deps({
        rec,
        rosterOutage: IdentityRosterErrors.storeUnavailable({ doing: "be opened", reason: "no database is selected" }),
      }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual([]);
  });

  it("refuses with the error code when the store cannot say who anyone is, and invites nobody", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["invite", "--channel", "C0SYN000099", "--invite", "seth"] }),
      deps: deps({
        rec,
        rosterOutage: IdentityRosterErrors.storeUnavailable({ doing: "be opened", reason: "no database is selected" }),
      }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual([]);
  });

  it("refuses when the --as me lane has no user token, and creates nothing", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["create", "--name", "eng"] }),
      deps: deps({ rec, tokens: { bot: "xoxb-fake", user: undefined } }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.calls).toEqual([]);
  });

  it("reports a PARTIAL SUCCESS when the purpose fails — the channel is real and is NOT retracted", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["create", "--name", "eng", "--purpose", "why"] }),
      deps: deps({ purposeThrows: true, rec }),
    });

    expect(code).toBe(EXIT_ERROR);
    // The channel was created and NOT archived: retracting a channel on a failed describe would be a
    // second irreversible act taken on the operator's behalf.
    expect(rec.calls).toEqual(["createChannel:eng:false", "setPurpose:why"]);
  });

  it("treats an UNATTRIBUTED invite refusal as partial — never as everybody landing", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["create", "--name", "eng", "--invite", "seth"] }),
      deps: deps({
        invite: { landed: 0, refused: [], requested: ["U01"], unattributed: ["org_user_not_in_team"] },
        rec,
        resolved: new Map([["seth", "U01"]]),
      }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(rec.lines).toContain("invited 0/1 person(s)");
  });

  it("invites into an existing channel through the door, and touches nothing else", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["invite", "--channel", "C0EXISTS", "--invite", "seth"] }),
      deps: deps({ rec, resolved: new Map([["seth", "U01"]]) }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["inviteToChannel:U01"]);
    expect(rec.lines).toEqual(["invited 1/1 person(s)"]);
  });

  it("an invite dry run touches NOTHING", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["invite", "--channel", "C0EXISTS", "--invite", "seth", "--dry-run"] }),
      deps: deps({ rec, resolved: new Map([["seth", "U01"]]) }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual([]);
    expect(rec.lines[1]).toBe("  1. conversations.invite U01 into C0EXISTS");
  });

  it("refuses an unresolvable invitee and invites NOBODY — not even the ones that resolved", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["invite", "--channel", "C0EXISTS", "--invite", "seth,ghost"] }),
      deps: deps({ rec, resolved: new Map([["seth", "U01"]]) }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.calls).toEqual([]);
  });

  it("refuses an invite on the --as me lane with no user token, and sends nothing", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["invite", "--channel", "C0EXISTS", "--invite", "seth"] }),
      deps: deps({ rec, resolved: new Map([["seth", "U01"]]), tokens: { bot: "xoxb-fake", user: undefined } }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.calls).toEqual([]);
  });

  it("reports an invite Slack refused by name as PARTIAL — the ones who landed stay landed", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["invite", "--channel", "C0EXISTS", "--invite", "seth,alex"] }),
      deps: deps({
        invite: {
          landed: 1,
          refused: [{ code: "user_not_found", userId: "U02" }],
          requested: ["U01", "U02"],
          unattributed: [],
        },
        rec,
        resolved: new Map([
          ["seth", "U01"],
          ["alex", "U02"],
        ]),
      }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual(["inviteToChannel:U01,U02"]);
    expect(rec.lines).toEqual(["invited 1/2 person(s)"]);
  });

  it("archives through the same shell, on the lane asked for", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["archive", "--channel", "C0NEW", "--as", "bot"] }),
      deps: deps({ rec }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["archiveChannel:C0NEW"]);
  });

  it("refuses an unknown sub-command without touching anything", async () => {
    const rec = recorder();

    expect(await runChannelWithDeps({ argv: argv({ tail: ["rename"] }), deps: deps({ rec }) })).toBe(EXIT_USAGE);
    expect(rec.calls).toEqual([]);
  });
});

/**
 * The voice half. A channel's purpose and topic are the only strings a create authors, and both outlive
 * every message posted in the channel — so the door judges them, and the lane's own pain point is recorded
 * whatever it decides. The rule value here is invented (`leverage`); the operator's own rules are private
 * profile state and never a constant in this repository.
 */
describe("runChannelWithDeps — the operator's voice rules", () => {
  const BANNED: readonly ExactVoiceRule[] = [{ kind: "literal", value: "leverage" }];

  it("refuses a create whose PURPOSE breaks a rule, and mints nothing", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["create", "--name", "design-review", "--purpose", "a place to leverage the roster"] }),
      deps: deps({ rec, voiceRules: ok(BANNED) }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual(["painPoint:as-me:purpose"]);
  });

  it("refuses a create whose TOPIC breaks a rule, naming the topic rather than the purpose", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({
        tail: ["create", "--name", "design-review", "--purpose", "where we review designs", "--topic", "leverage"],
      }),
      deps: deps({ rec, voiceRules: ok(BANNED) }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual(["painPoint:as-me:topic"]);
  });

  it("admits a create that is in voice, and describes the channel as it always did", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({
        tail: ["create", "--name", "design-review", "--purpose", "where we review designs", "--topic", "designs"],
      }),
      deps: deps({ rec, voiceRules: ok(BANNED) }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual([
      "createChannel:design-review:false",
      "setPurpose:where we review designs",
      "setTopic:designs",
    ]);
  });

  it("does not read the NAME as prose — a slug the author could not have worded differently", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["create", "--name", "leverage-wins"] }),
      deps: deps({
        rec,
        created: { alreadyExisted: false, id: "C0NEW", name: "leverage-wins" },
        voiceRules: ok(BANNED),
      }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["createChannel:leverage-wins:false"]);
  });

  it("an ARCHIVE authors nothing, so a rule that would match a channel id never fires", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["archive", "--channel", "C0SYNLEVERAGE"] }),
      deps: deps({ rec, voiceRules: ok(BANNED) }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["archiveChannel:C0SYNLEVERAGE"]);
  });

  it("stops a create on a CORRUPT profile before the door, rather than reading it as no rules", async () => {
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    const rec = recorder();
    const voiceRules = readExactVoiceRules({ home });
    const door = memoryDoorLedger();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["create", "--name", "design-review", "--purpose", "a place to leverage the roster"] }),
      deps: deps({ doorLedger: door.port, rec, voiceRules }),
    });

    expect(voiceRules.isErr()).toBe(true);
    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual([]);
    expect(door.records()).toEqual([]);
  });

  it("creates nothing and exits with the error code when the door record cannot be written", async () => {
    const rec = recorder();
    const code = await runChannelWithDeps({
      argv: argv({ tail: ["create", "--name", "design-review"] }),
      deps: deps({ doorLedger: unreachableDoorLedger(), rec }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual([]);
  });
});
