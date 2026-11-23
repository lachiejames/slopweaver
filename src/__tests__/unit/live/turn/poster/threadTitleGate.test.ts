import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ok } from "#lib/result.js";

import { liveTurnPoster, NO_MENTIONS } from "../../../../../live/turn/poster.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { CARD_CHROME, CHROME, CLEAN_VERDICT, DM_MENTION, judge, NO_ROW, PROVENANCE, READY } from "./fixtures.js";
import { fakeTransport, home, type Recorded, usePosterHome } from "./harness.js";

usePosterHome();

describe("the thread-title gate, wired", () => {
  /**
   * A thread title is composed fresh per turn and is the first line a reader meets, which is exactly the
   * class a harvest measured leaking — `the bot — live board` is a real title from that
   * set. It reached Slack through `nameThreadThroughDoor` with no rule ever reading it.
   */
  const BANNED = "leverage";

  function titlePoster({ log }: { log: Recorded[] }) {
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "Ada Owner",
        gitNamespace: "ada-gh",
        id: "owner-1",
        schemaVersion: 1,
        slackMe: { voice: { exact: [{ kind: "literal", value: BANNED }] } },
        sources: ["github"],
      }),
      "utf8",
    );
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
      // The shared fake answers `setThreadTitle` without recording it, so a log assertion over it would be
      // true whether the gate fired or not. This one records, which is what makes the refusal falsifiable.
      transport: {
        ...fakeTransport({ log }),
        setThreadTitle: async ({ args }) => {
          log.push({ detail: args, method: "setThreadTitle" });
          return ok(undefined);
        },
      },
      turnChrome: CHROME,
      turnId: "turn-1",
    });
  }

  it("REFUSES a title that breaks a rule, and never calls setThreadTitle", async () => {
    const log: Recorded[] = [];

    const outcome = await titlePoster({ log }).setTitle({ title: `how to ${BANNED} the roster` });

    expect(outcome.isErr()).toBe(true);
    expect(log.map((entry) => entry.method)).toEqual([]);
  });

  it("names the thread when the title is in voice — the same path, one word apart", async () => {
    const log: Recorded[] = [];

    const outcome = await titlePoster({ log }).setTitle({ title: "how to staff the roster" });

    expect(outcome.isOk()).toBe(true);
    expect(log.map((entry) => entry.method)).toEqual(["setThreadTitle"]);
  });
});
