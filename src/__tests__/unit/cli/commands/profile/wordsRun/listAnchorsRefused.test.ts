/*
 * `profile words` refusing a turn whose anchor or record it cannot stand behind, and never listing it: a relay
 * record with no readable instant, a chair turn and a call stretch whose anchors no reader takes, and an accepted
 * suggestion queued in a chair's transcript.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../../../../../cli/exitCodes.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { CHAIR, claudeHome, home, run, stage, TURN, useWordsHomes } from "./harness.js";

useWordsHomes();

describe("profile words — a list", () => {
  it("refuses one relay anchor whose record carries no readable instant, as the list and quote attach do", () => {
    stage({ atIso: "2026-10-04T09:00:00.000Z", heard: "ship the atlas", turnId: TURN, typed: true });
    const turnFile = join(stateHomePaths({ home }).talkTurns, `${TURN}.json`);
    const record = JSON.parse(readFileSync(turnFile, "utf8")) as Record<string, unknown>;
    writeFileSync(turnFile, JSON.stringify({ ...record, stagedAtIso: "not-an-instant" }), "utf8");

    const text = run({ rest: [`talk:${TURN}`] });
    const json = run({ rest: [`talk:${TURN}`, "--json"] });

    expect([text.code, text.lines, json.code, json.lines.join("\n").includes("ship the atlas")]).toEqual([
      EXIT_ERROR,
      [
        `profile words: talk:${TURN} carries no readable instant (not-an-instant), so it is not read as a turn of theirs`,
      ],
      EXIT_ERROR,
      false,
    ]);
  });

  it("names a chair turn and a call stretch whose anchors no reader takes, never listing them", () => {
    writeFileSync(
      join(claudeHome, "projects", "-repo", `${CHAIR}.jsonl`),
      `${JSON.stringify({ message: { content: "ship the atlas" }, promptSource: "typed", timestamp: "2026-10-04T07:00:00.000Z", type: "user", uuid: "not-a-uuid" })}\n`,
      "utf8",
    );
    // A call file the store's name grammar reads, but a version-1 uuid the pointer's v4 check refuses. A segment id
    // the pointer could not carry is no longer one: the record refuses it (`talk/callRecord.ts` `SEGMENT_ID`).
    const call = "5d6e7f80-9102-1a3b-8c4d-5e6f70819203";
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    writeFileSync(
      join(home, "talk", "calls", `${call}.jsonl`),
      `${JSON.stringify({ atIso: "2026-10-04T08:00:00.000Z", final: true, id: "segment_1", kind: "segment", text: "move it", who: "owner" })}\n`,
      "utf8",
    );

    const { code, lines } = run({ rest: [] });

    expect([code, lines.slice(1)]).toEqual([
      EXIT_ERROR,
      [
        `  not read — console-calls: 1 turn(s) from the owner carry an anchor no reader takes, so they are not listed (first: talk-call:${call}#segment_1)`,
        `  not read — supervisor: 1 turn(s) from the owner carry an anchor no reader takes, so they are not listed (first: transcript:${CHAIR}#not-a-uuid)`,
      ],
    ]);
  });

  it("refuses an accepted suggestion queued in a chair's transcript, and never lists it", () => {
    const uuid = "8a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";
    writeFileSync(
      join(claudeHome, "projects", "-repo", `${CHAIR}.jsonl`),
      `${JSON.stringify({
        attachment: { commandMode: "prompt", origin: { kind: "human" }, prompt: "ship it", type: "queued_command" },
        cwd: "/repo",
        promptSource: "suggestion_accepted",
        timestamp: "2026-10-04T09:00:00.000Z",
        type: "attachment",
        uuid,
      })}\n`,
      "utf8",
    );

    const one = run({ rest: [`transcript:${CHAIR}#${uuid}`] });
    const list = run({ rest: ["--phrase", "ship"] });

    expect([one.code, list.code]).toEqual([EXIT_ERROR, EXIT_EXPECTED_EMPTY]);
    expect(one.lines.join("\n")).not.toContain("ship it");
  });
});
