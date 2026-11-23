/**
 * The `listen recover` verb's PARSE half — everything decidable before Slack is touched — and its manual
 * SWEEP, driven end to end over a plain fake `SlackApi`.
 *
 * The sweep used to be called integration-only here. It is not: `sweep` takes the Slack read seam and its
 * two output sinks as arguments, so the real scan-to-document-to-exit-code path runs in this lane with no
 * mock (`testing.md`'s zero-mocks rule) and no network. That matters more than tidiness — the defect of
 * once shipped lived exactly in the WIRING between what the scan counted and what the verb printed, which a
 * test of either half alone cannot see. The filtering the sweep drives stays covered in
 * `src/__tests__/unit/live/listen/recover/`; its coverage counting in `.../recoverScan.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { ListenErrors, listenErrorLines } from "../../../../../cli/commands/listen/errors.js";
import { LISTEN_RECOVER_USAGE } from "../../../../../cli/commands/listen/listenUsage.js";
import { briefReplayCommand, sweep } from "../../../../../cli/commands/listen/manualSweep.js";
import {
  listenRecoverCommand,
  parseRecoverArgs,
  recoverOptions,
  resolveSince,
  runListenRecover,
  scanTargets,
} from "../../../../../cli/commands/listen/recover.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { listenManifest } from "../../../../../cli/manifests/listen.js";
import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { Mention } from "../../../../../live/listen/mention.js";
import { distinctTargets, type RecoveryScanTarget } from "../../../../../live/listen/recoverScan.js";

/** A fixed instant, pinned so the day arithmetic is checkable rather than relative. */
const NOW_MS = Date.parse("2026-08-07T00:00:00.000Z");

describe("resolveSince", () => {
  it("reads an `Nd` day count, which is what a person types after a weekend", () => {
    expect(unwrap(resolveSince({ nowMs: NOW_MS, since: "7d" }))).toBe("2026-07-31T00:00:00.000Z");
  });

  it("reads an ISO instant, which is what a script passes when it knows the last listener's time", () => {
    expect(unwrap(resolveSince({ nowMs: NOW_MS, since: "2026-08-05T13:00:00.000Z" }))).toBe("2026-08-05T13:00:00.000Z");
  });

  it("defaults to three days back rather than to the beginning of time", () => {
    expect(unwrap(resolveSince({ nowMs: NOW_MS, since: undefined }))).toBe("2026-08-04T00:00:00.000Z");
  });

  it("handles `0d` as now, not as absent", () => {
    expect(unwrap(resolveSince({ nowMs: NOW_MS, since: "0d" }))).toBe("2026-08-07T00:00:00.000Z");
  });

  it("REFUSES a value that is neither, rather than silently sweeping everything", () => {
    const resolved = resolveSince({ nowMs: NOW_MS, since: "last tuesday" });

    expect(unwrapErr(resolved)).toEqual(ListenErrors.sinceUnreadable({ got: "last tuesday" }));
    expect(unwrapErr(resolved).message).toBe(
      "--since `last tuesday` is neither an ISO-8601 instant nor an `Nd` day count",
    );
  });
});

