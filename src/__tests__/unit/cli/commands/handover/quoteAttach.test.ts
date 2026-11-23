/**
 * `handover quote <slug> --anchor <anchor>` over a real throwaway board: an unanchored row is tied to the owner's words and
 * quoted in one write, every refusal the attach owes fires before anything is written, and a later bulk run keeps
 * the quote it wrote.
 *
 * Per `testing.md`, every write goes to a `home` this file minted — never the ambient one.
 */
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { planAttach, runQuoteAttach } from "../../../../../cli/commands/handover/quoteAttach.js";
import { quoteVerdict } from "../../../../../cli/commands/handover/quotePlan.js";
import { readRowAnchor } from "../../../../../cli/commands/handover/quoteRow.js";
import { runHandoverQuote } from "../../../../../cli/commands/handover/quoteRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { unwrap } from "../../../../../lib/result.js";
import { writeSupervisorPin } from "../../../../../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { appendSupervisorLink } from "../../../../../supervisor/chainStore.js";
import { formRelayDraft } from "../../../../../talk/relayDraft.js";
import { claimTurn } from "../../../../../talk/relayStore.js";

const TURN = "a0000015-0000-4000-8000-000000000016";
const STAGED = "2026-10-04T06:03:54.584Z";
const SESSION = "6d2f8b55-ae1c-4a4f-b3d9-7c8e2f1a0b42";
const TYPED_UUID = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f";
const RELAY_UUID = "1c2d3e4f-5061-4728-893a-4b5c6d7e8f90";
const TYPED_AT = "2026-10-04T05:00:00.000Z";

/** An ask registered with no anchor, so its card says nothing records whose words are behind it. */
const UNANCHORED = [
  "---",
  "slug: an-ask",
  "kind: ask",
  "summary: an ask a session registered by hand",
  "status: ready",
  "askedIso: 2026-10-04T09:00:00.000Z",
  "artifact: null",
  "---",
  "",
  "# body",
  "",
].join("\n");

let home = "";
let dir = "";
let projectsDir = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "quote-attach-"));
  dir = join(home, "handovers");
  projectsDir = join(home, "projects");
  mkdirSync(join(dir, "archive"), { recursive: true });
  writeFileSync(join(dir, "an-ask.md"), UNANCHORED);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Stage a typed console turn of the owner's. */
function typedTurn({ heard }: { heard: string }): void {
  const draft = unwrap(
    formRelayDraft({
      about: "",
      heard,
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "",
      turnId: TURN,
      typed: true,
      wordsAlone: false,
    }),
  );
  unwrap(claimTurn({ draft, home, nowIso: STAGED }));
}

/** A supervisor pin on `sessionId` at `at`: its journal line and the live pin record, as `cmux takeover` writes both. */
function pinAt({ sessionId, at }: { sessionId: string; at: string }): void {
  const record = {
    session: { host: "claude-code" as const, id: sessionId },
    pinnedAtIso: at,
    workspaceId: "ws-1",
    workspaceRef: "w:1",
  };
  appendSupervisorLink({ home, link: { ...record, source: "pin" } });
  writeSupervisorPin({ home, record });
}

/** Write one supervisor session, pinned before the owner typed, holding a turn they typed and a relay line the console typed. */
function session(): void {
  pinAt({ at: "2026-10-04T04:00:00.000Z", sessionId: SESSION });
  const line = ({ uuid, text }: { uuid: string; text: string }): string =>
    JSON.stringify({
      cwd: "/repo",
      message: { content: [{ text, type: "text" }], role: "user" },
      promptSource: "typed",
      timestamp: TYPED_AT,
      type: "user",
      uuid,
    });
  mkdirSync(join(projectsDir, "-repo"), { recursive: true });
  writeFileSync(
    join(projectsDir, "-repo", `${SESSION}.jsonl`),
    [
      line({ text: "move the atlas to friday", uuid: TYPED_UUID }),
      line({ text: "[voice relay talk-1] the owner asked for the atlas", uuid: RELAY_UUID }),
      "",
    ].join("\n"),
  );
}

/** Run the attach mode, collecting what it prints and refuses. */
async function attach({ rest, apply }: { rest: readonly string[]; apply: boolean }): Promise<{
  readonly code: number;
  readonly out: readonly string[];
  readonly fail: readonly string[];
}> {
  const out: string[] = [];
  const fail: string[] = [];
  const code = await runQuoteAttach({
    anchor: `talk:${TURN}`,
    apply,
    check: false,
    handoverDir: dir,
    home,
    json: false,
    sink: {
      fail: (line) => {
        fail.push(line);
      },
      out: (line) => {
        out.push(line);
      },
    },
    slugs: rest,
  });
  return { code, fail, out };
}

