/**
 * The four `talk` verbs the CLI can dispatch, driven through their real runners. `talk find-card` is driven to its
 * help and its usage refusal here; its board read is `subprocess/cli/commands/talk/findCard.test.ts`.
 *
 * `talk code` runs against a git checkout this file builds in a temp directory, and `talk relay` and
 * `talk log` against a `$SLOPWEAVER_HOME` this file mints — never the ambient one, per `testing.md`. `talk
 * offer` is driven only up to its usage refusals here: past them it resolves the vendored Codex CLI and the owner's
 * MCP servers, which `planLaunch.test.ts` and `planSession.test.ts` cover as pure functions.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runTalkCheckIns, runTalkCheckInsOver } from "../../../cli/commands/talk/checkInsRun.js";
import { runTalkCode } from "../../../cli/commands/talk/codeRun.js";
import { runTalkFile } from "../../../cli/commands/talk/fileRun.js";
import { runTalkFindCard } from "../../../cli/commands/talk/findCardRun.js";
import { runTalkLog } from "../../../cli/commands/talk/logRun.js";
import { runTalkOffer } from "../../../cli/commands/talk/offerRun.js";
import { runTalkPack } from "../../../cli/commands/talk/packRun.js";
import { runTalkRelay } from "../../../cli/commands/talk/relayRun.js";
import { runTalkSteers } from "../../../cli/commands/talk/steersRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { talkManifest } from "../../../cli/manifests/talk.js";
import { talkCallReadsManifest } from "../../../cli/manifests/talkCallReads.js";
import { talkCallsManifest } from "../../../cli/manifests/talkCalls.js";
import { talkChairManifest } from "../../../cli/manifests/talkChair.js";
import { talkFilesManifest } from "../../../cli/manifests/talkFiles.js";
import { talkListManifest } from "../../../cli/manifests/talkList.js";
import { talkUnreadManifest } from "../../../cli/manifests/talkUnread.js";
import { memoryAutonomyLedgerPort, unavailableAutonomyLedgerPort } from "../../autonomyLedgerFixture.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** The argv a verb really receives: `[node, bin, noun, verb, ...flags]`. */
const argvFor = ({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "talk",
  verb,
  ...rest,
];

const TURN = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "talk-verbs-"));
});

afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

