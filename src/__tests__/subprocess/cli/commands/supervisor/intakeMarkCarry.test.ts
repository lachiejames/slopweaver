/**
 * `supervisor intake-mark --as answered` against the shipped binary, on a fixture: a witness routing the owner's turn to a
 * board row carries their words onto that row as a steer before the turn is marked, and a row that cannot take the
 * write refuses, naming the command that would carry them, and marks nothing. `no-ask` carries nothing and stays
 * allowed. The incident it holds down — 20 stretches "routed" to a row whose author never saw them — is
 * `../../../../../supervisor/intakeRoute.ts`'s.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseHandoverDoc } from "../../../../../handover/doc.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SESSION = "5a1c0d2e-7b3f-4c8a-9e6d-2f4b8a1c3e5d";
const TURN = "6b2d1e3f-8c4a-4d9b-8f7e-3a5c9b2d4f6e";
const POINTER = `transcript:${SESSION}#${TURN}`;
const WORDS = "fold the retry budget into the same row";
const SLUG = "the-routed-ask";
const BROKEN = "a-broken-row";

/** A board row's file text; `broken` writes `summary` twice, a front-matter problem every row writer refuses. */
const rowText = ({ slug, broken = false }: { slug: string; broken?: boolean }): string => {
  const twice = broken ? "summary: y\n" : "";
  return `---\nslug: ${slug}\nkind: ask\nsummary: x\n${twice}status: ready\naskedIso: 2026-11-01T09:00:00.000Z\n---\n\n# x\n`;
};

let workspace: string;
let home: string;
let claudeConfig: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "intake-mark-carry-"));
  home = join(workspace, "home");
  mkdirSync(join(home, "handovers", "archive"), { recursive: true });
  writeFileSync(rowPath({ slug: SLUG }), rowText({ slug: SLUG }));
  // A `~/.claude` of the test's own, holding one typed turn of the owner's, so the verb never reads the operator's own.
  claudeConfig = join(workspace, "claude");
  const project = join(claudeConfig, "projects", "-repo");
  mkdirSync(project, { recursive: true });
  const turn = JSON.stringify({
    message: { content: [{ text: WORDS, type: "text" }], role: "user" },
    promptSource: "typed",
    timestamp: "2026-11-01T09:05:00.000Z",
    type: "user",
    uuid: TURN,
  });
  writeFileSync(join(project, `${SESSION}.jsonl`), `${turn}\n`);
});

afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/** Where a live row's file sits, or an archived one's. */
function rowPath({ slug, archived = false }: { slug: string; archived?: boolean }): string {
  if (archived) {
    return join(home, "handovers", "archive", `${slug}.md`);
  }
  return join(home, "handovers", `${slug}.md`);
}

/** Run the shipped CLI against the temp home and the test's own transcripts. */
function cli({ args }: { args: readonly string[] }): { status: number | null; out: string } {
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CONFIG_DIR: claudeConfig,
    CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"),
    SLOPWEAVER_ALLOW_INTAKE_WITNESS_REUSE: undefined,
  };
  const run = spawnSync(BIN, [...args, "--home", home], { cwd: workspace, encoding: "utf8", env });
  return { out: `${run.stdout}${run.stderr}`, status: run.status };
}

/** Mark the one turn. */
function mark({ as, witness }: { as: string; witness: string }): { status: number | null; out: string } {
  return cli({ args: ["supervisor", "intake-mark", "--turn", POINTER, "--as", as, "--witness", witness] });
}

/** The pointers the intake ledger holds marks for, in file order; none when no mark was ever written. */
function markedPointers(): readonly string[] {
  const ledger = join(home, "sessions", "intake-marks.jsonl");
  if (!existsSync(ledger)) {
    return [];
  }
  return readFileSync(ledger, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => (JSON.parse(line) as { pointer: string }).pointer);
}

/** Each steer a row holds, as the kind, anchor and words it carries. */
function rowSteers({ path }: { path: string }): readonly { kind: string; anchor: string; words: string }[] {
  return parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).hisWordsSteers.map((steer) => {
    const held = steer.group as Extract<typeof steer.group, { kind: "held" }>;
    return { anchor: held.hisWords.anchor, kind: steer.group.kind, words: held.hisWords.words };
  });
}

const CARRIED = [{ anchor: POINTER, kind: "held", words: WORDS }];