/** The row as it now reads. */
function row(): string {
  return readFileSync(join(dir, "an-ask.md"), "utf8");
}

describe("handover quote --anchor", () => {
  it("prints what it would write and writes nothing without --apply", async () => {
    typedTurn({ heard: "ship the atlas" });

    const { code, out } = await attach({ apply: false, rest: ["an-ask"] });

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([
      `handover quote: an-ask — would anchor on talk:${TURN} and quoted the owner's words of ${STAGED}`,
      "handover quote: dry run — add --apply to write it",
    ]);
    expect(row()).toBe(UNANCHORED);
  });

  it("writes the anchor and the quote in one write, leaving askedIso for a relay anchor", async () => {
    typedTurn({ heard: "ship the atlas" });

    const { code } = await attach({ apply: true, rest: ["an-ask"] });
    const doc = parseHandoverDoc({ path: join(dir, "an-ask.md"), text: row() });

    expect(code).toBe(EXIT_OK);
    expect([doc.anchor, doc.askedIso, doc.problems]).toEqual([`talk:${TURN}`, "2026-10-04T09:00:00.000Z", []]);
    expect(doc.hisWords).toEqual({
      hisWords: { anchor: `talk:${TURN}`, atIso: STAGED, cut: "none", where: "console-typed", words: "ship the atlas" },
      kind: "held",
    });
  });

  it("leaves the quote current for a bulk run after it", async () => {
    typedTurn({ heard: "ship the atlas" });
    await attach({ apply: true, rest: ["an-ask"] });
    const doc = parseHandoverDoc({ path: join(dir, "an-ask.md"), text: row() });

    expect(quoteVerdict({ doc, read: readRowAnchor({ doc, home }) }).kind).toBe("current");
    const after = row();
    expect(
      await runHandoverQuote(["node", "slopweaver", "handover", "quote", "--apply", "--home", home, "--dir", dir]),
    ).toBe(EXIT_OK);
    expect(row()).toBe(after);
  });

  it("refuses a row that already has an anchor, and writes nothing", async () => {
    typedTurn({ heard: "ship the atlas" });
    const anchored = UNANCHORED.replace(
      "artifact: null",
      "anchor: https://example.slack.com/archives/C1/p1\nartifact: null",
    );
    writeFileSync(join(dir, "an-ask.md"), anchored);

    const { code, fail } = await attach({ apply: true, rest: ["an-ask"] });

    expect(code).toBe(EXIT_ERROR);
    expect(fail).toEqual([
      "handover quote: an-ask already anchors on https://example.slack.com/archives/C1/p1 — re-anchoring changes " +
        "what the row is, so it is refused",
    ]);
    expect(row()).toBe(anchored);
  });

  it("refuses a row declaring an empty anchor: line rather than writing a second one", async () => {
    typedTurn({ heard: "ship the atlas" });
    const declared = UNANCHORED.replace("artifact: null", "anchor:\nartifact: null");
    writeFileSync(join(dir, "an-ask.md"), declared);

    const { code, fail } = await attach({ apply: true, rest: ["an-ask"] });

    expect(code).toBe(EXIT_ERROR);
    expect(fail).toEqual([
      "handover quote: an-ask already declares an anchor: line, empty or not — fill it by hand or remove it first",
    ]);
    expect(row()).toBe(declared);
  });

  // The anchor edit normalises CRLF, so the bulk writer's refusal must see the bytes as read.
  it("refuses a CRLF row as the bulk writer does, leaving every byte of it", async () => {
    typedTurn({ heard: "ship the atlas" });
    const crlf = UNANCHORED.replaceAll("\n", "\r\n");
    writeFileSync(join(dir, "an-ask.md"), crlf);

    const { code, fail } = await attach({ apply: true, rest: ["an-ask"] });

    expect([code, fail.length, row()]).toEqual([EXIT_ERROR, 1, crlf]);
    expect(fail[0]).toContain("the row carries CR line endings, and rewriting its quote would change every line of it");
  });

  // A lossy decode would write U+FFFD over a byte of the body the attach never meant to touch.
  it("refuses a row that is not valid UTF-8 as the bulk writer does, leaving every byte of it", async () => {
    typedTurn({ heard: "ship the atlas" });
    const bytes = Buffer.concat([Buffer.from(UNANCHORED, "utf8"), Buffer.from([0xff, 0x0a])]);
    writeFileSync(join(dir, "an-ask.md"), bytes);

    const { code, fail } = await attach({ apply: true, rest: ["an-ask"] });

    expect([code, fail.length, readFileSync(join(dir, "an-ask.md")).equals(bytes)]).toEqual([EXIT_ERROR, 1, true]);
    expect(fail[0]).toContain(
      "the row is not valid UTF-8, and rewriting its quote would change the bytes that are not",
    );
  });

  it("refuses an archived row by name", async () => {
    typedTurn({ heard: "ship the atlas" });
    rmSync(join(dir, "an-ask.md"));
    writeFileSync(join(dir, "archive", "an-ask.md"), UNANCHORED);

    const { code, fail } = await attach({ apply: true, rest: ["an-ask"] });

    expect(code).toBe(EXIT_ERROR);
    expect(fail).toEqual(["handover quote: an-ask is archived, so it has no card to quote on"]);
  });

  it("refuses an anchor whose words would not read, and writes nothing", async () => {
    const { code, fail } = await attach({ apply: true, rest: ["an-ask"] });

    expect(code).toBe(EXIT_ERROR);
    expect(fail.length).toBe(1);
    expect(fail[0]).toContain("no relay turn file carries it");
    expect(row()).toBe(UNANCHORED);
  });

  it("is reached through the verb's own argv, and refuses --check beside --anchor there", async () => {
    typedTurn({ heard: "ship the atlas" });
    const verb = (extra: readonly string[]): Promise<number> =>
      runHandoverQuote([
        "node",
        "slopweaver",
        "handover",
        "quote",
        "an-ask",
        "--anchor",
        `talk:${TURN}`,
        ...extra,
        "--home",
        home,
        "--dir",
        dir,
      ]);

    expect([await verb(["--check"]), await verb(["--apply"])]).toEqual([EXIT_USAGE, EXIT_OK]);
    expect(parseHandoverDoc({ path: join(dir, "an-ask.md"), text: row() }).anchor).toBe(`talk:${TURN}`);
  });

  it("refuses --anchor beside --add-steer as a usage mistake, and writes nothing", async () => {
    typedTurn({ heard: "ship the atlas" });

    const code = await runHandoverQuote([
      "node",
      "slopweaver",
      "handover",
      "quote",
      "an-ask",
      "--anchor",
      `talk:${TURN}`,
      "--add-steer",
      `talk:${TURN}`,
      "--apply",
      "--home",
      home,
      "--dir",
      dir,
    ]);

    expect([code, row()]).toEqual([EXIT_USAGE, UNANCHORED]);
  });

  it("refuses an anchor the row already relates as a further steer, since the card would quote it twice", async () => {
    typedTurn({ heard: "ship the atlas" });
    const steered = UNANCHORED.replace(
      "artifact: null",
      `ownerWordsSteer1Anchor: talk:${TURN}\nownerWordsSteer1Unread: not read yet\nartifact: null`,
    );
    writeFileSync(join(dir, "an-ask.md"), steered);

    const { code, fail } = await attach({ apply: true, rest: ["an-ask"] });

    expect(code).toBe(EXIT_ERROR);
    expect(fail).toEqual([
      `handover quote: an-ask already relates talk:${TURN} as a further steer, so its card would quote it twice`,
    ]);
    expect(row()).toBe(steered);
  });

  it("refuses no slug, two slugs and --check as usage mistakes", async () => {
    const none = await attach({ apply: false, rest: [] });
    const two = await attach({ apply: false, rest: ["an-ask", "other"] });
    const check = await runQuoteAttach({
      anchor: `talk:${TURN}`,
      apply: false,
      check: true,
      handoverDir: dir,
      home,
      json: false,
      sink: { fail: () => undefined, out: () => undefined },
      slugs: ["an-ask"],
    });

    expect([none.code, two.code, check]).toEqual([EXIT_USAGE, EXIT_USAGE, EXIT_USAGE]);
    expect(two.fail).toEqual([
      "handover quote: --anchor ties one row to the owner's words — name exactly one slug, got 2",
    ]);
  });

  it("refuses a slug that reaches outside the board, leaving the file it names untouched", async () => {
    typedTurn({ heard: "ship the atlas" });
    const outside = UNANCHORED.replace("slug: an-ask", "slug: ../outside");
    writeFileSync(join(home, "outside.md"), outside);

    const { code, fail } = await attach({ apply: true, rest: ["../outside"] });

    expect(code).toBe(EXIT_USAGE);
    expect(fail).toEqual([
      "handover quote: ../outside is not a row's slug — a slug is a plain name inside the board directory",
    ]);
    expect(readFileSync(join(home, "outside.md"), "utf8")).toBe(outside);
  });

  it("refuses a row that is a symlink to a file off the board, leaving both untouched", async () => {
    typedTurn({ heard: "ship the atlas" });
    const outside = join(home, "outside.md");
    writeFileSync(outside, UNANCHORED);
    rmSync(join(dir, "an-ask.md"));
    symlinkSync(outside, join(dir, "an-ask.md"));

    const { code, fail } = await attach({ apply: true, rest: ["an-ask"] });

    expect(code).toBe(EXIT_ERROR);
    expect(fail).toEqual([
      `handover quote: ${join(dir, "an-ask.md")} is not a regular file inside the board directory, so it is not rewritten`,
    ]);
    expect([lstatSync(join(dir, "an-ask.md")).isSymbolicLink(), readFileSync(outside, "utf8")]).toEqual([
      true,
      UNANCHORED,
    ]);
  });
});