describe("the talk manifest", () => {
  it("registers exactly the forty-six verbs this noun ships", () => {
    expect(Object.keys(talkManifest).toSorted()).toEqual([
      "attach",
      "call-thread",
      "call-thread-append",
      "call-tools",
      "calls",
      "capabilities",
      "cards",
      "check-ins",
      "code",
      "courier",
      "cursor-retire",
      "cut-ins",
      "fidelity",
      "file",
      "find-card",
      "glossary",
      "history",
      "knowledge",
      "land",
      "laps",
      "list",
      "list-add",
      "log",
      "meeting-due",
      "offer",
      "origin",
      "pack",
      "quarantine",
      "recall",
      "recent",
      "relay",
      "restore",
      "row",
      "slack-after",
      "slack-channel",
      "slack-open",
      "slack-send-outcome",
      "steer-risk",
      "steers",
      "supervisor",
      "thread",
      "transcript",
      "unread",
      "unread-adopt",
      "verb",
      "wake-chair",
    ]);
  });

  it("spreads `attach`, `code` and `file` in from their own manifest module, the same entries", () => {
    expect(Object.keys(talkFilesManifest)).toEqual(["attach", "code", "file"]);
    expect(talkManifest["file"]).toBe(talkFilesManifest["file"]);
    expect(talkManifest["attach"]).toBe(talkFilesManifest["attach"]);
  });

  it("spreads `cut-ins` and `fidelity` in from the call-record reads' own manifest module, the same entries", () => {
    expect(Object.keys(talkCallReadsManifest)).toEqual(["cut-ins", "fidelity"]);
    expect(talkManifest["cut-ins"]).toBe(talkCallReadsManifest["cut-ins"]);
    expect(talkManifest["fidelity"]).toBe(talkCallReadsManifest["fidelity"]);
  });

  it("spreads `courier` and `wake-chair` in from the chair's own manifest module, the same entries", () => {
    expect(Object.keys(talkChairManifest)).toEqual(["courier", "wake-chair"]);
    expect(talkManifest["courier"]).toBe(talkChairManifest["courier"]);
  });

  it("spreads the unread cursor's four verbs in from their own manifest module, the same entries, each writing", () => {
    expect(Object.keys(talkUnreadManifest)).toEqual(["cursor-retire", "quarantine", "unread", "unread-adopt"]);
    expect(talkManifest["unread-adopt"]).toBe(talkUnreadManifest["unread-adopt"]);
    expect(talkManifest["quarantine"]).toBe(talkUnreadManifest["quarantine"]);
    expect(Object.values(talkUnreadManifest).map((entry) => entry.meta.effect)).toEqual([
      "local-state",
      "local-state",
      "local-state",
      "local-state",
    ]);
  });

  it("spreads `list` and `list-add` in from their own manifest module, the same entries, only the add writing", () => {
    expect(Object.keys(talkListManifest)).toEqual(["list", "list-add"]);
    expect(talkManifest["list"]).toBe(talkListManifest["list"]);
    expect(talkManifest["list-add"]).toBe(talkListManifest["list-add"]);
    expect([talkListManifest["list"]!.meta.effect, talkListManifest["list-add"]!.meta.effect]).toEqual([
      "none",
      "local-state",
    ]);
  });

  it("spreads the call reads and the thread journal's writer in from their own manifest module, only the writer writing", () => {
    expect(Object.keys(talkCallsManifest)).toEqual(["call-thread", "call-thread-append", "call-tools", "calls"]);
    expect(talkManifest["calls"]).toBe(talkCallsManifest["calls"]);
    expect(talkManifest["call-tools"]).toBe(talkCallsManifest["call-tools"]);
    expect(talkManifest["call-thread"]).toBe(talkCallsManifest["call-thread"]);
    expect(talkManifest["call-thread-append"]).toBe(talkCallsManifest["call-thread-append"]);
    expect(Object.values(talkCallsManifest).map((entry) => entry.meta.effect)).toEqual([
      "none",
      "local-state",
      "none",
      "none",
    ]);
  });

  it("declares `offer`, the `verb` gateway and the four Slack reads as the external reaches, and `relay` as local state", () => {
    expect(talkManifest["offer"]!.meta.effect).toBe("external-read");
    expect(talkManifest["verb"]!.meta.effect).toBe("external-read");
    expect(talkManifest["slack-after"]!.meta.effect).toBe("external-read");
    expect(talkManifest["slack-channel"]!.meta.effect).toBe("external-read");
    expect(talkManifest["slack-open"]!.meta.effect).toBe("external-read");
    expect(talkManifest["slack-send-outcome"]!.meta.effect).toBe("external-read");
    expect(talkManifest["relay"]!.meta.effect).toBe("local-state");
    expect(talkManifest["pack"]!.meta.effect).toBe("local-state");
    expect(talkManifest["code"]!.meta.effect).toBe("none");
    expect(talkManifest["file"]!.meta.effect).toBe("none");
    expect(talkManifest["log"]!.meta.effect).toBe("none");
    expect(talkManifest["row"]!.meta.effect).toBe("none");
    expect(talkManifest["glossary"]!.meta.effect).toBe("none");
    expect(talkManifest["origin"]!.meta.effect).toBe("none");
    expect(talkManifest["knowledge"]!.meta.effect).toBe("none");
    expect(talkManifest["history"]!.meta.effect).toBe("none");
    expect(talkManifest["recall"]!.meta.effect).toBe("none");
    expect(talkManifest["recent"]!.meta.effect).toBe("none");
    expect(talkManifest["calls"]!.meta.effect).toBe("none");
    expect(talkManifest["cut-ins"]!.meta.effect).toBe("none");
    expect(talkManifest["capabilities"]!.meta.effect).toBe("none");
    expect(talkManifest["find-card"]!.meta.effect).toBe("none");
    expect(talkManifest["transcript"]!.meta.effect).toBe("local-state");
    expect(talkManifest["unread"]!.meta.effect).toBe("local-state");
    expect(talkManifest["wake-chair"]!.meta.effect).toBe("local-state");
    expect(talkManifest["courier"]!.meta.effect).toBe("local-state");
  });

  it("says `relay`, `transcript` and `land` create work — each can land the owner's words as a row — and nothing else does", () => {
    expect(talkManifest["relay"]!.meta.createsWorkItem).toBe(true);
    expect(Object.keys(talkManifest).filter((verb) => talkManifest[verb]!.meta.createsWorkItem)).toEqual([
      "land",
      "relay",
      "transcript",
    ]);
  });

  it("loads each verb's own run function through its own lazy import", async () => {
    const loaded = await Promise.all(Object.values(talkManifest).map(async (entry) => entry.load()));
    // The verbs `talkKnow.ts` declares are spread in first, then `talkCalls.ts`'s and the rest of the noun,
    // `talkCallReads.ts`'s, `talkFiles.ts`'s and `talkUnread.ts`'s in order, and `talkChair.ts`'s last.
    expect(loaded.map((run) => run.name)).toEqual([
      "runTalkCapabilities",
      "runTalkFindCard",
      "runTalkGlossary",
      "runTalkHistory",
      "runTalkKnowledge",
      "runTalkMeetingDue",
      "runTalkOrigin",
      "runTalkRecall",
      "runTalkRecent",
      "runTalkSlackAfter",
      "runTalkSlackChannel",
      "runTalkSlackOpen",
      "runTalkSlackSendOutcome",
      "runTalkSteerRisk",
      "runTalkCallThread",
      "runTalkCallThreadAppend",
      "runTalkCallTools",
      "runTalkCalls",
      "runTalkCards",
      "runTalkCheckIns",
      "runTalkCutIns",
      "runTalkFidelity",
      "runTalkAttach",
      "runTalkCode",
      "runTalkFile",
      "runTalkLand",
      "runTalkLaps",
      "runTalkList",
      "runTalkListAdd",
      "runTalkLog",
      "runTalkOffer",
      "runTalkPack",
      "runTalkRelay",
      "runTalkRestore",
      "runTalkRow",
      "runTalkSteers",
      "runTalkSupervisor",
      "runTalkThread",
      "runTalkTranscript",
      "runTalkCursorRetire",
      "runTalkQuarantine",
      "runTalkUnread",
      "runTalkUnreadAdopt",
      "runTalkVerb",
      "runTalkCourier",
      "runTalkWakeChair",
    ]);
  });
});