describe("recoverOptions", () => {
  const values = { "bot-user": "U_BOT", channels: "C1,C2" };

  it("resolves the manual-mode defaults, unscheduled and undeadlined", () => {
    const options = unwrap(recoverOptions({ nowMs: NOW_MS, values }));
    expect(options.scheduled).toBe(false);
    expect(options.deadlineMs).toBeUndefined();
    expect(options.sinceExplicit).toBe(false);
  });

  it("records that --since was explicitly typed", () => {
    const options = unwrap(recoverOptions({ nowMs: NOW_MS, values: { ...values, since: "2026-08-01T00:00:00.000Z" } }));
    expect(options.sinceExplicit).toBe(true);
  });

  it("refuses --scheduled without --json", () => {
    const errors = unwrapErr(recoverOptions({ nowMs: NOW_MS, values: { ...values, scheduled: true } }));
    expect(listenErrorLines({ error: errors })).toEqual(["--scheduled requires --json"]);
  });

  it("accepts --scheduled --json", () => {
    const options = unwrap(recoverOptions({ nowMs: NOW_MS, values: { ...values, json: true, scheduled: true } }));
    expect(options.scheduled).toBe(true);
  });

  it("refuses --deadline-ms without --scheduled --json", () => {
    const errors = unwrapErr(recoverOptions({ nowMs: NOW_MS, values: { ...values, "deadline-ms": "5000" } }));
    expect(listenErrorLines({ error: errors })).toEqual([
      "--deadline-ms is only valid together with --scheduled --json",
    ]);
  });

  it("refuses a non-positive-integer --deadline-ms", () => {
    const errors = unwrapErr(
      recoverOptions({ nowMs: NOW_MS, values: { ...values, "deadline-ms": "nope", json: true, scheduled: true } }),
    );
    expect(listenErrorLines({ error: errors })).toEqual([
      "--deadline-ms must be a positive integer number of milliseconds, got 'nope'",
    ]);
  });

  it("accepts a valid --deadline-ms alongside --scheduled --json", () => {
    const options = unwrap(
      recoverOptions({ nowMs: NOW_MS, values: { ...values, "deadline-ms": "5000", json: true, scheduled: true } }),
    );
    expect(options.deadlineMs).toBe(5000);
  });
});

describe("recoverOptions — --discover-channels", () => {
  const values = { "bot-user": "U_BOT", channels: "C1,C2" };

  it("is OFF with no flag, so a pass reads exactly the channels it was given", () => {
    expect(unwrap(recoverOptions({ nowMs: NOW_MS, values })).discoverChannels).toBe(false);
  });

  it("widens the BREADTH while leaving --channels — the reply gate — exactly as typed", () => {
    const options = unwrap(recoverOptions({ nowMs: NOW_MS, values: { ...values, "discover-channels": true } }));
    expect(options.discoverChannels).toBe(true);
    expect(options.channels).toEqual(["C1", "C2"]);
  });

  it("still requires --channels, because discovery never says where a reply may go", () => {
    const errors = unwrapErr(
      recoverOptions({ nowMs: NOW_MS, values: { "bot-user": "U_BOT", "discover-channels": true } }),
    );
    expect(listenErrorLines({ error: errors })).toEqual([
      "--channels is required, naming at least one channel the bot may reply in",
    ]);
  });

  it("refuses a --channels that names nothing with the same refusal an absent one gets", () => {
    const errors = unwrapErr(recoverOptions({ nowMs: NOW_MS, values: { "bot-user": "U_BOT", channels: " , ," } }));
    expect(listenErrorLines({ error: errors })).toEqual([
      "--channels is required, naming at least one channel the bot may reply in",
    ]);
  });

  it("reports both missing required flags at once, one printed line each", () => {
    const errors = unwrapErr(recoverOptions({ nowMs: NOW_MS, values: {} }));
    expect(errors.code).toBe("REQUIRED_FLAGS_MISSING");
    expect(listenErrorLines({ error: errors })).toEqual([
      "--bot-user is required",
      "--channels is required, naming at least one channel the bot may reply in",
    ]);
  });

  it("refuses --scheduled, whose own discovery already supplies the same breadth", () => {
    const errors = unwrapErr(
      recoverOptions({ nowMs: NOW_MS, values: { ...values, "discover-channels": true, json: true, scheduled: true } }),
    );
    expect(listenErrorLines({ error: errors })).toEqual([
      "--discover-channels is manual mode only — a --scheduled sweep already discovers its breadth",
    ]);
  });

  it("is parsed as a boolean, so it never swallows the next argument", () => {
    const parsed = unwrap(parseRecoverArgs({ rest: ["--discover-channels", "--channels", "C1"] }));
    expect(parsed.values["discover-channels"]).toBe(true);
    expect(parsed.values["channels"]).toBe("C1");
  });
});

