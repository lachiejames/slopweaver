/**
 * `profile steers` over a real home in a temp directory and an in-memory store (`../../../../steerMeasurementFixture.ts`,
 * a seam, not a mock): a turn of the owner's offered for reading, a read journalled in the store, a paraphrase refused, an
 * old journal imported, an outage refused, and the reading that counts it.
 *
 * Per `testing.md`, every write goes to a `home` this file minted — never the ambient one.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseProfileSteersArgs } from "../../../../../cli/commands/profile/steersArgs.js";
import { profileSteers } from "../../../../../cli/commands/profile/steersRun.js";
import { PROFILE_STEERS_USAGE } from "../../../../../cli/commands/profile/steersUsage.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { parseSteerVerdicts, type SteerVerdict } from "../../../../../profile/steerKinds.js";
import { writeSupervisorPin } from "../../../../../sessions/supervisorPinStore.js";
import { appendSupervisorLink } from "../../../../../supervisor/chainStore.js";
import { formRelayDraft } from "../../../../../talk/relayDraft.js";
import { claimTurn } from "../../../../../talk/relayStore.js";
import { type SteerMeasurementFake, steerMeasurementFake } from "../../../../steerMeasurementFixture.js";

const NOW = "2026-10-04T12:00:00.000Z";
const TURN = "a0000017-0000-4000-8000-000000000019";
const CHAIR = "4c5d6e7f-8091-4a2b-9c3d-4e5f60718293";
const ANCHOR = `talk:${TURN}`;

let home = "";
let claudeHome = "";
let store: SteerMeasurementFake = steerMeasurementFake();

beforeEach(() => {
  store = steerMeasurementFake();
  home = mkdtempSync(join(tmpdir(), "sw-steers-home-"));
  claudeHome = mkdtempSync(join(tmpdir(), "sw-steers-claude-"));
  const chair = {
    session: { host: "claude-code" as const, id: CHAIR },
    pinnedAtIso: "2026-09-01T00:00:00.000Z",
    workspaceId: "ws-1",
    workspaceRef: "w:1",
  };
  appendSupervisorLink({ home, link: { ...chair, source: "pin" } });
  writeSupervisorPin({ home, record: chair });
  mkdirSync(join(claudeHome, "projects", "-repo"), { recursive: true });
  writeFileSync(join(claudeHome, "projects", "-repo", `${CHAIR}.jsonl`), "", "utf8");
  const draft = unwrap(
    formRelayDraft({
      about: "",
      heard: "no em dashes in the slack draft please",
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "",
      turnId: TURN,
      typed: true,
      wordsAlone: false,
    }),
  );
  unwrap(claimTurn({ draft, home, nowIso: "2026-10-04T09:00:00.000Z" }));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
  rmSync(claudeHome, { force: true, recursive: true });
});

/** Run the verb's body over a typed argv tail, collecting every line. */
async function run({
  rest,
}: {
  rest: readonly string[];
}): Promise<{ readonly code: number; readonly lines: readonly string[] }> {
  const lines: string[] = [];
  const code = await profileSteers({
    args: unwrap(parseProfileSteersArgs({ rest })),
    claudeHome,
    home,
    nowIso: NOW,
    out: (line) => {
      lines.push(line);
    },
    steers: store.port,
  });
  return { code, lines };
}

/** What the store holds, read the way the verb reads it. */
function storedVerdicts(): readonly SteerVerdict[] {
  return parseSteerVerdicts({ lines: store.state.rows.map((row) => row.exactLine) }).verdicts;
}