describe("--help", () => {
  it("prints usage and exits ok for every verb, without touching anything", async () => {
    expect(runTalkCode(argvFor({ rest: ["--help"], verb: "code" }))).toBe(EXIT_OK);
    expect(await runTalkFile(argvFor({ rest: ["--help"], verb: "file" }))).toBe(EXIT_OK);
    expect(runTalkLog(argvFor({ rest: ["--help"], verb: "log" }))).toBe(EXIT_OK);
    expect(await runTalkRelay(argvFor({ rest: ["--help"], verb: "relay" }))).toBe(EXIT_OK);
    expect(await runTalkOffer(argvFor({ rest: ["--help"], verb: "offer" }))).toBe(EXIT_OK);
    expect(await runTalkPack(argvFor({ rest: ["--help"], verb: "pack" }))).toBe(EXIT_OK);
    expect(await runTalkSteers(argvFor({ rest: ["--help"], verb: "steers" }))).toBe(EXIT_OK);
    expect(await runTalkFindCard(argvFor({ rest: ["--help"], verb: "find-card" }))).toBe(EXIT_OK);
  });
});

describe("usage refusals", () => {
  it("refuses `talk code` with no mode", () => {
    expect(runTalkCode(argvFor({ rest: [], verb: "code" }))).toBe(EXIT_USAGE);
  });

  it("refuses `talk find-card` with no words to search on", async () => {
    expect(await runTalkFindCard(argvFor({ rest: ["--home", scratch], verb: "find-card" }))).toBe(EXIT_USAGE);
  });

  it("refuses `talk code find` with no needle", () => {
    expect(runTalkCode(argvFor({ rest: ["find"], verb: "code" }))).toBe(EXIT_USAGE);
  });

  it("refuses `talk relay` with no turn", async () => {
    expect(await runTalkRelay(argvFor({ rest: ["--say", "look at staging"], verb: "relay" }))).toBe(EXIT_USAGE);
  });

  it("refuses `talk offer --funding api-key`, a fallback that no longer exists", async () => {
    expect(await runTalkOffer(argvFor({ rest: ["--funding", "api-key"], verb: "offer" }))).toBe(EXIT_USAGE);
  });

  it("refuses `talk offer` in a voice the plan does not have", async () => {
    expect(await runTalkOffer(argvFor({ rest: ["--voice", "cedar"], verb: "offer" }))).toBe(EXIT_USAGE);
  });

  it("refuses `talk pack` with a flag it does not know", async () => {
    expect(await runTalkPack(argvFor({ rest: ["--since", "1d"], verb: "pack" }))).toBe(EXIT_USAGE);
  });

  it("refuses `talk log` with a limit that is not a number", () => {
    expect(runTalkLog(argvFor({ rest: ["--limit", "soon"], verb: "log" }))).toBe(EXIT_USAGE);
  });

  it("refuses `talk check-ins` with a skip that is not a number", async () => {
    expect(await runTalkCheckIns(argvFor({ rest: ["--skip", "two", "--home", scratch], verb: "check-ins" }))).toBe(
      EXIT_USAGE,
    );
  });
});

