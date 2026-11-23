import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ok, unwrapErr } from "#lib/result.js";

import { liveTurnPoster, NO_MENTIONS } from "../../../../../live/turn/poster.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import {
  CARD_CHROME,
  CHROME,
  CLEAN_VERDICT,
  DM_MENTION,
  judge,
  minimalAnswer,
  NO_ROW,
  POSTED,
  PROVENANCE,
  READY,
  REPLY,
} from "./fixtures.js";
import { fakeTransport, home, type Recorded, usePosterHome } from "./harness.js";

usePosterHome();

describe("a CORRUPT profile.json stops the live turn's writes, rather than reading as no voice rules", () => {
  function corruptPoster({ log }: { log: Recorded[] }) {
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    return liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: DM_MENTION,
      freshnessNote: undefined,
      verdict: CLEAN_VERDICT,
      chrome: CARD_CHROME,
      home,
      judge,
      mentions: NO_MENTIONS,
      provenance: PROVENANCE,
      readiness: READY,
      transport: {
        ...fakeTransport({ log }),
        postAssistantMessage: async (args) => {
          log.push({ detail: args, method: "postAssistantMessage" });
          return POSTED;
        },
        setThreadTitle: async ({ args }) => {
          log.push({ detail: args, method: "setThreadTitle" });
          return ok(undefined);
        },
      },
      turnChrome: CHROME,
      turnId: "turn-1",
    });
  }

  it("refuses an in-voice answer as RETRYABLE, before Slack is asked anything", async () => {
    const log: Recorded[] = [];

    const outcome = await corruptPoster({ log }).postAnswer({
      answer: minimalAnswer(),
      askIdentity: DM_MENTION,
      documents: [],
      reply: REPLY,
      uploads: [],
    });

    expect(outcome).toEqual({
      kind: "retryable-refusal",
      refusal: {
        code: "ANSWER_PROFILE_UNREADABLE",
        message: expect.stringContaining(`${join(home, "profile.json")} is there but cannot be trusted`),
      },
    });
    expect(log.map((entry) => entry.method)).toEqual([]);
  });

  it("refuses an in-voice thread title, naming the profile, and never calls setThreadTitle", async () => {
    const log: Recorded[] = [];

    const outcome = await corruptPoster({ log }).setTitle({ title: "how to staff the roster" });

    expect(unwrapErr(outcome)).toContain("cannot be trusted");
    expect(log.map((entry) => entry.method)).toEqual([]);
  });
});
