/**
 * `slopweaver slack draft record|revise`, and every verb that parks through the recorder in-process, refuse a visible
 * session that was never shown the owner's voice brief.
 *
 * The owner ruled a drafting model missing their voice rules a P0 on a call: a Queue card's reply in their
 * name was drafted with no brief in the prompt at all. These cases hold the one property that closes it on the seat
 * lane: an unbriefed session parks NOTHING and reads nothing, is handed the whole brief in the refusal, and parks on
 * the next run once that brief is what it drafted to.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseSlackWriteArgs, takesFreshWordsAsMe } from "../../../../../../cli/commands/slack/core.js";
import { draftAdmissionExit } from "../../../../../../cli/commands/slack/draftAdmission.js";
import { type DraftRecordOptions, parseSlackDraftArgs } from "../../../../../../cli/commands/slack/draftCore.js";
import { runDraftRecord } from "../../../../../../cli/commands/slack/draftRecordEntry.js";
import { runSlackDraftWithDeps } from "../../../../../../cli/commands/slack/draftRun.js";
import { voiceBriefingExit } from "../../../../../../cli/commands/slack/voiceBriefingGate.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import { PROFILE_SCHEMA_VERSION } from "../../../../../../profile.js";
import { grantSessionEnv } from "../../../../../hatchGrantFixture.js";
import { parkedIn, RECORD_TAIL, shown } from "./forms.js";
import { argv, draftDeps, freshRecording } from "./world.js";

const homes: string[] = [];

/** A throwaway home whose profile bans one word, so the owner's voice brief is configured. */
function briefedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "draft-voice-brief-"));
  homes.push(home);
  writeFileSync(
    join(home, "profile.json"),
    JSON.stringify({
      displayName: "Fixture",
      gitNamespace: "",
      id: "fixture",
      schemaVersion: PROFILE_SCHEMA_VERSION,
      slackMe: { voice: { exact: [{ kind: "word", value: "delve" }] } },
      sources: [],
    }),
    "utf8",
  );
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** Record one as-me draft under `home`, as the visible fixture session. */
async function recordAsMe({ home }: { home: string }): Promise<{
  code: number;
  seen: ReturnType<typeof freshRecording>;
}> {
  const seen = freshRecording();
  const env = grantSessionEnv({ home });
  const code = await runSlackDraftWithDeps({
    argv: argv({ tail: [...RECORD_TAIL, "--home", home] }),
    deps: {
      ...draftDeps({ recording: seen, stdin: JSON.stringify(shown({ lines: ["Four groups, one question."] })) }),
      doorEnv: () => env,
    },
  });
  return { code, seen };
}

describe("slack draft record — the owner's voice brief is loaded before any draft in their name parks", () => {
  it("REFUSES an unbriefed session before any read, and appends nothing", async () => {
    const { code, seen } = await recordAsMe({ home: briefedHome() });

    expect(code).toBe(EXIT_ERROR);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual([]);
  });

  it("parks on the next run, because the refusal handed that session the brief", async () => {
    const home = briefedHome();
    await recordAsMe({ home });

    const { code, seen } = await recordAsMe({ home });

    expect(code).toBe(EXIT_OK);
    expect(parkedIn({ events: seen.appended }).payload.text).toContain("Four groups, one question.");
  });

  it("parks first time when the owner configured no voice, because there is no brief to owe", async () => {
    const home = mkdtempSync(join(tmpdir(), "draft-voice-none-"));
    homes.push(home);

    const { code } = await recordAsMe({ home });

    expect(code).toBe(EXIT_OK);
  });
});

describe("runDraftRecord — the entry every in-process caller parks through", () => {
  /** The record invocation `workstreams loop-in` and `github reviewer-ask` hand the recorder, past the dispatcher. */
  function recordOptions({ home }: { home: string }): DraftRecordOptions {
    const parsed = unwrap(parseSlackDraftArgs({ defaultHome: home, rest: [...RECORD_TAIL, "--home", home] }));
    if (parsed.mode !== "record") {
      throw new Error(`parsed a ${parsed.mode}, not a record`);
    }
    return parsed;
  }

  it("REFUSES an unbriefed session called directly, never through `slack draft`, and appends nothing", async () => {
    const home = briefedHome();
    const seen = freshRecording();
    const env = grantSessionEnv({ home });

    const code = await runDraftRecord({
      deps: {
        ...draftDeps({ recording: seen, stdin: JSON.stringify(shown({ lines: ["Four groups, one question."] })) }),
        doorEnv: () => env,
      },
      options: recordOptions({ home }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual([]);
  });
});

describe("draftAdmissionExit — which draft modes owe the brief", () => {
  /** The world the gate reads: the fixture session, and a clock. */
  const world = ({ home }: { home: string }) => ({
    doorEnv: () => grantSessionEnv({ home }),
    nowIso: () => "2026-11-08T12:00:00.000Z",
  });

  it("refuses an unbriefed revise, because a rewrite is new words in the owner's name", () => {
    const home = briefedHome();
    const parsed = { home, id: "sd-1a2b3c4d", json: false, mode: "revise", reading: [], textSource: "-" } as const;

    expect(draftAdmissionExit({ deps: world({ home }), parsed })).toBe(EXIT_ERROR);
  });

  it("admits an unbriefed restore, because it puts back words that were already admitted", () => {
    const home = briefedHome();
    const parsed = { home, id: "sd-1a2b3c4d", json: false, mode: "restore", version: 1 } as const;

    expect(draftAdmissionExit({ deps: world({ home }), parsed })).toBe(undefined);
  });

  it("owes the brief on a release carrying --thanks-instead, because that line is new words in the owner's name", () => {
    const tail = ["--as", "me", "--draft", "sd-1a2b3c4d", "--approve", "abc123", "--home", "/h"];
    const thanks = unwrap(
      parseSlackWriteArgs({ defaultHome: "/h", rest: [...tail, "--thanks-instead", "Thanks."], verb: "reply" }),
    );
    const plain = unwrap(parseSlackWriteArgs({ defaultHome: "/h", rest: tail, verb: "reply" }));
    const bot = unwrap(
      parseSlackWriteArgs({
        defaultHome: "/h",
        rest: ["--as", "bot", "--channel", "C0FIXTURE", "--form", "-"],
        verb: "post",
      }),
    );

    expect(takesFreshWordsAsMe({ options: thanks })).toBe(true);
    expect(takesFreshWordsAsMe({ options: plain })).toBe(false);
    expect(takesFreshWordsAsMe({ options: bot })).toBe(false);
  });

  it("reads no clock when the invocation takes no words in the owner's name", () => {
    const home = briefedHome();
    const now = (): string => {
      throw new Error("the clock was read");
    };

    expect(voiceBriefingExit({ applies: false, env: grantSessionEnv({ home }), home, now })).toBe(undefined);
  });
});