describe("talk check-ins, over a minted home", () => {
  it("prints usage", async () => {
    expect(await runTalkCheckIns(argvFor({ rest: ["--help"], verb: "check-ins" }))).toBe(EXIT_OK);
  });

  it("reads an install with an empty autonomy ledger as no check-ins", async () => {
    const argv = argvFor({ rest: ["--home", scratch], verb: "check-ins" });
    expect(await runTalkCheckInsOver({ argv, ledger: memoryAutonomyLedgerPort() })).toBe(EXIT_OK);
  });

  it("fails, rather than reading the owner an empty list, when the autonomy ledger's store is down", async () => {
    const argv = argvFor({ rest: ["--home", scratch], verb: "check-ins" });
    expect(await runTalkCheckInsOver({ argv, ledger: unavailableAutonomyLedgerPort() })).toBe(EXIT_ERROR);
  });
});

describe("talk steers, over a minted home", () => {
  it("reads an install with no relays as no steers, and refuses a flag it does not know", async () => {
    expect(await runTalkSteers(argvFor({ rest: ["--home", scratch, "--json"], verb: "steers" }))).toBe(EXIT_OK);
    expect(await runTalkSteers(argvFor({ rest: ["--since", "1d"], verb: "steers" }))).toBe(EXIT_USAGE);
  });

  it("fails, rather than reporting no steers, when the relay ledger does not read", async () => {
    mkdirSync(join(scratch, "talk"), { recursive: true });
    writeFileSync(join(scratch, "talk", "relays.jsonl"), "{not json\n");
    expect(await runTalkSteers(argvFor({ rest: ["--home", scratch], verb: "steers" }))).toBe(EXIT_ERROR);
  });
});

