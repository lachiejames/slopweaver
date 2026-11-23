/**
 * `talk relay`'s own writes hold on a relay whose words may end before the owner did, driven
 * through the real runner against a home and board this file mints. A relay saying `--heard-tail whole` lands the card
 * on screen; one saying `cut`, or nothing, lands none — on a replay too — and its row opens on the HELD clause.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runTalkRelayWith } from "../../../cli/commands/talk/relayRun.js";
import { EXIT_OK } from "../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import { ok, unwrap } from "../../../lib/result.js";
import { readCardLandings } from "../../../talk/cardLandingStore.js";
import { STILL_SPEAKING_HOLD, TAIL_UNSTATED_HOLD } from "../../../talk/relayCutHold.js";
import { ACME_ORGANISATION } from "../../organisationFixture.js";

const CARD = "draft:voice-mark-draft";
const WHOLE_TURN = "a0000017-0000-4000-8000-000000000019";
const CUT_TURN = "4a3b2c1d-6e7f-4081-9a2b-b4c5d6e7f809";
const UNSTATED_TURN = "5b4c3d2e-7f80-4192-8b3c-c5d6e7f8091a";

let scratch = "";
let home = "";
let dir = "";

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "talk-relay-held-"));
  home = join(scratch, "home");
  dir = join(scratch, "handovers");
  mkdirSync(home, { recursive: true });
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

const summaryOf = ({ turn }: { turn: string }): string => {
  const path = join(dir, `talk-${turn.replaceAll("-", "").slice(0, 12)}.md`);
  return parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).summary!;
};

const held = ({ hold }: { hold: string }): string =>
  `HELD: no Queue card landed and no ruling took effect, because ${hold} — read the whole stretch on the call first.`;

const relay = ({ turn, tail }: { turn: string; tail: readonly string[] }): Promise<number> =>
  runTalkRelayWith({
    argv: [
      "node",
      "slopweaver",
      "talk",
      "relay",
      "--turn",
      turn,
      "--heard",
      "what is a voice mark",
      "--say",
      "asks what a voice mark is",
      "--about",
      CARD,
      ...tail,
      "--home",
      home,
      "--dir",
      dir,
      "--json",
    ],
    readOrganisation: () => Promise.resolve(ok(ACME_ORGANISATION)),
  });

const landed = (): readonly string[] => unwrap(readCardLandings({ home })).rows.map((row) => row.cardKey);

describe("talk relay's own writes on words that may end before the owner did", () => {
  it("lands only the relay saying the words were whole; a cut one, an unstated one and a replay open on HELD", async () => {
    const codes = [
      await relay({ tail: ["--heard-tail", "cut"], turn: CUT_TURN }),
      await relay({ tail: [], turn: UNSTATED_TURN }),
      await relay({ tail: ["--heard-tail", "cut"], turn: CUT_TURN }),
      await relay({ tail: ["--heard-tail", "whole"], turn: WHOLE_TURN }),
    ];
    expect([codes, landed()]).toEqual([[EXIT_OK, EXIT_OK, EXIT_OK, EXIT_OK], [CARD]]);
    // A whole relay's row carries no lead, so its summary opens on the ask every relay row carries after one.
    const whole = summaryOf({ turn: WHOLE_TURN });
    const askOpens = whole.slice(0, whole.indexOf(":") + 1);
    const leadOf = ({ turn }: { turn: string }): string => {
      const summary = summaryOf({ turn });
      return summary.slice(0, summary.indexOf(askOpens)).trimEnd();
    };
    expect([leadOf({ turn: CUT_TURN }), leadOf({ turn: UNSTATED_TURN }), whole.includes("HELD:")]).toEqual([
      held({ hold: STILL_SPEAKING_HOLD }),
      held({ hold: TAIL_UNSTATED_HOLD }),
      false,
    ]);
  });
});