/** Every read scope a complete membership walk needs — what the real bot token holds. */
const ALL_DISCOVERY_SCOPES: readonly string[] = ["channels:read", "groups:read", "im:read", "mpim:read"];

/** A Slack read seam serving one fixed page per lane and a fixed scope answer — plain fakes, never mocks. */
function channelsServing({
  channels,
  scopes = ALL_DISCOVERY_SCOPES,
}: {
  channels: readonly Record<string, unknown>[];
  scopes?: readonly string[];
}): Pick<SlackApi, "grantedScopes" | "listChannels"> {
  return {
    grantedScopes: async () => scopes,
    listChannels: async ({ lane }) => (lane === "group-dms" ? { channels: [] } : { channels }),
  };
}

describe("scanTargets — what --discover-channels actually reads", () => {
  const values = { "bot-user": "U_BOT", channels: "C_PUBLIC,C_PRIVATE" };

  it("reads exactly the typed ids without the flag", async () => {
    const options = unwrap(recoverOptions({ nowMs: NOW_MS, values }));
    const targets = unwrap(await scanTargets({ api: channelsServing({ channels: [] }), options }));

    expect(targets).toEqual([
      { id: "C_PUBLIC", kind: "explicit" },
      { id: "C_PRIVATE", kind: "explicit" },
    ]);
  });

  it("WIDENS rather than replaces, so an id the operator typed is ALWAYS attempted", async () => {
    // Discovery answers the bot's own membership, which is not always a superset of what was typed: an id
    // the bot has not joined, or one invited between the walk and the scan, is absent from it. Replacing
    // the typed list would drop that channel, read the rest, and print `complete` over it; carrying both
    // means it is read, or it lands in a coverage bucket and the pass goes partial.
    const options = unwrap(recoverOptions({ nowMs: NOW_MS, values: { ...values, "discover-channels": true } }));
    const api = channelsServing({
      channels: [
        { id: "C_PUBLIC", is_member: true },
        { id: "D_OWNER", is_im: true },
      ],
    });

    const targets = unwrap(await scanTargets({ api, options }));

    expect(targets.map((target) => (target.kind === "explicit" ? target.id : target.channel.id))).toEqual([
      "C_PUBLIC",
      "D_OWNER",
      "C_PUBLIC",
      "C_PRIVATE",
    ]);
    expect(distinctTargets({ channels: targets }).has("C_PRIVATE")).toBe(true);
  });

  it("scans a channel on BOTH lists once, as the discovered target that knows its real surface", async () => {
    const options = unwrap(recoverOptions({ nowMs: NOW_MS, values: { ...values, "discover-channels": true } }));
    const api = channelsServing({ channels: [{ id: "C_PUBLIC", is_member: true }] });

    const distinct = distinctTargets({ channels: unwrap(await scanTargets({ api, options })) });

    expect([...distinct.keys()]).toEqual(["C_PUBLIC", "C_PRIVATE"]);
    expect(distinct.get("C_PUBLIC")!.kind).toBe("discovered");
    expect(distinct.get("C_PRIVATE")!.kind).toBe("explicit");
  });

  it("reports a walk naming nothing actionable as a failure, never as an empty breadth", async () => {
    const options = unwrap(recoverOptions({ nowMs: NOW_MS, values: { ...values, "discover-channels": true } }));
    const api = channelsServing({ channels: [{ id: "C_SEEN_ONLY", is_member: false }] });

    expect(unwrapErr(await scanTargets({ api, options }))).toContain("none it may act in");
  });

  it("fails the whole pass when the token cannot see a conversation class, rather than scanning the rest", async () => {
    // The counterexample the union cannot reach: a token without groups:read walks cleanly and
    // returns a NON-EMPTY set with every private channel silently absent. Scanning the survivors would
    // certify `complete` over a breadth nobody could have typed their way back into.
    const options = unwrap(recoverOptions({ nowMs: NOW_MS, values: { ...values, "discover-channels": true } }));
    const api = channelsServing({
      channels: [{ id: "C_PUBLIC", is_member: true }],
      scopes: ["channels:read", "im:read", "mpim:read"],
    });

    expect(unwrapErr(await scanTargets({ api, options }))).toContain("does not hold groups:read");
  });
});