describe("talk code, over a real checkout", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  let root: string;

  beforeEach(() => {
    root = join(scratch, "repo");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "kept.ts"), "export const needle = 42;\n");
    writeFileSync(join(root, "README.md"), "no match here\n");
    writeFileSync(join(root, "untracked.ts"), "export const needle = 0;\n");
    gitInTemp({ args: ["init", "-q", root], cwd: scratch });
    gitInTemp({ args: ["config", "user.email", "t@example.com"], cwd: root });
    gitInTemp({ args: ["config", "user.name", "t"], cwd: root });
    gitInTemp({ args: ["add", "src/kept.ts", "README.md"], cwd: root });
    gitInTemp({ args: ["commit", "-qm", "fixture"], cwd: root });
  });

  it("lists the tracked files and leaves the untracked one out", () => {
    expect(runTalkCode(argvFor({ rest: ["list", "--cwd", root], verb: "code" }))).toBe(EXIT_OK);
  });

  it("finds a literal in a tracked file", () => {
    expect(runTalkCode(argvFor({ rest: ["find", "--text", "needle", "--cwd", root], verb: "code" }))).toBe(EXIT_OK);
  });

  it("reads a tracked file", () => {
    expect(runTalkCode(argvFor({ rest: ["read", "--path", "src/kept.ts", "--cwd", root], verb: "code" }))).toBe(
      EXIT_OK,
    );
  });

  it("refuses to read an UNTRACKED file that is really sitting there", () => {
    expect(existsSync(join(root, "untracked.ts"))).toBe(true);
    expect(runTalkCode(argvFor({ rest: ["read", "--path", "untracked.ts", "--cwd", root], verb: "code" }))).toBe(
      EXIT_ERROR,
    );
  });

  it("refuses outside a checkout rather than answering about the wrong tree", () => {
    expect(runTalkCode(argvFor({ rest: ["list", "--cwd", scratch], verb: "code" }))).toBe(EXIT_ERROR);
  });
});

describe("talk relay and talk log, against a home this file minted", () => {
  let home: string;
  let dir: string;

  beforeEach(() => {
    home = join(scratch, "home");
    dir = join(scratch, "handovers");
    mkdirSync(home, { recursive: true });
    mkdirSync(dir, { recursive: true });
  });

  const relay = async ({ say }: { say: string }): Promise<number> =>
    runTalkRelay(
      argvFor({
        rest: ["--turn", TURN, "--say", say, "--home", home, "--dir", dir, "--json"],
        verb: "relay",
      }),
    );

  it("registers a pressed draft as a board row carrying the turn's own anchor", async () => {
    expect(await relay({ say: "look at why the staging pool exhausted" })).toBe(EXIT_OK);
    const path = join(dir, "talk-7c1d2e3f4a5b.md");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain(`talk:${TURN}`);
  });

  it("is idempotent on its turn — a second press registers nothing new", async () => {
    expect(await relay({ say: "look at why the staging pool exhausted" })).toBe(EXIT_OK);
    expect(await relay({ say: "look at why the staging pool exhausted" })).toBe(EXIT_OK);
  });

  it("prints the receipt the press left behind, and says nothing about it being seen", async () => {
    expect(await relay({ say: "look at why the staging pool exhausted" })).toBe(EXIT_OK);
    expect(runTalkLog(argvFor({ rest: ["--home", home, "--json"], verb: "log" }))).toBe(EXIT_OK);
  });

  it("says nothing has been relayed on an install where nothing has", () => {
    expect(runTalkLog(argvFor({ rest: ["--home", home], verb: "log" }))).toBe(EXIT_OK);
  });
});

