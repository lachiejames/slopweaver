/**
 * `talk relay --discuss-first`, driven through the real runner against a home and board this file mints — never the
 * ambient one, per `testing.md`. When the voice puts "did you actually discuss this
 * first?" on the owner's ask for a team fix, the row the chair reads opens on a hold; their next words open on the answer.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runTalkRelayWith } from "../../../cli/commands/talk/relayRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { Organisation } from "../../../organisation/core.js";
import { type OrganisationError, OrganisationErrors } from "../../../organisation/errors.js";
import { STILL_SPEAKING_HOLD, TAIL_UNSTATED_HOLD } from "../../../talk/relayCutHold.js";
import { ACME_ORGANISATION, FIXTURE_SELF_REPOSITORY } from "../../organisationFixture.js";

type OrganisationRead = Result<Organisation, OrganisationError>;

const PUT_TURN = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const ANSWER_TURN = "8d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a";
const OTHER_PUT_TURN = "9e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b";
const CROSSED_TURN = "0f4a5b6c-7d8e-4f9a-8b1c-2d3e4f5a6b7c";
const THREAD = "https://acme.slack.com/archives/C0SYN000001/p1791351441819519";

let scratch: string;
let home: string;
let dir: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "talk-relay-discuss-"));
  home = join(scratch, "home");
  dir = join(scratch, "handovers");
  mkdirSync(home, { recursive: true });
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

const rowPathOf = ({ turn }: { turn: string }): string => join(dir, `talk-${turn.replaceAll("-", "").slice(0, 12)}.md`);

const summaryOf = ({ turn }: { turn: string }): string => {
  const path = rowPathOf({ turn });
  return parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).summary!;
};

const relay = ({
  turn,
  heard,
  extra,
  organisation = ok(ACME_ORGANISATION),
}: {
  turn: string;
  heard: string;
  extra: readonly string[];
  organisation?: OrganisationRead;
}): Promise<number> =>
  runTalkRelayWith({
    argv: [
      "node",
      "slopweaver",
      "talk",
      "relay",
      "--turn",
      turn,
      "--heard",
      heard,
      "--say",
      "raise a fix on acme-admin",
      ...extra,
      "--home",
      home,
      "--dir",
      dir,
      "--json",
    ],
    readOrganisation: () => Promise.resolve(organisation),
  });

describe("talk relay carrying the discuss-first question", () => {
  it("opens the put row on the hold with the thread, and the owner's answer's row on the answer naming the put turn", async () => {
    const put = await relay({
      extra: ["--discuss-first", "put", "--team-fix", "acme/acme-admin", "--fix-thread", THREAD],
      heard: "raise a fix on acme-admin for that",
      turn: PUT_TURN,
    });
    const answer = await relay({
      extra: [
        "--discuss-first",
        "override",
        "--team-fix",
        "acme/acme-admin",
        "--discuss-first-turn",
        PUT_TURN,
        "--heard-tail",
        "whole",
      ],
      heard: "yeah we talked about it, go",
      turn: ANSWER_TURN,
    });
    expect([put, answer]).toEqual([EXIT_OK, EXIT_OK]);
    expect(summaryOf({ turn: PUT_TURN })).toContain(
      "DISCUSS-FIRST HOLD: the voice asked the owner whether the team discussed this first — start no fix until their answer " +
        `· fix to acme/acme-admin · thread ${THREAD}`,
    );
    expect(summaryOf({ turn: ANSWER_TURN })).toContain(
      "DISCUSS-FIRST ANSWER: the owner's words here answer whether the team discussed this first, and a go-ahead stands " +
        `(talk:${PUT_TURN}) · fix to acme/acme-admin`,
    );
  });

  // An answer relayed before the owner finished stood a go-ahead a "no, wait" may follow.
  it("holds a checked answer relayed while the owner was still speaking, or not saying, and a replay keeps it held", async () => {
    const override = ["--discuss-first", "override", "--team-fix", "acme/acme-admin", "--discuss-first-turn", PUT_TURN];
    await relay({
      extra: ["--discuss-first", "put", "--team-fix", "acme/acme-admin"],
      heard: "raise a fix",
      turn: PUT_TURN,
    });
    const cut = {
      extra: [...override, "--heard-tail", "cut"],
      heard: "yeah we talked about it, go",
      turn: ANSWER_TURN,
    };
    const unstated = { extra: override, heard: "yeah we talked about it, go", turn: CROSSED_TURN };
    // A relay carrying no question and no answer has no lead, so its row opens on the ask every relay row carries.
    const plain = { extra: [], heard: "yeah we talked about it, go", turn: OTHER_PUT_TURN };
    const codes = [await relay(cut), await relay(unstated), await relay(cut), await relay(plain)];
    expect(codes).toEqual([EXIT_OK, EXIT_OK, EXIT_OK, EXIT_OK]);
    const bare = summaryOf({ turn: OTHER_PUT_TURN });
    const askOpens = bare.slice(0, bare.indexOf(":") + 1);
    const leadOf = ({ turn }: { turn: string }): string => {
      const summary = summaryOf({ turn });
      return summary.slice(0, summary.indexOf(askOpens)).trimEnd();
    };
    const cutHold = ({ hold }: { hold: string }): string =>
      "DISCUSS-FIRST HOLD: start no fix yet — this relay answers whether the team discussed this first " +
      `(talk:${PUT_TURN}), but ${hold} · fix to acme/acme-admin`;
    expect([leadOf({ turn: ANSWER_TURN }), leadOf({ turn: CROSSED_TURN })]).toEqual([
      cutHold({ hold: STILL_SPEAKING_HOLD }),
      cutHold({ hold: TAIL_UNSTATED_HOLD }),
    ]);
  });

  // An override naming any well-formed turn id read as the owner's answer.
  it("holds an answer whose turn put no question, or asked about another repository", async () => {
    const plain = await relay({ extra: [], heard: "something else entirely", turn: PUT_TURN });
    const forged = await relay({
      extra: ["--discuss-first", "override", "--team-fix", "acme/acme-admin", "--discuss-first-turn", PUT_TURN],
      heard: "yeah we talked about it, go",
      turn: ANSWER_TURN,
    });
    const elsewhere = await relay({
      extra: ["--discuss-first", "put", "--team-fix", "acme/acme-web"],
      heard: "raise a fix on acme-web",
      turn: OTHER_PUT_TURN,
    });
    const crossed = await relay({
      extra: ["--discuss-first", "override", "--team-fix", "acme/acme-admin", "--discuss-first-turn", OTHER_PUT_TURN],
      heard: "go ahead",
      turn: CROSSED_TURN,
    });
    expect([plain, forged, elsewhere, crossed]).toEqual([EXIT_OK, EXIT_OK, EXIT_OK, EXIT_OK]);
    expect(
      [summaryOf({ turn: ANSWER_TURN }), summaryOf({ turn: CROSSED_TURN })].map((s) => s.includes("ANSWER:")),
    ).toEqual([false, false]);
    expect(summaryOf({ turn: ANSWER_TURN })).toContain(
      "DISCUSS-FIRST HOLD: start no fix until the owner answers whether the team discussed this first — this relay claims to " +
        `answer it, but talk:${PUT_TURN} put no such question · fix to acme/acme-admin`,
    );
    expect(summaryOf({ turn: CROSSED_TURN })).toContain(
      `but talk:${OTHER_PUT_TURN} asked it about acme/acme-web · fix to acme/acme-admin`,
    );
  });

  it("holds an answer naming a turn nothing on this machine recorded", async () => {
    expect(
      await relay({
        extra: ["--discuss-first", "override", "--team-fix", "acme/acme-admin", "--discuss-first-turn", PUT_TURN],
        heard: "yeah we talked about it, go",
        turn: ANSWER_TURN,
      }),
    ).toBe(EXIT_OK);
    expect(summaryOf({ turn: ANSWER_TURN })).toContain(`but talk:${PUT_TURN} is not on record`);
  });

  it("opens no hold on a relay naming no team fix, and reads no organisation for it", async () => {
    const absent = err(OrganisationErrors.notConfigured({ missing: "organisation" }));
    expect(
      await relay({ extra: [], heard: "raise a fix on acme-admin for that", organisation: absent, turn: PUT_TURN }),
    ).toBe(EXIT_OK);
    expect(summaryOf({ turn: PUT_TURN }).includes("DISCUSS-FIRST")).toBe(false);
  });

  it("refuses a team fix naming Slopweaver's own repository, or one outside the organisation, writing no row", async () => {
    const own = await relay({
      extra: ["--discuss-first", "put", "--team-fix", FIXTURE_SELF_REPOSITORY],
      heard: "raise a fix on slopweaver",
      turn: PUT_TURN,
    });
    const outside = await relay({
      extra: ["--discuss-first", "put", "--team-fix", "octocat/hello-world"],
      heard: "raise a fix on hello-world",
      turn: ANSWER_TURN,
    });
    expect([
      own,
      outside,
      existsSync(rowPathOf({ turn: PUT_TURN })),
      existsSync(rowPathOf({ turn: ANSWER_TURN })),
    ]).toEqual([EXIT_USAGE, EXIT_USAGE, false, false]);
  });

  it("refuses a team fix when no organisation is written, rather than judging it against none", async () => {
    const absent = err(OrganisationErrors.notConfigured({ missing: "organisation" }));
    expect(
      await relay({
        extra: ["--discuss-first", "put", "--team-fix", "acme/acme-admin"],
        heard: "raise a fix on acme-admin",
        organisation: absent,
        turn: PUT_TURN,
      }),
    ).toBe(EXIT_ERROR);
    expect(existsSync(rowPathOf({ turn: PUT_TURN }))).toBe(false);
  });
});