describe("listen recover usage", () => {
  it("declares every flag the parser accepts", () => {
    for (const flag of [
      "--bot-user",
      "--channels",
      "--since",
      "--home",
      "--json",
      "--scheduled",
      "--discover-channels",
      "--deadline-ms",
    ]) {
      expect(LISTEN_RECOVER_USAGE).toContain(flag);
    }
  });

  /**
   * The usage carries the `botId` trap, deliberately.
   *
   * Passing a `bot_id` where a USER id belongs is the single mistake that makes this verb quietly useless —
   * it would report every thread the owner spoke in as already answered — and the flag name alone does not
   * prevent it. Documenting the trap where the operator reads the flag is the cheapest guard available.
   */
  it("warns that --bot-user is a USER id and not a bot_id", () => {
    expect(LISTEN_RECOVER_USAGE).toContain("NOT a bot_id");
  });

  it("says the sweep posts nothing", () => {
    expect(LISTEN_RECOVER_USAGE).toContain("runs no model and posts nothing");
  });
});

describe("listen recover refusals", () => {
  it("refuses without --bot-user and --channels, before any Slack call", async () => {
    expect(await runListenRecover(["node", "slopweaver", "listen", "recover"])).toBe(EXIT_USAGE);
  });

  /**
   * `--channels` has no default, and that is the WHERE gate.
   *
   * A recovery pass that swept everything the bot can see would be one flag away from replying in channels
   * it has no business in, weeks after the fact. The owner named "not an appropriate place to respond" as an
   * exclusion, so the appropriate places are stated rather than discovered.
   */
  it("refuses when --channels is present but names nothing", async () => {
    const argv = ["node", "slopweaver", "listen", "recover", "--bot-user", "U1", "--channels", " , "];

    expect(await runListenRecover(argv)).toBe(EXIT_USAGE);
  });

  it("refuses an unparseable --since before opening a connection", async () => {
    const flags = ["--bot-user", "U1", "--channels", "C1", "--since", "whenever"];
    const argv = ["node", "slopweaver", "listen", "recover", ...flags];

    expect(await runListenRecover(argv)).toBe(EXIT_USAGE);
  });

  it("refuses an unknown flag rather than ignoring it", async () => {
    expect(await runListenRecover(["node", "slopweaver", "listen", "recover", "--nope"])).toBe(EXIT_USAGE);
  });

  it("does not mistake its own verb token for a stray argument", () => {
    const argv = ["node", "slopweaver", "listen", "recover", "--bot-user", "U1", "--channels", "C1"];
    const parsed = parseRecoverArgs({ rest: argv.slice(4) });

    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.positionals : ["not parsed"]).toEqual([]);
  });
});

describe("briefReplayCommand", () => {
  it("prints the exact --message-ts, never reconstructing it from --thread-ts", () => {
    const mention: Mention = {
      channel: "C_BOT",
      messageTs: "1785000000.000100",
      surface: "channel",
      text: "are the payment logs kept anywhere?",
      threadTs: "1784000000.000001",
      userId: "U_ASKER",
    };

    const lines = briefReplayCommand({ mention });

    expect(lines[0]).toContain("--message-ts 1785000000.000100");
    expect(lines[0]).toContain("--thread-ts 1784000000.000001");
  });

  it("omits --turn-id/--working-ts for an off-period ask, which never had a live capture checklist", () => {
    const mention: Mention = {
      channel: "C_BOT",
      messageTs: "1785000000.000100",
      surface: "channel",
      text: "are the payment logs kept anywhere?",
      threadTs: "1785000000.000100",
      userId: "U_ASKER",
    };

    const lines = briefReplayCommand({ mention });

    expect(lines[1]).not.toContain("--turn-id");
    expect(lines[1]).not.toContain("--working-ts");
  });

  it("appends --turn-id/--working-ts exactly when the recovered mention carries a started checklist", () => {
    const mention: Mention = {
      channel: "C_BOT",
      messageTs: "1785000000.000100",
      started: { turnId: "turn-1", workingTs: "1785000000.000200" },
      surface: "channel",
      text: "are the payment logs kept anywhere?",
      threadTs: "1785000000.000100",
      userId: "U_ASKER",
    };

    const lines = briefReplayCommand({ mention });

    expect(lines[1]).toContain("--turn-id turn-1");
    expect(lines[1]).toContain("--working-ts 1785000000.000200");
  });
});