describe("planAttach — a supervisor turn", () => {
  it("re-dates askedIso to the instant the owner typed it", () => {
    session();

    const plan = planAttach({
      anchor: `transcript:${SESSION}#${TYPED_UUID}`,
      handoverDir: dir,
      home,
      projectsDir,
      slug: "an-ask",
    });

    expect("after" in plan).toBe(true);
    const doc = parseHandoverDoc({ path: join(dir, "an-ask.md"), text: (plan as { after: string }).after });
    expect([doc.anchor, doc.askedIso, doc.problems]).toEqual([`transcript:${SESSION}#${TYPED_UUID}`, TYPED_AT, []]);
  });

  it("finds the turn under CLAUDE_CONFIG_DIR through the verb, the same home profile words reads", async () => {
    session();
    const before = process.env["CLAUDE_CONFIG_DIR"];
    process.env["CLAUDE_CONFIG_DIR"] = home;
    const out: string[] = [];
    try {
      const code = await runQuoteAttach({
        anchor: `transcript:${SESSION}#${TYPED_UUID}`,
        apply: false,
        check: false,
        handoverDir: dir,
        home,
        json: false,
        sink: {
          fail: (line) => {
            out.push(line);
          },
          out: (line) => {
            out.push(line);
          },
        },
        slugs: ["an-ask"],
      });
      expect(code).toBe(EXIT_OK);
    } finally {
      if (before === undefined) {
        delete process.env["CLAUDE_CONFIG_DIR"];
      } else {
        process.env["CLAUDE_CONFIG_DIR"] = before;
      }
    }
    expect(out[0]).toBe(
      `handover quote: an-ask — would anchor on transcript:${SESSION}#${TYPED_UUID} and quoted the owner's words of ${TYPED_AT}, ` +
        `askedIso re-dated to ${TYPED_AT}`,
    );
  });

  it("refuses the console's relay line, pointing at the relay itself", () => {
    session();

    const plan = planAttach({
      anchor: `transcript:${SESSION}#${RELAY_UUID}`,
      handoverDir: dir,
      home,
      projectsDir,
      slug: "an-ask",
    });

    expect(plan).toEqual({
      refusals: [
        `transcript:${SESSION}#${RELAY_UUID} — transcript:${SESSION}#${RELAY_UUID} is a line the console typed ` +
          "into the chair, not words the owner wrote — anchor on the relay itself (talk:<turn>) or the call words a wake " +
          "points at (talk-call:<call>#<segment>), which `slopweaver profile words` lists",
      ],
    });
  });

  it("refuses a turn typed after another session took the pin, as profile words does, and writes nothing", () => {
    session();
    pinAt({ at: "2026-10-04T04:30:00.000Z", sessionId: "a0000108-0000-4000-8000-000000000119" });

    const plan = planAttach({
      anchor: `transcript:${SESSION}#${TYPED_UUID}`,
      handoverDir: dir,
      home,
      projectsDir,
      slug: "an-ask",
    });

    expect([plan, row()]).toEqual([
      {
        refusals: [
          `transcript:${SESSION}#${TYPED_UUID} was typed while that session did not hold the supervisor pin, so it ` +
            "is not read as the owner's — only a chair's turns inside its tenure are",
        ],
      },
      UNANCHORED,
    ]);
  });

  it("refuses a turn when the live pin names another chair with no readable instant, and writes nothing", () => {
    session();
    writeSupervisorPin({
      home,
      record: {
        session: { host: "claude-code", id: "a0000108-0000-4000-8000-000000000119" },
        pinnedAtIso: "not-an-instant",
        workspaceId: "ws-2",
        workspaceRef: "w:2",
      },
    });

    const plan = planAttach({
      anchor: `transcript:${SESSION}#${TYPED_UUID}`,
      handoverDir: dir,
      home,
      projectsDir,
      slug: "an-ask",
    });

    expect([plan, row()]).toEqual([
      {
        refusals: [
          `transcript:${SESSION}#${TYPED_UUID} was typed while that session did not hold the supervisor pin, so it ` +
            "is not read as the owner's — only a chair's turns inside its tenure are (the supervisor pin record at " +
            `${stateHomePaths({ home }).supervisorPinJson} carries no readable pinnedAtIso; with the pin record ` +
            "unreadable, who holds the pin now is unknown, so the journal's last chair was not read from its last link on)",
        ],
      },
      UNANCHORED,
    ]);
  });
});
