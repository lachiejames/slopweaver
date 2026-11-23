/**
 * `handover register`'s anchor-attribution refusal over a real throwaway corpus: one Slack bronze window holding the
 * acme-admin review ask Kieran Mendez posted, and a derived roster naming Kieran Mendez and Theo Marsh.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  anchorAttributionRefused,
  anchorAuthor,
  coveringWindows,
} from "../../../../../cli/commands/handover/anchorAttributionGate.js";
import { bronzeSourceDir, silverIdentitiesPath } from "../../../../../corpus/corpusPaths.js";

const ANCHOR = "https://acme.slack.com/archives/C0SYN000014/p1791159813645479";
const RECORD = {
  author: "U0SYN000014",
  kind: "message",
  source: "slack",
  sourceId: "C0SYN000014:1791159813.645479",
  tsIso: "2026-10-05T00:23:33.000Z",
  url: ANCHOR,
};
const ROSTER = {
  candidates: [],
  conflicts: [],
  people: [
    {
      confidence: "email",
      id: "person:kieran",
      identities: [{ handle: "kieran.mendez", name: "Kieran Mendez", nativeId: "U0SYN000014", source: "slack" }],
    },
    {
      confidence: "single-source",
      id: "person:theo",
      identities: [{ handle: "theo.marsh", name: "Theo Marsh", nativeId: "U0SYNTHEOMARSH", source: "slack" }],
    },
    {
      confidence: "single-source",
      id: "person:helpbot",
      identities: [{ handle: "helpbot", name: "Helpbot", nativeId: "helpbot", source: "linear" }],
      kind: "person",
    },
  ],
};

let home = "";

/**
 * Write one corpus file under the throwaway home, making its directory.
 *
 * @param path where it goes
 * @param text what it holds
 */
function put({ path, text }: { path: string; text: string }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/**
 * Run the gate over the throwaway home, collecting what it prints.
 *
 * @param texts the row's summary and scenes
 * @param env the environment the hatch is read from
 * @returns whether it refused, and its lines
 */
function gate({ texts, env = {} }: { texts: readonly string[]; env?: NodeJS.ProcessEnv }): {
  refused: boolean;
  lines: string[];
} {
  const lines: string[] = [];
  const refused = anchorAttributionRefused({
    anchor: ANCHOR,
    env,
    home,
    out: ({ line }) => {
      lines.push(line);
    },
    texts,
  });
  return { lines, refused };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "aag-home-"));
  put({ path: silverIdentitiesPath({ home }), text: JSON.stringify(ROSTER) });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("coveringWindows", () => {
  it("keeps the window files whose days include the day, never the compacted file", () => {
    expect(
      coveringWindows({
        day: "2026-10-05",
        entries: [
          "compact.jsonl",
          "2026-10-04_2026-10-05.jsonl",
          "2026-10-05_2026-10-06.jsonl",
          "2026-10-06_2026-10-07.jsonl",
        ],
      }),
    ).toEqual(["2026-10-04_2026-10-05.jsonl", "2026-10-05_2026-10-06.jsonl"]);
  });
});

describe("anchorAttributionRefused", () => {
  beforeEach(() => {
    const dir = bronzeSourceDir({ home, source: "slack" });
    put({
      path: join(dir, "2026-10-04_2026-10-06.jsonl"),
      text: `${JSON.stringify({ ...RECORD, author: "U0OTHER", sourceId: "C0SYN000014:1791150000.000001" })}\n${JSON.stringify(RECORD)}\n`,
    });
  });

  it("refuses the incident: Theo named as asking over the message Kieran posted", () => {
    const { refused, lines } = gate({ texts: ["Theo asked @platform-eng to review and ship it this morning."] });
    expect(refused).toBe(true);
    expect(lines[0]).toContain(`the row says "Theo asked", but ${ANCHOR} was posted by Kieran Mendez (U0SYN000014)`);
    expect(lines[2]).toBe(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_ANCHOR_ATTRIBUTION=1 slopweaver handover register.",
    );
  });

  it("passes the recut text naming Kieran", () => {
    expect(gate({ texts: ["Kieran asked @platform-eng to review and ship it this morning."] })).toEqual({
      lines: [],
      refused: false,
    });
  });

  it("passes a name before a verb that belongs to nobody Slack ever saw", () => {
    expect(gate({ texts: ["Helpbot said the fix is safe; platform ships it."] })).toEqual({
      lines: [],
      refused: false,
    });
  });

  it("lets the hatch through, and says the override is in force", () => {
    const { refused, lines } = gate({
      env: { SLOPWEAVER_ALLOW_ANCHOR_ATTRIBUTION: "1" },
      texts: ["Theo tagged @platform-eng"],
    });
    expect(refused).toBe(false);
    expect(lines).toEqual([
      `anchor-attribution: override in force — the row says "Theo tagged", and Kieran Mendez posted ${ANCHOR}`,
    ]);
  });
});

describe("anchorAuthor", () => {
  it("names the author off the covering window", () => {
    put({
      path: join(bronzeSourceDir({ home, source: "slack" }), "2026-10-05_2026-10-06.jsonl"),
      text: JSON.stringify(RECORD),
    });
    expect(anchorAuthor({ anchor: ANCHOR, home })).toMatchObject({
      author: { id: "person:kieran" },
      kind: "found",
      userId: "U0SYN000014",
    });
  });

  it("is unchecked, never refused, when only the compacted file holds the message", () => {
    put({ path: join(bronzeSourceDir({ home, source: "slack" }), "compact.jsonl"), text: JSON.stringify(RECORD) });
    expect(anchorAuthor({ anchor: ANCHOR, home })).toEqual({
      kind: "unchecked",
      why: "no Slack bronze window covering 2026-10-05 holds the message (0 window file(s) read; the compacted file is never scanned here)",
    });
    const { refused, lines } = gate({ texts: ["Theo asked"] });
    expect(refused).toBe(false);
    expect(lines).toEqual([
      `anchor-attribution: who the row says posted ${ANCHOR} was not checked — no Slack bronze window covering 2026-10-05 holds the message (0 window file(s) read; the compacted file is never scanned here)`,
    ]);
  });

  it("names a reply's author off the id the corpus stores a reply under", () => {
    const reply =
      "https://acme.slack.com/archives/C0SYN000014/p1791160502396539?thread_ts=1791159813.645479&cid=C0SYN000014";
    put({
      path: join(bronzeSourceDir({ home, source: "slack" }), "2026-10-05_2026-10-06.jsonl"),
      text: JSON.stringify({
        ...RECORD,
        sourceId: "C0SYN000014:1791159813.645479:reply:1791160502.396539",
        url: reply,
      }),
    });
    expect(anchorAuthor({ anchor: reply, home })).toMatchObject({ kind: "found", userId: "U0SYN000014" });
  });

  it("is unchecked, never a throw, when a covering window will not read", () => {
    const window = join(bronzeSourceDir({ home, source: "slack" }), "2026-10-05_2026-10-06.jsonl");
    mkdirSync(window, { recursive: true });
    expect(anchorAuthor({ anchor: ANCHOR, home })).toEqual({
      kind: "unchecked",
      why: `the Slack bronze window ${window} does not read`,
    });
    expect(gate({ texts: ["Theo asked"] }).refused).toBe(false);
  });

  it("is not-slack for a transcript anchor and for none", () => {
    expect(anchorAuthor({ anchor: "talk:2ee0724d", home })).toEqual({ kind: "not-slack" });
    expect(anchorAuthor({ anchor: undefined, home })).toEqual({ kind: "not-slack" });
  });
});