describe("profile steers", () => {
  it("offers a cued turn nobody has read, whole", async () => {
    const { code, lines } = await run({ rest: ["unread"] });

    expect(code).toBe(EXIT_OK);
    expect(lines).toEqual([
      "1 cued turn(s) since 2026-08-05 not yet read; the oldest 1:",
      `2026-10-04T09:00Z  written  ${ANCHOR}  cued: em-dashes`,
      "    no em dashes in the slack draft please",
    ]);
  });

  it("journals a verbatim read in the store, after which the reading counts it and nothing is unread", async () => {
    const judged = await run({
      rest: ["judge", ANCHOR, "--kind", "em-dashes", "--says", "corrects", "--quote", "no em dashes"],
    });
    expect(judged).toEqual({ code: EXIT_OK, lines: [`judged ${ANCHOR}: corrects em-dashes`] });
    expect(storedVerdicts().map((verdict) => [verdict.anchor, verdict.says])).toEqual([[ANCHOR, "corrects"]]);
    expect(store.state.rows.map((row) => [row.journalSeq, row.origin])).toEqual([[1, "profile"]]);

    const reading = await run({ rest: [] });
    expect(reading.code).toBe(EXIT_OK);
    expect(reading.lines.slice(0, 2)).toEqual([
      "Slack steers since 2026-08-05 · 1 turn(s) read · 0 cued turn(s) not yet read",
      "Em dashes                    1 · last 2026-10-04 · nothing observed for 0 day(s)",
    ]);
    const unread = await run({ rest: ["unread", "--json"] });
    expect(unread.lines.map((line) => JSON.parse(line).unread)).toEqual([0]);
  });

  it("refuses a quote the turn does not hold, and journals nothing", async () => {
    const judged = await run({
      rest: ["judge", ANCHOR, "--kind", "em-dashes", "--says", "corrects", "--quote", "stop using dashes"],
    });

    expect(judged.code).toBe(EXIT_ERROR);
    expect(judged.lines).toEqual([
      `profile steers judge: ${ANCHOR} does not hold those words verbatim — quote the turn, never a paraphrase`,
    ]);
    expect(storedVerdicts()).toEqual([]);
  });

  it("imports an old journal once, keeps a line that does not read, and names it by its line in the file", async () => {
    mkdirSync(join(home, "judgement"), { recursive: true });
    const read = JSON.stringify({ anchor: ANCHOR, judgedAtIso: NOW, says: "nothing", turnAtIso: NOW });
    writeFileSync(join(home, "judgement", "steer-kinds.jsonl"), `\n${read}\nnot json\n`, "utf8");

    const reading = await run({ rest: ["--json"] });

    expect(reading.code).toBe(EXIT_OK);
    expect(reading.lines.map((line) => JSON.parse(line).unparsed)).toEqual([[3]]);
    expect(store.state.rows.map((row) => [row.journalSeq, row.origin, row.exactLine])).toEqual([
      [2, "legacy-file", read],
      [3, "legacy-file", "not json"],
    ]);
  });

  it("exits 1 on a store outage and prints no reading at all, never an empty one", async () => {
    store.state.connection = "unavailable";

    const reading = await run({ rest: ["--json"] });

    expect(reading).toEqual({
      code: EXIT_ERROR,
      lines: ["profile steers: the store could not be opened: connection refused"],
    });
  });

  it("refuses to judge into a home that selects no store, and writes nowhere", async () => {
    store.state.connection = "unselected";

    const judged = await run({
      rest: ["judge", ANCHOR, "--kind", "em-dashes", "--says", "corrects", "--quote", "no em dashes"],
    });

    expect(judged.code).toBe(EXIT_ERROR);
    expect(judged.lines).toEqual([
      "profile steers judge: steer measurements are recorded in the store, and this home selects no store: no store is configured",
    ]);
    expect(existsSync(join(home, "judgement", "steer-kinds.jsonl"))).toBe(false);
  });

  it("says a turn naming the bot by handle is not offered until the profile declares the bot's handles", async () => {
    const gapsOf = async (): Promise<readonly string[]> =>
      (await run({ rest: ["unread", "--json"] })).lines.map((line) => JSON.parse(line).gaps as string[])[0]!;
    const undeclared =
      "profile.json: declares no slackBot.selfHandles — a turn naming the bot by handle is not offered";

    expect(await gapsOf()).toContain(undeclared);
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { selfHandles: ["acme-bot"] },
        sources: [],
      }),
      "utf8",
    );
    expect(await gapsOf()).not.toContain(undeclared);
  });

  it("names every mode in its usage", () => {
    expect(PROFILE_STEERS_USAGE).toContain("slopweaver profile steers unread");
    expect(PROFILE_STEERS_USAGE).toContain("slopweaver profile steers judge <anchor> --nothing");
  });
});
