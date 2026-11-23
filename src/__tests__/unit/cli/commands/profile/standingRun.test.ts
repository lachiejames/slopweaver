/**
 * `profile standing` over a real home in a temp directory and an in-memory store (`../../../../standingAskFixture.ts`,
 * a seam, not a mock): an ask recorded off a relay turn of the owner's, listed, refused when it would overlap, withdrawn,
 * and an old home journal imported once and refused once it changes.
 *
 * Per `testing.md`, every write goes to a `home` this file minted — never the ambient one.
 */
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { profileTail } from "../../../../../cli/commands/profile/core.js";
import { parseProfileStandingArgs } from "../../../../../cli/commands/profile/standingArgs.js";
import { profileStanding } from "../../../../../cli/commands/profile/standingRun.js";
import { PROFILE_STANDING_USAGE } from "../../../../../cli/commands/profile/standingUsage.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { type StandingAskEvent, standingAskLine } from "../../../../../profile/standingAsks.js";
import { formRelayDraft } from "../../../../../talk/relayDraft.js";
import { claimTurn } from "../../../../../talk/relayStore.js";
import { type StandingAskFake, standingAskFake } from "../../../../standingAskFixture.js";

const NOW = "2026-10-09T12:00:00.000Z";
const TURN = "a0000017-0000-4000-8000-000000000019";
const ANCHOR = `talk:${TURN}`;
const HEARD = "if you ever find something that's worth a look, chuck it on the board and investigate it";

let home = "";
let claudeHome = "";
let store: StandingAskFake = standingAskFake();