describe("talk relay carrying the owner's words only and a picture of their screen", () => {
  let home: string;
  let dir: string;

  /** A WebP container around one 64-byte `VP8 ` chunk — all the verb checks, since it never decodes. */
  const webp = ({ fill }: { fill: number }): Buffer => {
    const head = Buffer.alloc(20);
    head.write("RIFF", 0, "latin1");
    head.writeUInt32LE(12 + 64, 4);
    head.write("WEBPVP8 ", 8, "latin1");
    head.writeUInt32LE(64, 16);
    return Buffer.concat([head, Buffer.alloc(64, fill)]);
  };

  beforeEach(() => {
    home = join(scratch, "home");
    dir = join(scratch, "handovers");
    mkdirSync(home, { recursive: true });
    mkdirSync(dir, { recursive: true });
  });

  const relay = async ({ screen }: { screen: string }): Promise<number> =>
    runTalkRelay(
      argvFor({
        rest: [
          "--turn",
          TURN,
          "--heard",
          "the queue shows a raw user id, show the name instead",
          "--read-after",
          "read_screen",
          "--screen",
          screen,
          "--home",
          home,
          "--dir",
          dir,
          "--json",
        ],
        verb: "relay",
      }),
    );

  it("keeps the frame beside the turn and names it on a row that carries the owner's words and no reading", async () => {
    const screen = join(scratch, "screen.webp");
    writeFileSync(screen, webp({ fill: 1 }));
    expect(await relay({ screen })).toBe(EXIT_OK);
    const kept = join(home, "talk", "turns", `${TURN}.webp`);
    expect(readFileSync(kept)).toEqual(webp({ fill: 1 }));
    const row = readFileSync(join(dir, "talk-7c1d2e3f4a5b.md"), "utf8");
    expect(row).toContain(kept);
    expect(row).toContain(
      "The voice's reading was dropped, so this row carries the owner's words and nothing else (it had text the owner did not say " +
        "in front of it: read screen): act only if the owner's words are themselves a steer",
    );
  });

  it("accepts a retry carrying the same frame, and refuses one carrying a different frame on the same turn", async () => {
    const screen = join(scratch, "screen.webp");
    writeFileSync(screen, webp({ fill: 1 }));
    expect(await relay({ screen })).toBe(EXIT_OK);
    expect(await relay({ screen })).toBe(EXIT_OK);
    writeFileSync(screen, webp({ fill: 2 }));
    expect(await relay({ screen })).toBe(EXIT_ERROR);
    expect(readFileSync(join(home, "talk", "turns", `${TURN}.webp`))).toEqual(webp({ fill: 1 }));
  });

  // A replay once reported success while the kept picture its row names had since been removed.
  it("restores a removed picture on a replay of the same frame, and refuses a replay over an altered one", async () => {
    const screen = join(scratch, "screen.webp");
    const kept = join(home, "talk", "turns", `${TURN}.webp`);
    writeFileSync(screen, webp({ fill: 1 }));
    expect(await relay({ screen })).toBe(EXIT_OK);
    rmSync(kept);
    expect(await relay({ screen })).toBe(EXIT_OK);
    expect(readFileSync(kept)).toEqual(webp({ fill: 1 }));
    writeFileSync(kept, webp({ fill: 9 }));
    expect(await relay({ screen })).toBe(EXIT_ERROR);
  });

  // A row already at the turn's slug, carrying its anchor, must not be adopted with whatever picture it named.
  it("refuses a row this turn never registered, on the first relay and on every retry", async () => {
    const screen = join(scratch, "screen.webp");
    writeFileSync(screen, webp({ fill: 1 }));
    const planted = `anchor: talk:${TURN}\nThe owner's screen when they said it: /tmp/missing.webp\n`;
    writeFileSync(join(dir, "talk-7c1d2e3f4a5b.md"), planted);
    expect([await relay({ screen }), await relay({ screen })]).toEqual([EXIT_ERROR, EXIT_ERROR]);
    const turn = JSON.parse(readFileSync(join(home, "talk", "turns", `${TURN}.json`), "utf8")) as { state: string };
    expect([turn.state, readFileSync(join(dir, "talk-7c1d2e3f4a5b.md"), "utf8")]).toEqual(["intended", planted]);
  });

  // A registration that FAILED left the turn `registering`, so a row planted before the
  // retry was adopted as its own.
  it("puts a turn back to intended when its registration fails, so a row planted before the retry is refused", async () => {
    const screen = join(scratch, "screen.webp");
    writeFileSync(screen, webp({ fill: 1 }));
    chmodSync(dir, 0o500);
    const failed = await relay({ screen });
    chmodSync(dir, 0o700);
    const turnFile = join(home, "talk", "turns", `${TURN}.json`);
    const state = (JSON.parse(readFileSync(turnFile, "utf8")) as { state: string }).state;
    writeFileSync(join(dir, "talk-7c1d2e3f4a5b.md"), `anchor: talk:${TURN}\nThe owner's screen: /tmp/missing.webp\n`);
    expect([failed, state, await relay({ screen })]).toEqual([EXIT_ERROR, "intended", EXIT_ERROR]);
  });

  it("adopts its own row when an earlier run died inside the registration call", async () => {
    const screen = join(scratch, "screen.webp");
    writeFileSync(screen, webp({ fill: 1 }));
    expect(await relay({ screen })).toBe(EXIT_OK);
    const turnFile = join(home, "talk", "turns", `${TURN}.json`);
    const died = {
      ...(JSON.parse(readFileSync(turnFile, "utf8")) as object),
      registeredAtIso: null,
      state: "registering",
    };
    writeFileSync(turnFile, JSON.stringify(died));
    expect(await relay({ screen })).toBe(EXIT_OK);
    expect((JSON.parse(readFileSync(turnFile, "utf8")) as { state: string }).state).toBe("registered");
  });

  it("refuses a file that is not a WebP, and writes no row", async () => {
    const screen = join(scratch, "screen.png");
    writeFileSync(screen, Buffer.from("\x89PNG\r\n\x1a\n-not-a-webp-at-all"));
    expect(await relay({ screen })).toBe(EXIT_USAGE);
    expect(existsSync(join(dir, "talk-7c1d2e3f4a5b.md"))).toBe(false);
  });
});

