/**
 * The `turn brief` verb's PARSE half — everything decidable before the corpus is touched.
 *
 * These are the mention-building cases that used to sit with the `turn answer` tests, now split under `./run/`;
 * the code moved when briefing split from answering, and the coverage moved with it. `--user` now goes through the SAME responder whitelist the
 * live socket gate applies — this is the flag-built second entrance the doc's "one gate, in one place"
 * requirement worried about, and these cases are what prove it is actually gated here too.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseTurnBriefArgs,
  runTurnBrief,
  runTurnBriefWith,
  turnBriefCommand,
} from "../../../../../cli/commands/turn/brief.js";
import { ridesFromFlags, startedFromFlags } from "../../../../../cli/commands/turn/briefCardFlags.js";
import { briefTargetFromFlags } from "../../../../../cli/commands/turn/briefTarget.js";
import { TURN_BRIEF_USAGE } from "../../../../../cli/commands/turn/usage.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import type { AskLifecycleEvent, CapturedEvent } from "../../../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent } from "../../../../../live/ask/store.js";
import type { ResponderWhitelist } from "../../../../../live/listen/whitelist.js";
import { defaultBriefPath } from "../../../../../live/turn/briefStore.js";
import { parseMemoryLeaf } from "../../../../../memory/corpus.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { ownerJudgementFake } from "../../../../ownerJudgementFixture.js";

/** A well-formed set of `turn brief` flag values, with per-test overrides. */
function valuesOf(over: Readonly<Record<string, string | boolean>> = {}): Readonly<Record<string, string | boolean>> {
  return { channel: "C1", "message-ts": "1.1", text: "why?", "thread-ts": "1.1", user: "U0OWNER", ...over };
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp home whose `responders.json` admits exactly `U0OWNER` — for CLI-level integration cases. */
function homeAdmittingU0Owner(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-brief-admit-"));
  fixtureDirs.push(home);
  writeFileSync(stateHomePaths({ home }).respondersJson, JSON.stringify(["U0OWNER"]), "utf8");
  return home;
}

/** A full `turn brief` argv asking one question under `home`. */
function queueQuestionArgv({ home }: { home: string }): readonly string[] {
  return [
    "node",
    "slopweaver",
    "turn",
    "brief",
    "--channel",
    "C1",
    "--message-ts",
    "1.1",
    "--thread-ts",
    "1.1",
    "--text",
    "is the acme queue healthy?",
    "--user",
    "U0OWNER",
    "--host",
    "claude-code",
    "--home",
    home,
  ];
}

const ADMITS_U0OWNER: ResponderWhitelist = { identities: ["U0OWNER"], kind: "list" };
const ABSENT: ResponderWhitelist = { kind: "absent" };
const EMPTY: ResponderWhitelist = { identities: [], kind: "list" };
const UNREADABLE: ResponderWhitelist = { kind: "unreadable", why: "responders.json is not valid JSON" };

describe("briefTargetFromFlags", () => {
  it("builds the target the listener would have parsed", () => {
    expect(
      briefTargetFromFlags({ responderAllowOpen: false, responderWhitelist: ADMITS_U0OWNER, values: valuesOf() }),
    ).toEqual({
      target: { channel: "C1", messageTs: "1.1", surface: "channel", text: "why?", threadTs: "1.1", userId: "U0OWNER" },
    });
  });

  it("names every missing required flag at once, not just the first — including --user", () => {
    expect(briefTargetFromFlags({ responderAllowOpen: false, responderWhitelist: ADMITS_U0OWNER, values: {} })).toEqual(
      {
        missing: ["--channel", "--message-ts", "--thread-ts", "--text", "--user"],
      },
    );
  });

  it("reads --surface dm, which is what makes the turn name the agent thread", () => {
    const built = briefTargetFromFlags({
      responderAllowOpen: false,
      responderWhitelist: ADMITS_U0OWNER,
      values: valuesOf({ channel: "D1", surface: "dm" }),
    });

    expect("target" in built ? built.target.surface : "not built").toBe("dm");
  });

  it("REFUSES an unrecognised --surface rather than silently falling back to channel", () => {
    expect(
      briefTargetFromFlags({
        responderAllowOpen: false,
        responderWhitelist: ADMITS_U0OWNER,
        values: valuesOf({ channel: "D1", surface: "DM" }),
      }),
    ).toEqual({ missing: ["--surface must be one of channel|dm, but got `DM`"] });
  });

  it("admits a whitelisted --user", () => {
    const built = briefTargetFromFlags({
      responderAllowOpen: false,
      responderWhitelist: ADMITS_U0OWNER,
      values: valuesOf(),
    });

    expect("target" in built).toBe(true);
  });

  it.each([
    ["nonmember", ADMITS_U0OWNER, "U0OTHER"],
    ["absent list", ABSENT, "U0OWNER"],
    ["empty list", EMPTY, "U0OWNER"],
    ["unreadable list", UNREADABLE, "U0OWNER"],
  ] as const)("refuses before building a target, for a %s", (_label, whitelist, userId) => {
    const built = briefTargetFromFlags({
      responderAllowOpen: false,
      responderWhitelist: whitelist,
      values: valuesOf({ user: userId }),
    });

    expect("refused" in built).toBe(true);
  });

  it("admits everyone via the break-glass override, even a nonmember against an absent list", () => {
    const built = briefTargetFromFlags({
      responderAllowOpen: true,
      responderWhitelist: ABSENT,
      values: valuesOf({ user: "U0OTHER" }),
    });

    expect("target" in built).toBe(true);
  });
});

describe("ridesFromFlags", () => {
  const target = { channel: "C1", messageTs: "1790141967.816599", threadTs: "1790137657.683209" };

  it("carries the parent ts, and nothing when the flag is absent", () => {
    expect(ridesFromFlags({ target, values: { rides: "1790146101.489459" } })).toEqual({
      ridesOn: "1790146101.489459",
    });
    expect(ridesFromFlags({ target, values: {} })).toEqual({ ridesOn: undefined });
  });

  it("refuses a --rides naming this ask itself", () => {
    expect(ridesFromFlags({ target, values: { rides: "1790141967.816599" } })).toEqual({
      error: `turn brief: --rides names the ask this one was dispatched from, never itself — got "1790141967.816599"`,
    });
  });
});

describe("startedFromFlags", () => {
  it("is absent when neither flag was given", () => {
    expect(startedFromFlags({ values: {} })).toEqual({ started: undefined });
  });

  it("carries both fields through when both were given", () => {
    expect(startedFromFlags({ values: { "turn-id": "turn-1", "working-ts": "1712345678.000300" } })).toEqual({
      started: { turnId: "turn-1", workingTs: "1712345678.000300" },
    });
  });

  it("REFUSES a --turn-id with no --working-ts, rather than silently posting a second checklist", () => {
    const result = startedFromFlags({ values: { "turn-id": "turn-1" } });

    expect("error" in result).toBe(true);
    expect("error" in result ? result.error : "not refused").toContain("must both be given, or neither");
  });

  it("REFUSES a --working-ts with no --turn-id", () => {
    const result = startedFromFlags({ values: { "working-ts": "1712345678.000300" } });

    expect("error" in result).toBe(true);
  });
});

describe("defaultBriefPath", () => {
  it("puts the brief under the state home, keyed by channel and the addressing message", () => {
    expect(
      defaultBriefPath({ askIdentity: { channel: "C1", messageTs: "2.2", threadTs: "1.1" }, home: "/state" }),
    ).toBe("/state/briefs/C1-2.2.json");
  });

  it("gives the same ask the same path, so re-briefing it overwrites rather than accumulating", () => {
    const askIdentity = { channel: "C1", messageTs: "2.2", threadTs: "1.1" };
    expect(defaultBriefPath({ askIdentity, home: "/state" })).toBe(defaultBriefPath({ askIdentity, home: "/state" }));
  });

  it("gives two different asks in the SAME thread two different paths", () => {
    const first = defaultBriefPath({
      askIdentity: { channel: "C1", messageTs: "1.1", threadTs: "1.1" },
      home: "/state",
    });
    const second = defaultBriefPath({
      askIdentity: { channel: "C1", messageTs: "2.2", threadTs: "1.1" },
      home: "/state",
    });
    expect(first).not.toBe(second);
  });
});

describe("turn brief usage", () => {
  it("declares every flag the parser accepts", () => {
    for (const flag of [
      "--channel",
      "--message-ts",
      "--thread-ts",
      "--text",
      "--user",
      "--surface",
      "--mode",
      "--host",
      "--out",
    ]) {
      expect(TURN_BRIEF_USAGE).toContain(flag);
    }
  });

  it("states --user as required, not bracketed as optional", () => {
    expect(TURN_BRIEF_USAGE).toContain("--text <mention text> --user <id>");
  });

  it("states that it loads no world model and runs no model, which is the reason it exists", () => {
    expect(TURN_BRIEF_USAGE).toContain("loads no world model, and runs no model");
  });
});

describe("turn brief refusals", () => {
  it("refuses with a usage code when the required flags are absent, before any effect", async () => {
    expect(await runTurnBrief(["node", "slopweaver", "turn", "brief"])).toBe(EXIT_USAGE);
  });

  it("refuses an unknown flag rather than ignoring it", async () => {
    expect(await runTurnBrief(["node", "slopweaver", "turn", "brief", "--not-a-flag", "x"])).toBe(EXIT_USAGE);
  });

  it("does not mistake its own verb token for a stray argument", () => {
    const argv = ["node", "slopweaver", "turn", "brief", "--channel", "C1", "--thread-ts", "1.1", "--text", "why?"];
    const parsed = parseTurnBriefArgs({ rest: argv.slice(4) });

    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.positionals : ["not parsed"]).toEqual([]);
  });

  it("would reject the verb token if the offset were wrong, which makes the test above falsifiable", () => {
    const parsed = parseTurnBriefArgs({ rest: ["node", "slopweaver", "turn", "brief"].slice(3) });

    expect(parsed.isOk()).toBe(false);
    expect(parsed.isOk() ? [] : parsed.error).toEqual(["unexpected argument: brief"]);
  });

  it("exposes the command the manifest lazily loads", () => {
    expect(turnBriefCommand).toBe(runTurnBrief);
  });

  it("refuses a partial --turn-id/--working-ts pair before touching the corpus", async () => {
    const argv = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--thread-ts",
      "1.1",
      "--text",
      "why?",
      "--user",
      "U0OWNER",
      "--turn-id",
      "turn-1",
      "--host",
      "claude-code",
      "--home",
      homeAdmittingU0Owner(),
    ];

    expect(await runTurnBrief(argv)).toBe(EXIT_USAGE);
  });

  it("refuses with an EXPECTED-EMPTY code, not usage, when the responder whitelist is absent — a real invocation, an expected denial", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-brief-refuse-"));
    fixtureDirs.push(home);
    const argv = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--thread-ts",
      "1.1",
      "--text",
      "why?",
      "--user",
      "U0OWNER",
      "--home",
      home,
    ];

    expect(await runTurnBrief(argv)).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("offers a private profile's live capability to the judgement, once the profile declares it", async () => {
    const home = homeAdmittingU0Owner();
    writeFileSync(
      stateHomePaths({ home }).capabilityProfileJson,
      JSON.stringify({
        capabilities: [
          {
            availability: { kind: "available" },
            command: ["private-cli", "github", "vulnerability-report"],
            coverage: { detail: "every open Dependabot advisory across the tracked repos", kind: "complete" },
            effect: "read",
            freshness: { detail: "measured from the GitHub API when called", kind: "live" },
            id: "github-vulnerability-report",
            owner: "private-cli",
            sourceClass: "provider",
            terms: ["vulnerability", "vulnerabilities"],
            truthMode: "current",
            what: "open security vulnerabilities across the tracked repositories",
          },
        ],
        schemaVersion: 1,
      }),
      "utf8",
    );
    const argv = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--thread-ts",
      "1.1",
      "--text",
      "how many critical vulnerabilities are there?",
      "--user",
      "U0OWNER",
      "--host",
      "claude-code",
      "--home",
      home,
    ];

    expect(await runTurnBrief(argv)).toBe(0);
    const brief = JSON.parse(
      readFileSync(
        defaultBriefPath({ askIdentity: { channel: "C1", messageTs: "1.1", threadTs: "1.1" }, home }),
        "utf8",
      ),
    );
    const ids = brief.routingInput.availableCapabilities.map((capability: { id: string }) => capability.id);
    expect(ids).toContain("github-vulnerability-report");
    expect(brief.routingInput.execution).toEqual({ mode: "single-turn", supervisorHost: "claude-code" });
  });

  it("embeds a newly recorded owner directive into the very next real turn brief", async () => {
    const home = homeAdmittingU0Owner();
    const directiveMemory = parseMemoryLeaf({
      file: "verified_fallback.md",
      text:
        "---\nname: verified-fallback\ndescription: use the verified fallback when finalization is broken\n" +
        "metadata:\n  type: feedback\n  slopweaver:\n    ownerDirective: true\n---\n",
    });
    const store = ownerJudgementFake();
    unwrap(await store.port.syncFromMemory({ home, leaves: [directiveMemory] }));
    const argv = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--thread-ts",
      "1.1",
      "--text",
      "the normal finalizer broke again",
      "--user",
      "U0OWNER",
      "--host",
      "claude-code",
      "--home",
      home,
    ];

    expect(await runTurnBriefWith({ argv, ownerJudgement: store.port })).toBe(0);
    const brief = JSON.parse(
      readFileSync(
        defaultBriefPath({ askIdentity: { channel: "C1", messageTs: "1.1", threadTs: "1.1" }, home }),
        "utf8",
      ),
    );
    expect(
      brief.routingInput.ownerDirectives.map((directive: { id: string; text: string }) => ({
        id: directive.id,
        text: directive.text,
      })),
    ).toEqual([{ id: "verified-fallback", text: "use the verified fallback when finalization is broken" }]);
  });

  it("refuses the turn, and writes no brief, when the owner-judgement store cannot be read", async () => {
    const home = homeAdmittingU0Owner();
    const store = ownerJudgementFake({ connection: "unavailable" });

    expect(await runTurnBriefWith({ argv: queueQuestionArgv({ home }), ownerJudgement: store.port })).toBe(EXIT_ERROR);
    expect(
      existsSync(defaultBriefPath({ askIdentity: { channel: "C1", messageTs: "1.1", threadTs: "1.1" }, home })),
    ).toBe(false);
  });

  it("carries no owner directives when the store answers an empty authority", async () => {
    const home = homeAdmittingU0Owner();

    expect(
      await runTurnBriefWith({ argv: queueQuestionArgv({ home }), ownerJudgement: ownerJudgementFake().port }),
    ).toBe(0);
    const brief = JSON.parse(
      readFileSync(
        defaultBriefPath({ askIdentity: { channel: "C1", messageTs: "1.1", threadTs: "1.1" }, home }),
        "utf8",
      ),
    );
    expect(brief.routingInput.ownerDirectives).toBe(undefined);
  });

  /**
   * The checklist-freeze fix: `skills/loop/SKILL.md` telling the driving session to carry `started` forward by
   * hand is a prompt convention, not a guarantee. This proves the code-level fallback — `listen`'s durable
   * `checklist-posted` event recovers the ref even when the caller never passed `--turn-id`/`--working-ts`.
   */
  it("recovers `started` from the ask-lifecycle log when --turn-id/--working-ts were never passed", async () => {
    const home = homeAdmittingU0Owner();
    const captured: CapturedEvent = {
      channel: "C1",
      kind: "captured",
      messageTs: "1.1",
      surface: "channel",
      threadTs: "1.1",
      tsIso: "2026-08-13T00:00:00.000Z",
      userId: "U0OWNER",
    };
    const posted: AskLifecycleEvent = {
      ...captured,
      kind: "checklist-posted",
      turnId: "turn-recovered",
      workingTs: "1785000000.000900",
    };
    appendAskLifecycleEvent({ event: captured, home });
    appendAskLifecycleEvent({ event: posted, home });
    const argv = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--thread-ts",
      "1.1",
      "--text",
      "why?",
      "--user",
      "U0OWNER",
      "--host",
      "claude-code",
      "--home",
      home,
    ];

    expect(await runTurnBrief(argv)).toBe(0);
    const brief = JSON.parse(
      readFileSync(
        defaultBriefPath({ askIdentity: { channel: "C1", messageTs: "1.1", threadTs: "1.1" }, home }),
        "utf8",
      ),
    );
    expect(brief.started).toEqual({ turnId: "turn-recovered", workingTs: "1785000000.000900" });
  });

  it("uses the flags when they agree with the durable log, rather than refusing over an exact match", async () => {
    const home = homeAdmittingU0Owner();
    const captured: CapturedEvent = {
      channel: "C1",
      kind: "captured",
      messageTs: "1.1",
      surface: "channel",
      threadTs: "1.1",
      tsIso: "2026-08-13T00:00:00.000Z",
      userId: "U0OWNER",
    };
    const posted: AskLifecycleEvent = {
      ...captured,
      kind: "checklist-posted",
      turnId: "turn-agreed",
      workingTs: "1785000000.000900",
    };
    appendAskLifecycleEvent({ event: captured, home });
    appendAskLifecycleEvent({ event: posted, home });
    const argv = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--thread-ts",
      "1.1",
      "--text",
      "why?",
      "--user",
      "U0OWNER",
      "--host",
      "claude-code",
      "--home",
      home,
      "--turn-id",
      "turn-agreed",
      "--working-ts",
      "1785000000.000900",
    ];

    expect(await runTurnBrief(argv)).toBe(0);
    const brief = JSON.parse(
      readFileSync(
        defaultBriefPath({ askIdentity: { channel: "C1", messageTs: "1.1", threadTs: "1.1" }, home }),
        "utf8",
      ),
    );
    expect(brief.started).toEqual({ turnId: "turn-agreed", workingTs: "1785000000.000900" });
  });

  it("REFUSES rather than silently trusting the flags when they disagree with the durable log", async () => {
    const home = homeAdmittingU0Owner();
    const captured: CapturedEvent = {
      channel: "C1",
      kind: "captured",
      messageTs: "1.1",
      surface: "channel",
      threadTs: "1.1",
      tsIso: "2026-08-13T00:00:00.000Z",
      userId: "U0OWNER",
    };
    const posted: AskLifecycleEvent = {
      ...captured,
      kind: "checklist-posted",
      turnId: "turn-from-log",
      workingTs: "1785000000.000900",
    };
    appendAskLifecycleEvent({ event: captured, home });
    appendAskLifecycleEvent({ event: posted, home });
    const briefPath = defaultBriefPath({ askIdentity: { channel: "C1", messageTs: "1.1", threadTs: "1.1" }, home });
    const argv = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--thread-ts",
      "1.1",
      "--text",
      "why?",
      "--user",
      "U0OWNER",
      "--host",
      "claude-code",
      "--home",
      home,
      "--turn-id",
      "turn-from-flags",
      "--working-ts",
      "1785000000.111100",
    ];

    expect(await runTurnBrief(argv)).toBe(EXIT_ERROR);
    expect(existsSync(briefPath)).toBe(false);
  });

  it("has no `started` at all when neither flags nor the durable log carry one", async () => {
    const home = homeAdmittingU0Owner();
    const argv = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--thread-ts",
      "1.1",
      "--text",
      "why?",
      "--user",
      "U0OWNER",
      "--host",
      "claude-code",
      "--home",
      home,
    ];

    expect(await runTurnBrief(argv)).toBe(0);
    const brief = JSON.parse(
      readFileSync(
        defaultBriefPath({ askIdentity: { channel: "C1", messageTs: "1.1", threadTs: "1.1" }, home }),
        "utf8",
      ),
    );
    expect("started" in brief).toBe(false);
  });

  /**
   * MEASURED DATA LOSS: a session that only wanted to read a capability contract re-ran
   * `turn brief` with a throwaway `--text` on an ask that already had a started turn, and the write
   * silently destroyed the live turn's own pinned question. This is the fix for that half of the defect.
   */
  it("refuses to overwrite a brief whose ask has a started turn", async () => {
    const home = homeAdmittingU0Owner();
    const briefPath = defaultBriefPath({ askIdentity: { channel: "C1", messageTs: "1.1", threadTs: "1.1" }, home });
    const captured: CapturedEvent = {
      channel: "C1",
      kind: "captured",
      messageTs: "1.1",
      surface: "channel",
      threadTs: "1.1",
      tsIso: "2026-08-29T09:19:00.000Z",
      userId: "U0OWNER",
    };
    const posted: AskLifecycleEvent = {
      ...captured,
      kind: "checklist-posted",
      turnId: "turn-live",
      workingTs: "1785000000.000900",
    };
    appendAskLifecycleEvent({ event: captured, home });
    appendAskLifecycleEvent({ event: posted, home });
    const firstCall = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--thread-ts",
      "1.1",
      "--text",
      "the real question, pinned",
      "--user",
      "U0OWNER",
      "--host",
      "claude-code",
      "--home",
      home,
      "--turn-id",
      "turn-live",
      "--working-ts",
      "1785000000.000900",
    ];
    expect(await runTurnBrief(firstCall)).toBe(0);

    const secondCall = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--thread-ts",
      "1.1",
      "--text",
      "x",
      "--user",
      "U0OWNER",
      "--host",
      "claude-code",
      "--home",
      home,
    ];
    expect(await runTurnBrief(secondCall)).toBe(EXIT_ERROR);

    const brief = JSON.parse(readFileSync(briefPath, "utf8"));
    expect(brief.question).toBe("the real question, pinned");
    expect(brief.routingInput.context.controlPlane.ownerAddressingText).toBe("the real question, pinned");
  });

  it("--force overwrites a brief whose ask has a started turn, when the caller says so explicitly", async () => {
    const home = homeAdmittingU0Owner();
    const briefPath = defaultBriefPath({ askIdentity: { channel: "C1", messageTs: "1.1", threadTs: "1.1" }, home });
    const captured: CapturedEvent = {
      channel: "C1",
      kind: "captured",
      messageTs: "1.1",
      surface: "channel",
      threadTs: "1.1",
      tsIso: "2026-08-29T09:19:00.000Z",
      userId: "U0OWNER",
    };
    const posted: AskLifecycleEvent = {
      ...captured,
      kind: "checklist-posted",
      turnId: "turn-live",
      workingTs: "1785000000.000900",
    };
    appendAskLifecycleEvent({ event: captured, home });
    appendAskLifecycleEvent({ event: posted, home });
    const firstCall = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--thread-ts",
      "1.1",
      "--text",
      "the real question, pinned",
      "--user",
      "U0OWNER",
      "--host",
      "claude-code",
      "--home",
      home,
      "--turn-id",
      "turn-live",
      "--working-ts",
      "1785000000.000900",
    ];
    expect(await runTurnBrief(firstCall)).toBe(0);

    const secondCall = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--thread-ts",
      "1.1",
      "--text",
      "deliberately re-briefing this exact turn",
      "--user",
      "U0OWNER",
      "--host",
      "claude-code",
      "--home",
      home,
      "--force",
    ];
    expect(await runTurnBrief(secondCall)).toBe(0);

    const brief = JSON.parse(readFileSync(briefPath, "utf8"));
    expect(brief.question).toBe("deliberately re-briefing this exact turn");
  });

  it("--contracts prints the capability contracts and writes no brief — the read-only door", async () => {
    const home = homeAdmittingU0Owner();
    writeFileSync(
      stateHomePaths({ home }).capabilityProfileJson,
      JSON.stringify({
        capabilities: [
          {
            availability: { kind: "available" },
            command: ["private-cli", "github", "vulnerability-report"],
            coverage: { detail: "every open Dependabot advisory across the tracked repos", kind: "complete" },
            effect: "read",
            freshness: { detail: "measured from the GitHub API when called", kind: "live" },
            id: "github-vulnerability-report",
            owner: "private-cli",
            sourceClass: "provider",
            terms: ["vulnerability", "vulnerabilities"],
            truthMode: "current",
            what: "open security vulnerabilities across the tracked repositories",
          },
        ],
        schemaVersion: 1,
      }),
      "utf8",
    );
    const argv = ["node", "slopweaver", "turn", "brief", "--contracts", "--text", "any question", "--home", home];

    expect(await runTurnBrief(argv)).toBe(0);
    expect(
      existsSync(defaultBriefPath({ askIdentity: { channel: "C1", messageTs: "1.1", threadTs: "1.1" }, home })),
    ).toBe(false);
  });

  it("--contracts still requires --text, since there is no question to materialise a capability's command against", async () => {
    const argv = ["node", "slopweaver", "turn", "brief", "--contracts", "--home", homeAdmittingU0Owner()];

    expect(await runTurnBrief(argv)).toBe(EXIT_USAGE);
  });
});