describe("supervisor intake-mark carrying a routed turn onto its row", () => {
  it("writes the owner's words onto the row the witness routes to, then marks the turn", () => {
    expect(rowSteers({ path: rowPath({ slug: SLUG }) })).toEqual([]);

    const run = mark({ as: "answered", witness: `goes to row ${SLUG}` });

    expect(run.status).toBe(0);
    expect(run.out).toContain(`supervisor intake-mark: carried onto ${SLUG}`);
    expect(rowSteers({ path: rowPath({ slug: SLUG }) })).toEqual(CARRIED);
    expect(markedPointers()).toEqual([POINTER]);
  });

  it("carries a re-mark of the same turn onto the row once, never a second steer", () => {
    expect(mark({ as: "answered", witness: SLUG }).status).toBe(0);
    expect(mark({ as: "answered", witness: `still ${SLUG}` }).status).toBe(0);

    expect(rowSteers({ path: rowPath({ slug: SLUG }) })).toEqual(CARRIED);
    expect(markedPointers()).toEqual([POINTER, POINTER]);
  });

  it("refuses, naming the command that would carry it, and marks nothing when the row will not take the write", () => {
    const broken = rowText({ broken: true, slug: BROKEN });
    writeFileSync(rowPath({ slug: BROKEN }), broken);

    const run = mark({ as: "answered", witness: `goes to row ${BROKEN}` });

    expect(run.status).toBe(1);
    expect(run.out).toContain(`${POINTER} routes to ${BROKEN}, and its words were not carried onto that row`);
    expect(run.out).toContain(`slopweaver handover quote ${BROKEN} --add-steer ${POINTER} --apply --home ${home}`);
    expect(markedPointers()).toEqual([]);
    expect(readFileSync(rowPath({ slug: BROKEN }), "utf8")).toBe(broken);
  });

  it("names a carry command that, run verbatim from a shell with another home, reaches the row that refused", () => {
    writeFileSync(rowPath({ slug: BROKEN }), rowText({ broken: true, slug: BROKEN }));
    const refused = mark({ as: "answered", witness: BROKEN });
    const printed = /`(slopweaver handover quote [^`]+)`/u.exec(refused.out)![1]!;
    writeFileSync(rowPath({ slug: BROKEN }), rowText({ slug: BROKEN }));

    // The printed line once omitted `--home`, so it reached the operator's default home instead.
    // Through a real shell, so the line's own quoting is what is tested; only the binary is swapped in.
    const line = printed.replace(/^slopweaver /u, `'${BIN}' `);
    const elsewhere = join(workspace, "another-home");
    const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeConfig, SLOPWEAVER_HOME: elsewhere };
    const verbatim = spawnSync("/bin/sh", ["-c", line], { cwd: workspace, encoding: "utf8", env });

    expect(refused.status).toBe(1);
    expect(verbatim.status).toBe(0);
    expect(rowSteers({ path: rowPath({ slug: BROKEN }) })).toEqual([{ anchor: POINTER, kind: "held", words: WORDS }]);
    expect(existsSync(join(elsewhere, "handovers"))).toBe(false);
  });

  it("keeps the row it did carry when a later routed row refuses, says so, and marks nothing", () => {
    writeFileSync(rowPath({ slug: BROKEN }), rowText({ broken: true, slug: BROKEN }));

    const run = mark({ as: "answered", witness: `split across ${SLUG} and ${BROKEN}` });

    expect(run.status).toBe(1);
    expect(run.out).toContain(`supervisor intake-mark: carried onto ${SLUG}`);
    expect(run.out).toContain(`routes to ${BROKEN}, and its words were not carried`);
    expect(rowSteers({ path: rowPath({ slug: SLUG }) })).toEqual(CARRIED);
    expect(markedPointers()).toEqual([]);
  });

  it("carries onto an archived row, and the refusal's own command reaches that row too", () => {
    const archived = "an-archived-ask";
    writeFileSync(rowPath({ archived: true, slug: archived }), rowText({ slug: archived }));

    const viaQuote = cli({ args: ["handover", "quote", archived, "--add-steer", POINTER, "--apply"] });
    const viaMark = mark({ as: "answered", witness: archived });

    expect(viaQuote.status).toBe(0);
    expect(viaMark.status).toBe(0);
    expect(rowSteers({ path: rowPath({ archived: true, slug: archived }) })).toEqual(CARRIED);
    expect(markedPointers()).toEqual([POINTER]);
  });

  it("carries onto the file at the slug's own path when a second board file declares the same slug, as quote does", () => {
    const alias = join(home, "handovers", "an-alias.md");
    writeFileSync(alias, rowText({ slug: SLUG }));

    const viaQuote = cli({ args: ["handover", "quote", SLUG, "--add-steer", POINTER, "--apply"] });
    const viaMark = mark({ as: "answered", witness: SLUG });

    expect(viaQuote.status).toBe(0);
    expect(viaMark.status).toBe(0);
    expect(rowSteers({ path: rowPath({ slug: SLUG }) })).toEqual(CARRIED);
    expect(readFileSync(alias, "utf8")).toBe(rowText({ slug: SLUG }));
  });

  it("carries onto a row filed under another name that declares the slug, when no file sits at its own path", () => {
    // Exact-path routing alone saw no row here, and marked the turn answered with the row untouched.
    rmSync(rowPath({ slug: SLUG }));
    const alias = join(home, "handovers", "an-alias.md");
    writeFileSync(alias, rowText({ slug: SLUG }));

    const run = mark({ as: "answered", witness: `goes to row ${SLUG}` });

    expect(run.status).toBe(0);
    expect(run.out).toContain(`supervisor intake-mark: carried onto ${SLUG}`);
    expect(rowSteers({ path: alias })).toEqual(CARRIED);
    expect(markedPointers()).toEqual([POINTER]);
  });

  it("refuses and marks nothing when a witness misses its own path and the board will not list to check further", () => {
    // A failed listing read as "no such slug", so a row filed under another name lost the owner's words.
    rmSync(rowPath({ slug: SLUG }));
    const alias = join(home, "handovers", "an-alias.md");
    writeFileSync(alias, rowText({ slug: SLUG }));
    const board = join(home, "handovers");
    chmodSync(board, 0o311);
    let run: { status: number | null; out: string };
    try {
      run = mark({ as: "answered", witness: SLUG });
    } finally {
      chmodSync(board, 0o755);
    }

    expect(run.status).toBe(1);
    expect(run.out).toContain(`could not tell whether "${SLUG}" routes ${POINTER} to a row — the board would not list`);
    expect(markedPointers()).toEqual([]);
    expect(readFileSync(alias, "utf8")).toBe(rowText({ slug: SLUG }));
  });

  it("refuses and marks nothing when two files declare the routed slug and none sits at its own path", () => {
    rmSync(rowPath({ slug: SLUG }));
    const first = join(home, "handovers", "an-alias.md");
    const second = join(home, "handovers", "a-second-alias.md");
    writeFileSync(first, rowText({ slug: SLUG }));
    writeFileSync(second, rowText({ slug: SLUG }));

    const run = mark({ as: "answered", witness: SLUG });

    expect(run.status).toBe(1);
    expect(run.out).toContain(`"${SLUG}" names no one row on the board — 2 files declare it`);
    // The carry command would hit the same ambiguity, so the refusal names the fix instead.
    expect(run.out).toContain(`Leave "${SLUG}" declared by one file only, then mark the turn again.`);
    expect(run.out).not.toContain("slopweaver handover quote");
    expect(markedPointers()).toEqual([]);
    expect(readFileSync(first, "utf8")).toBe(rowText({ slug: SLUG }));
    expect(readFileSync(second, "utf8")).toBe(rowText({ slug: SLUG }));

    // The remedy it names works: with one declaring file left, the same mark carries and lands.
    rmSync(second);
    const again = mark({ as: "answered", witness: SLUG });

    expect(again.status).toBe(0);
    expect(rowSteers({ path: first })).toEqual(CARRIED);
    expect(markedPointers()).toEqual([POINTER]);
  });

  it("refuses, writes nothing and marks nothing when the pointer's words will not read", () => {
    // A call record not on disk wrote an `unread` placeholder, so the row held the owner's pointer, not their words.
    const call = "talk-call:a0000006-0000-4000-8000-000000000007#segment-1";

    const run = cli({ args: ["supervisor", "intake-mark", "--turn", call, "--as", "answered", "--witness", SLUG] });

    expect(run.status).toBe(1);
    expect(run.out).toContain(`the owner's words at ${call} would not read`);
    expect(run.out).toContain("Mark the turn again once its words read.");
    expect(readFileSync(rowPath({ slug: SLUG }), "utf8")).toBe(rowText({ slug: SLUG }));
    expect(markedPointers()).toEqual([]);
  });

  it("carries nothing for a no-ask mark naming the same row, and still marks it", () => {
    const run = mark({ as: "no-ask", witness: `asked nothing; ${SLUG} already covers it` });

    expect(run.status).toBe(0);
    expect(readFileSync(rowPath({ slug: SLUG }), "utf8")).toBe(rowText({ slug: SLUG }));
    expect(markedPointers()).toEqual([POINTER]);
  });
});