describe("talk file", () => {
  it("reads a file by absolute path, refuses one in the home's secrets store, and refuses a missing mode", async () => {
    mkdirSync(join(scratch, "secrets"));
    writeFileSync(join(scratch, "notes.txt"), "plain notes\n");
    writeFileSync(join(scratch, "secrets", "slack-token"), "not-a-real-token\n");
    const file = ({ rest }: { rest: readonly string[] }): Promise<number> =>
      runTalkFile(argvFor({ rest: [...rest, "--home", scratch], verb: "file" }));
    expect(await file({ rest: ["read", "--path", join(scratch, "notes.txt"), "--json"] })).toBe(EXIT_OK);
    expect(await file({ rest: ["list", "--dir", scratch] })).toBe(EXIT_OK);
    expect(await file({ rest: ["read", "--path", join(scratch, "secrets", "slack-token")] })).toBe(EXIT_ERROR);
    expect(await file({ rest: ["--path", join(scratch, "notes.txt")] })).toBe(EXIT_USAGE);
  });

  it("reads a PNG as a picture in both modes, and refuses one asked for from an offset", async () => {
    writeFileSync(join(scratch, "card.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));
    const file = ({ rest }: { rest: readonly string[] }): Promise<number> =>
      runTalkFile(argvFor({ rest: [...rest, "--home", scratch], verb: "file" }));
    expect(await file({ rest: ["read", "--path", join(scratch, "card.png"), "--json"] })).toBe(EXIT_OK);
    expect(await file({ rest: ["read", "--path", join(scratch, "card.png")] })).toBe(EXIT_OK);
    expect(await file({ rest: ["read", "--path", join(scratch, "card.png"), "--from", "4"] })).toBe(EXIT_ERROR);
  });
});