beforeEach(() => {
  store = standingAskFake();
  home = mkdtempSync(join(tmpdir(), "sw-standing-home-"));
  claudeHome = mkdtempSync(join(tmpdir(), "sw-standing-claude-"));
  const draft = unwrap(
    formRelayDraft({
      about: "",
      heard: HEARD,
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      // The voice's paraphrase, which the quote must never be.
      say: "the owner wants the fleet to investigate anything worth a look",
      turnId: TURN,
      typed: false,
      wordsAlone: false,
    }),
  );
  unwrap(claimTurn({ draft, home, nowIso: "2026-10-04T00:55:00.000Z" }));
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
  const code = await profileStanding({
    args: unwrap(parseProfileStandingArgs({ rest })),
    claudeHome,
    home,
    nowIso: NOW,
    out: (line) => {
      lines.push(line);
    },
    port: store.port,
  });
  return { code, lines };
}

/** The old home journal's path, its directory made. */
function journalPath(): string {
  const dir = join(home, "judgement");
  mkdirSync(dir, { recursive: true });
  return join(dir, "standing-asks.jsonl");
}

/** One recorded event the old journal could hold, quoting the same turn. */
function recordedEvent({ id, covers }: { id: string; covers: readonly string[] }): StandingAskEvent {
  return {
    covers,
    id,
    kind: "recorded",
    quote: { anchor: ANCHOR, atIso: "2026-10-04T00:55:00.000Z", cut: "none", where: "console-voice", words: HEARD },
    recordedAtIso: "2026-10-05T00:00:00.000Z",
  };
}

describe("profileTail", () => {
  it("drops the spoken `standing` token, so the bare list is not read as a mode", () => {
    expect(profileTail({ argv: ["node", "slopweaver", "profile", "standing", "--json"] })).toEqual(["--json"]);
  });
});

describe("parseProfileStandingArgs", () => {
  it("reads add's id, anchor and every coverage", () => {
    const parsed = unwrap(
      parseProfileStandingArgs({ rest: ["add", "org-intel", "--anchor", ANCHOR, "--covers", "findings, act:a.b"] }),
    );
    expect(parsed).toEqual({
      anchor: ANCHOR,
      covers: ["findings", "act:a.b"],
      home: undefined,
      id: "org-intel",
      mode: "add",
      now: undefined,
    });
  });

  it("has no --words: a session never types the quote", () => {
    const parsed = parseProfileStandingArgs({ rest: ["add", "a", "--anchor", ANCHOR, "--words", "x"] });
    expect(unwrapErr(parsed).code).toBe("FLAGS_UNPARSED");
  });

  it("refuses add without --covers, an unknown coverage, and a flag withdraw does not take", () => {
    expect(unwrapErr(parseProfileStandingArgs({ rest: ["add", "a", "--anchor", ANCHOR] })).message).toBe(
      "add needs --covers",
    );
    expect(
      unwrapErr(parseProfileStandingArgs({ rest: ["add", "a", "--anchor", ANCHOR, "--covers", "all"] })).code,
    ).toBe("BAD_COVERAGE");
    expect(unwrapErr(parseProfileStandingArgs({ rest: ["withdraw", "a", "--covers", "findings"] })).message).toBe(
      "--covers is not a flag withdraw takes",
    );
  });

  it("refuses an id that is not a slug, and an unknown mode", () => {
    expect(unwrapErr(parseProfileStandingArgs({ rest: ["withdraw", "Org Intel", "--reason", "x"] })).code).toBe(
      "BAD_ID",
    );
    expect(unwrapErr(parseProfileStandingArgs({ rest: ["show"] })).code).toBe("UNKNOWN_MODE");
  });
});

describe("PROFILE_STANDING_USAGE", () => {
  it("names every coverage --covers accepts, so the help never offers one the parser refuses or hides one it takes", () => {
    const named = ["findings", "registered-rows", "bot-replies", "unlinked-cards", "act:<kind>"];
    expect(named.filter((coverage) => !PROFILE_STANDING_USAGE.includes(coverage))).toEqual([]);
    const parsed = parseProfileStandingArgs({
      rest: ["add", "a", "--anchor", ANCHOR, "--covers", "findings,registered-rows,bot-replies,unlinked-cards,act:a"],
    });
    expect(unwrap(parsed)).toEqual({
      anchor: ANCHOR,
      covers: ["findings", "registered-rows", "bot-replies", "unlinked-cards", "act:a"],
      home: undefined,
      id: "a",
      mode: "add",
      now: undefined,
    });
  });
});

describe("profileStanding", () => {
  it("records an ask off its anchor, the owner's words as the relay heard them, and lists it as JSON", async () => {
    const added = await run({ rest: ["add", "org-intel", "--anchor", ANCHOR, "--covers", "findings,registered-rows"] });
    expect(added).toEqual({
      code: EXIT_OK,
      lines: ["recorded org-intel, covering findings, registered-rows:", `    ${HEARD}`],
    });
    const listed = await run({ rest: ["--json"] });
    expect(listed.code).toBe(EXIT_OK);
    expect(JSON.parse(listed.lines[0]!)).toEqual({
      active: [
        {
          covers: ["findings", "registered-rows"],
          id: "org-intel",
          quote: {
            anchor: ANCHOR,
            atIso: "2026-10-04T00:55:00.000Z",
            cut: "none",
            where: "console-voice",
            words: HEARD,
          },
          recordedAtIso: NOW,
        },
      ],
      kind: "read",
    });
  });

  it("imports an old home journal once, keeping each line exactly, and never writes the file again", async () => {
    const journal = journalPath();
    const first = standingAskLine({ event: recordedEvent({ covers: ["findings"], id: "org-intel" }) });
    writeFileSync(journal, `${first}\n\n`);
    expect(JSON.parse((await run({ rest: ["--json"] })).lines[0]!).active.map((ask: { id: string }) => ask.id)).toEqual(
      ["org-intel"],
    );
    expect(store.state.events.map((event) => [event.journalSeq, event.origin, event.exactLine])).toEqual([
      [1, "legacy-file", first],
    ]);
    expect((await run({ rest: ["withdraw", "org-intel", "--reason", "superseded"] })).code).toBe(EXIT_OK);
    expect(readFileSync(journal, "utf8")).toBe(`${first}\n\n`);
    expect(store.state.events.map((event) => [event.journalSeq, event.origin, event.kind])).toEqual([
      [1, "legacy-file", "recorded"],
      [2, "profile", "withdrawn"],
    ]);
  });

  it("refuses once the old journal changes after its import, rather than dropping what was appended", async () => {
    const journal = journalPath();
    writeFileSync(journal, `${standingAskLine({ event: recordedEvent({ covers: ["findings"], id: "org-intel" }) })}\n`);
    expect((await run({ rest: [] })).code).toBe(EXIT_OK);
    appendFileSync(journal, `${standingAskLine({ event: recordedEvent({ covers: ["bot-replies"], id: "later" }) })}\n`);
    const listed = await run({ rest: [] });
    expect(listed.code).toBe(EXIT_ERROR);
    expect(listed.lines[0]).toContain(`profile standing: ${journal} is not the file the store imported`);
    const added = await run({ rest: ["add", "other", "--anchor", ANCHOR, "--covers", "unlinked-cards"] });
    expect(added.code).toBe(EXIT_ERROR);
    expect(store.state.events.length).toBe(1);
  });

  it("answers from the store once the old journal is moved aside", async () => {
    const journal = journalPath();
    writeFileSync(journal, `${standingAskLine({ event: recordedEvent({ covers: ["findings"], id: "org-intel" }) })}\n`);
    expect((await run({ rest: [] })).code).toBe(EXIT_OK);
    rmSync(journal);
    expect((await run({ rest: [] })).lines[0]).toContain("org-intel  covers findings");
  });

  it("refuses a journal that appears after an import that found none", async () => {
    expect((await run({ rest: ["--json"] })).lines).toEqual(['{"active":[],"kind":"read"}']);
    writeFileSync(
      journalPath(),
      `${standingAskLine({ event: recordedEvent({ covers: ["findings"], id: "late" }) })}\n`,
    );
    expect(JSON.parse((await run({ rest: ["--json"] })).lines[0]!).why).toContain("is not the file the store imported");
  });

  it("reports a journal that does not fold as a defect: a document under --json, exit 1 bare", async () => {
    writeFileSync(journalPath(), "{not json\n");
    const json = await run({ rest: ["--json"] });
    expect(json.code).toBe(EXIT_OK);
    expect(JSON.parse(json.lines[0]!).kind).toBe("defect");
    const bare = await run({ rest: [] });
    expect(bare.code).toBe(EXIT_ERROR);
    expect(bare.lines[0]).toContain("profile standing: ");
    expect(store.state.marker).toBe(undefined);
  });

  it("reports a dangling journal symlink as a defect, never as an empty register", async () => {
    symlinkSync(join(home, "nowhere.jsonl"), journalPath());
    expect(JSON.parse((await run({ rest: ["--json"] })).lines[0]!).kind).toBe("defect");
    expect((await run({ rest: [] })).code).toBe(EXIT_ERROR);
  });

  it("reports a dangling judgement directory link as a defect, never as an empty register", async () => {
    symlinkSync(join(home, "nowhere"), join(home, "judgement"));
    expect(JSON.parse((await run({ rest: ["--json"] })).lines[0]!).kind).toBe("defect");
  });

  it("never imports through a journal symlink, and writes nothing while one stands", async () => {
    const outside = join(home, "outside.jsonl");
    writeFileSync(outside, `${standingAskLine({ event: recordedEvent({ covers: ["findings"], id: "planted" }) })}\n`);
    symlinkSync(outside, journalPath());
    expect(JSON.parse((await run({ rest: ["--json"] })).lines[0]!).kind).toBe("defect");
    expect((await run({ rest: ["add", "org-intel", "--anchor", ANCHOR, "--covers", "findings"] })).code).toBe(
      EXIT_ERROR,
    );
    expect(store.state.events).toEqual([]);
  });

  it("never reads through a judgement directory link to a directory outside the home", async () => {
    const outside = join(home, "elsewhere");
    mkdirSync(outside);
    writeFileSync(join(outside, "standing-asks.jsonl"), "");
    symlinkSync(outside, join(home, "judgement"));
    expect(JSON.parse((await run({ rest: ["--json"] })).lines[0]!).kind).toBe("defect");
    expect((await run({ rest: ["add", "org-intel", "--anchor", ANCHOR, "--covers", "findings"] })).code).toBe(
      EXIT_ERROR,
    );
    expect(readdirSync(outside)).toEqual(["standing-asks.jsonl"]);
    expect(store.state.events).toEqual([]);
  });

  it("reports a write a racing writer beat to an index as a conflict, writing nothing", async () => {
    store.state.raceNextWrite = true;
    const added = await run({ rest: ["add", "org-intel", "--anchor", ANCHOR, "--covers", "findings"] });
    expect(added.code).toBe(EXIT_ERROR);
    expect(added.lines[0]).toContain(
      "profile standing add: another standing-ask write landed first, so this one wrote nothing — run it again: ",
    );
    expect(JSON.parse((await run({ rest: ["--json"] })).lines[0]!)).toEqual({ active: [], kind: "read" });
  });

  it("lists nothing in a home with no store and no journal, and refuses a write there", async () => {
    store.state.connection = "unselected";
    expect((await run({ rest: ["--json"] })).lines).toEqual(['{"active":[],"kind":"read"}']);
    const added = await run({ rest: ["add", "org-intel", "--anchor", ANCHOR, "--covers", "findings"] });
    expect(added).toEqual({
      code: EXIT_ERROR,
      lines: [
        "profile standing add: standing asks are recorded in the store, and this home selects no store: no store is configured",
      ],
    });
  });

  it("refuses to read a home with no store whose journal still waits to be imported", async () => {
    writeFileSync(
      journalPath(),
      `${standingAskLine({ event: recordedEvent({ covers: ["findings"], id: "org-intel" }) })}\n`,
    );
    store.state.connection = "unselected";
    expect(JSON.parse((await run({ rest: ["--json"] })).lines[0]!).why).toBe(
      "standing asks wait in judgement/standing-asks.jsonl to be imported, and this home selects no store: no store is configured",
    );
  });

  it("refuses an anchor whose record does not exist, writing nothing", async () => {
    const missing = "talk:00000000-0000-4000-8000-000000000000";
    const added = await run({ rest: ["add", "ghost", "--anchor", missing, "--covers", "findings"] });
    expect(added.code).toBe(EXIT_ERROR);
    expect(added.lines[0]).toContain("profile standing add: talk:00000000-0000-4000-8000-000000000000 —");
    expect((await run({ rest: [] })).lines).toEqual([
      "no standing asks recorded — `slopweaver profile standing add` records one off its anchor",
    ]);
  });

  it("refuses a second ask over a coverage the first already holds", async () => {
    await run({ rest: ["add", "org-intel", "--anchor", ANCHOR, "--covers", "findings"] });
    const second = await run({ rest: ["add", "other", "--anchor", ANCHOR, "--covers", "bot-replies,findings"] });
    expect(second).toEqual({
      code: EXIT_ERROR,
      lines: [
        "profile standing add: standing ask org-intel already covers findings; one card quotes one standing ask, so withdraw it first",
      ],
    });
  });

  it("withdraws an ask, and refuses one that is not standing", async () => {
    await run({ rest: ["add", "org-intel", "--anchor", ANCHOR, "--covers", "findings"] });
    expect(await run({ rest: ["withdraw", "org-intel", "--reason", "superseded"] })).toEqual({
      code: EXIT_OK,
      lines: ["withdrew org-intel"],
    });
    expect(JSON.parse((await run({ rest: ["--json"] })).lines[0]!)).toEqual({ active: [], kind: "read" });
    expect(await run({ rest: ["withdraw", "org-intel", "--reason", "again"] })).toEqual({
      code: EXIT_ERROR,
      lines: ["profile standing withdraw: no active standing ask org-intel to withdraw"],
    });
  });

  it("records a withdrawn id again as a new generation, its old event kept", async () => {
    await run({ rest: ["add", "org-intel", "--anchor", ANCHOR, "--covers", "findings"] });
    await run({ rest: ["withdraw", "org-intel", "--reason", "superseded"] });
    expect((await run({ rest: ["add", "org-intel", "--anchor", ANCHOR, "--covers", "findings"] })).code).toBe(EXIT_OK);
    expect(store.state.asks.map((ask) => [ask.askId, ask.state, ask.recordedSeq])).toEqual([
      ["org-intel", "withdrawn", 1],
      ["org-intel", "active", 3],
    ]);
    expect(store.state.coverage.map((row) => [row.askRowId, row.state])).toEqual([
      [store.state.asks[0]!.rowId, "withdrawn"],
      [store.state.asks[1]!.rowId, "active"],
    ]);
  });
});
