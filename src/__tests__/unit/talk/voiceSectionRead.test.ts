/**
 * A call replayed over the page's own layout: the owner asked, over the code-ownership briefing, whether anything
 * comes close to satisfying everyone, and if not, why not. The voice read one window from byte 7,800, which ends
 * inside "Platform's boxes", answered from that table, and the owner heard today's CODEOWNERS state as the proposal.
 * The options open at byte 44,613.
 *
 * The page itself is private, so this rebuilds it from the MEASURED heading offsets (`grep -b -o '<h[1-3][^>]*>'
 * ~/.slopweaver/pages/code-ownership-briefing/index.html`) and pads the rest to its 54,311 bytes.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_CODE_BUDGET } from "../../../cli/commands/talk/args.js";
import { fileReadJson } from "../../../cli/commands/talk/fileRun.js";
import { unwrap } from "../../../lib/result.js";
import { type LocalRead, readLocalFile } from "../../../talk/localFile.js";
import { credentialStores } from "../../../talk/localPath.js";

/** The briefing's headings, where each opened, measured on the page the owner had open. */
const MEASURED: readonly { readonly from: number; readonly tag: string; readonly text: string }[] = [
  { from: 7849, tag: "h1", text: "Code ownership: the full history, every objection, and what could tick every box" },
  { from: 10003, tag: "h2", text: "The short version" },
  { from: 13053, tag: "h2", text: "Where it actually stands today" },
  { from: 15318, tag: "h2", text: "Platform's boxes, and whether anyone has ticked them" },
  { from: 18709, tag: "h2", text: "Every objection, by person" },
  {
    from: 18978,
    tag: "h3",
    text: "Rosa Lindqvist (platform lead, owns the settings and the Vanta change-management control)",
  },
  { from: 24818, tag: "h3", text: "Margaret Hamilton (platform)" },
  { from: 27942, tag: "h3", text: "Radia Perlman (platform)" },
  { from: 30401, tag: "h3", text: "Leslie Lamport (platform)" },
  {
    from: 31371,
    tag: "h3",
    text: "Donald Knuth (not platform, but the most active reformer, and they objected to parts of your ideas)",
  },
  { from: 36409, tag: "h2", text: "Where CODEOWNERS blocks you, measured" },
  { from: 41005, tag: "h2", text: "Your script + yaml + CI alternative, restated honestly" },
  { from: 44613, tag: 'h2 id="options"', text: "Options you could bring back" },
  { from: 44710, tag: "h3", text: "A. Close the review gap only" },
  { from: 45309, tag: "h3", text: "B. A, plus drop the catch-all" },
  { from: 45731, tag: "h3", text: "C. B, plus sensitive zones as native rules" },
  { from: 46785, tag: "h3", text: "D. The speed layer (no settings)" },
  { from: 47428, tag: "h3", text: "E. Revive the script gate" },
  { from: 48156, tag: "h2", text: "What we still don't know" },
];

/** The page's measured size. */
const PAGE_BYTES = 54_311;

/** Where the voice's one read of it opened. */
const VOICE_FROM = 7800;

/** One option card's body, written under each A–E heading. */
const CARD_BODY = "<p>Ticks and costs of this option.</p>\n";

/**
 * Harmless filler of exactly `bytes` ASCII bytes, broken into lines as a page's prose is.
 *
 * @param bytes how many
 * @returns the filler
 */
function filler({ bytes }: { bytes: number }): string {
  return `${".".repeat(99)}\n`.repeat(Math.ceil(bytes / 100)).slice(0, bytes);
}

/**
 * The briefing rebuilt: each measured heading at its measured byte, an option card's body under each of A–E.
 *
 * @returns the page's text
 */
function briefing(): string {
  let page = "";
  for (const heading of MEASURED) {
    page += filler({ bytes: heading.from - page.length });
    page += `<${heading.tag}>${heading.text}</${heading.tag.split(" ")[0]!}>\n`;
    if (/^[A-E]\. /u.test(heading.text)) {
      page += CARD_BODY;
    }
  }
  return page + filler({ bytes: PAGE_BYTES - page.length });
}

let home = "";

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "voice-section-")));
  writeFileSync(join(home, "index.html"), briefing());
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * One `file_read` of the rebuilt briefing, as the voice makes it.
 *
 * @param from the byte offset the window opens at
 * @returns the text window
 */
function readFrom({ from }: { from: number }): LocalRead {
  const read = unwrap(
    readLocalFile({
      budget: DEFAULT_CODE_BUDGET,
      from,
      policy: {
        denylist: [],
        homeDir: home,
        protectedPaths: [],
        refusalsLifted: false,
        stores: credentialStores({ homeDir: home, homeEntries: [], slopweaverHomes: [join(home, ".slopweaver")] }),
      },
      raw: "~/index.html",
    }),
  );
  if (read.kind !== "text") {
    throw new Error(`expected a text window, got a ${read.mediaType} picture`);
  }
  return read;
}

describe("a question about the briefing's proposals, from the window the voice actually read", () => {
  it("rebuilds the page at its measured size, each heading at its measured byte", () => {
    const bytes = Buffer.from(briefing(), "utf8");
    expect(bytes.length).toBe(PAGE_BYTES);
    expect(bytes.subarray(44_613, 44_613 + 17).toString("utf8")).toBe('<h2 id="options">');
  });

  it("held no proposal in the window from 7,800, so the old answer could only come from a neighbour", () => {
    const read = readFrom({ from: VOICE_FROM });
    expect(read.text).toContain("Platform's boxes, and whether anyone has ticked them");
    expect(read.text).not.toContain("Options you could bring back");
    expect(read.window.end).toBeLessThan(44_613);
  });

  it("names the options heading and its byte in that same window's outline", () => {
    const read = readFrom({ from: VOICE_FROM });
    expect(read.outline).toContainEqual({ from: 44_613, level: 2, text: "Options you could bring back" });
    // Nineteen headings against a cap of sixteen: all nine h1/h2s, then the first seven h3s, cards C–E left out.
    expect(read.outline.map((heading) => heading.from)).toEqual([
      7849, 10_003, 13_053, 15_318, 18_709, 18_978, 24_818, 27_942, 30_401, 31_371, 36_409, 41_005, 44_613, 44_710,
      45_309, 48_156,
    ]);
    expect(fileReadJson({ read })).toContain('{"from":44613,"level":2,"text":"Options you could bring back"}');
  });

  it("reads the options, every card, with one more call at that heading's from", () => {
    const options = readFrom({ from: 44_613 });
    expect(options.text.startsWith('<h2 id="options">Options you could bring back</h2>\n')).toBe(true);
    for (const card of MEASURED.filter((heading) => /^[A-E]\. /u.test(heading.text))) {
      expect(options.text).toContain(`<h3>${card.text}</h3>\n${CARD_BODY}`);
    }
  });
});