describe("sweep — the document and the exit code a manual pass produces", () => {
  const BOT_ID = "U_BOT";
  const SINCE_ISO = "2026-08-01T00:00:00.000Z";
  const TAGGED = "1786400000.000300";

  /** A typed `SlackApi` whose history answers per channel: readable-and-empty, tagged, or `not_in_channel`. */
  function fakeApi({ tagged, unreadable }: { tagged: readonly string[]; unreadable: readonly string[] }): SlackApi {
    const rows = ({ channel }: { channel: string }): readonly unknown[] =>
      tagged.includes(channel) ? [{ text: `<@${BOT_ID}> help`, ts: TAGGED, user: "U_ASKER" }] : [];
    return {
      filesInfo: () => Promise.reject(new Error("not used")),
      grantedScopes: async () => [],
      history: async ({ channel }) => {
        if (unreadable.includes(channel)) {
          throw new Error("An API error occurred: not_in_channel");
        }
        return { messages: rows({ channel }) };
      },
      listChannels: async () => ({ channels: [] }),
      listUsers: async () => ({ members: [] }),
      replies: async ({ channel }) => ({ messages: rows({ channel }) }),
      workspaceUrl: async () => undefined,
    };
  }

  /** Run the REAL sweep over a fake workspace, collecting both streams. */
  async function run({
    channels,
    json,
    tagged = [],
    unreadable = [],
  }: {
    channels: readonly string[];
    json: boolean;
    tagged?: readonly string[];
    unreadable?: readonly string[];
  }): Promise<{ readonly code: number; readonly stdout: readonly string[]; readonly stderr: readonly string[] }> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await sweep({
      allowedChannels: channels,
      api: fakeApi({ tagged, unreadable }),
      botUserId: BOT_ID,
      cardEventType: "slopweaver_card",
      channels: channels.map((id): RecoveryScanTarget => ({ id, kind: "explicit" })),
      error: ({ msg }: { msg: string }) => {
        stderr.push(msg);
      },
      ignored: new Map(),
      ignoredConversations: new Map(),
      json,
      lifecycles: new Map(),
      out: ({ line }: { line: string }) => {
        stdout.push(line);
      },
      selfBotId: undefined,
      sinceIso: SINCE_ISO,
      terminalByAsk: new Map(),
    });
    return { code, stderr, stdout };
  }

  it("exits EXPECTED_EMPTY only when the whole requested breadth was read and nothing was dropped", async () => {
    const result = await run({ channels: ["C1", "C2"], json: true });

    expect(result.code).toBe(EXIT_EXPECTED_EMPTY);
    expect(result.stderr).toEqual([]);
    expect(JSON.parse(result.stdout.join("\n"))).toMatchObject({
      completeness: "complete",
      excludedChannels: [],
      failures: [],
      recoverable: [],
      requestedChannels: 2,
      scannedChannels: 2,
    });
  });

  it("exits OK when a complete pass found a survivor", async () => {
    const result = await run({ channels: ["C1"], json: true, tagged: ["C1"] });

    expect(result.code).toBe(EXIT_OK);
    const document = JSON.parse(result.stdout.join("\n"));
    expect(document.completeness).toBe("complete");
    expect(document.recoverable.length).toBe(1);
    expect(document.recoverable[0].candidate.messageTs).toBe(TAGGED);
  });

  it("exits ERROR when a channel it was asked to scan could not be read, and says which", async () => {
    const result = await run({ channels: ["C_BAD", "C_OK"], json: true, unreadable: ["C_BAD"] });

    expect(result.code).toBe(EXIT_ERROR);
    expect(JSON.parse(result.stdout.join("\n"))).toMatchObject({
      completeness: "partial",
      excludedChannels: [{ channel: "C_BAD", reason: "not-a-member" }],
      failures: [],
      recoverable: [],
      requestedChannels: 2,
      scannedChannels: 1,
    });
    expect(result.stderr).toEqual(["could not scan C_BAD: not-a-member"]);
  });

  it("still prints a partial pass's survivors, and still exits ERROR — take them anyway", async () => {
    const result = await run({ channels: ["C_BAD", "C_OK"], json: true, tagged: ["C_OK"], unreadable: ["C_BAD"] });

    expect(result.code).toBe(EXIT_ERROR);
    const document = JSON.parse(result.stdout.join("\n"));
    expect(document.completeness).toBe("partial");
    expect(document.recoverable[0].candidate.messageTs).toBe(TAGGED);
  });

  it("is the whole defect: 107 unreadable of 121 no longer reads like a clean 14-channel pass", async () => {
    const unreadable = Array.from({ length: 107 }, (_value, index) => `C_BAD_${String(index)}`);
    const readable = Array.from({ length: 14 }, (_value, index) => `C_OK_${String(index)}`);

    const union = await run({ channels: [...unreadable, ...readable], json: true, unreadable });
    const fourteen = await run({ channels: readable, json: true });

    const unionDocument = JSON.parse(union.stdout.join("\n"));
    const fourteenDocument = JSON.parse(fourteen.stdout.join("\n"));
    // The two facts that were identical before this change, and are the whole finding.
    expect(unionDocument.excludedBy).toEqual(fourteenDocument.excludedBy);
    expect(unionDocument.recoverable).toEqual(fourteenDocument.recoverable);
    // The two that now tell them apart.
    expect([unionDocument.completeness, fourteenDocument.completeness]).toEqual(["partial", "complete"]);
    expect([union.code, fourteen.code]).toEqual([EXIT_ERROR, EXIT_EXPECTED_EMPTY]);
    expect(unionDocument.scannedChannels).toBe(14);
    expect(unionDocument.requestedChannels).toBe(121);
  });

  it("leads the human report with coverage, and tells the reader what a re-run cannot fix", async () => {
    const result = await run({ channels: ["C_BAD", "C_OK"], json: false, unreadable: ["C_BAD"] });

    expect(result.stdout[0]).toBe("partial: read 1 of 2 requested channel(s)");
    expect(result.stdout[1]).toBe(
      "  NOT READ C_BAD (not-a-member) — invite the bot, or drop it from --channels; a re-run alone changes nothing",
    );
    expect(result.stdout[2]).toBe(`scanned 0 message(s) since ${SINCE_ISO}`);
  });

  it("prints exactly one JSON document", async () => {
    const result = await run({ channels: ["C1"], json: true });

    expect(result.stdout.length).toBe(1);
  });
});

describe("listen manifest", () => {
  it("declares recover an external write routed through the door — --scheduled can capture or refuse a survivor", () => {
    expect(listenManifest["recover"]!.meta.effect).toBe("external-write");
    expect(listenManifest["recover"]!.meta.doorRouted).toBe(true);
  });

  it("exposes the command the manifest lazily loads", () => {
    expect(listenRecoverCommand).toBe(runListenRecover);
  });
});

describe("listenErrorLines", () => {
  it("prints each missing required flag on its own line, never the joined message", () => {
    expect(listenErrorLines({ error: ListenErrors.recoverFlagsMissing({ botUser: true, channels: true }) })).toEqual([
      "--bot-user is required",
      "--channels is required, naming at least one channel the bot may reply in",
    ]);
  });

  it("prints a single-problem refusal as its message", () => {
    expect(listenErrorLines({ error: ListenErrors.scheduledWithoutJson() })).toEqual(["--scheduled requires --json"]);
  });
});
