/**
 * One default window of `talk file read` and `talk code read` fits the console page's tool cap, serialised exactly
 * as the verb prints it — a call where a 29 KB published page came back to the voice as a bare
 * "ask for less of it" notice because the default window was 256 KiB and the model could not ask for less. The cap
 * is UTF-8 bytes since the page keeps each answer on the call file.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_CODE_BUDGET } from "../../../cli/commands/talk/args.js";
import { codeReadJson } from "../../../cli/commands/talk/codeRun.js";
import { fileReadJson } from "../../../cli/commands/talk/fileRun.js";
import { unwrap } from "../../../lib/result.js";
import { readTrackedFile } from "../../../talk/checkout.js";
import { type LocalRead, readLocalFile } from "../../../talk/localFile.js";
import { credentialStores } from "../../../talk/localPath.js";
import {
  PAGE_OUTLINE_MAX_ENTRIES,
  PAGE_OUTLINE_TEXT_MAX_CHARS,
  PAGE_TOOL_ANSWER_MAX_BYTES,
} from "../../../talk/pageOutline.js";

/** `site/components/live/talkSession.ts`'s `TOOL_OUTPUT_MAX`, which `src/` cannot import. */
const PAGE_TOOL_CAP = 24 * 1024;

/** The old default, kept here as the witness that the worst case really does overflow at it. */
const OLD_BUDGET = 262_144;

/** The worst printable case: every byte a `"`, which JSON escapes to two characters, and no line break to cut at. */
const WORST = '"'.repeat(40 * 1024);

let home = "";

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "voice-window-")));
  mkdirSync(join(home, ".slopweaver", "pages", "big"), { recursive: true });
  writeFileSync(join(home, ".slopweaver", "pages", "big", "index.html"), WORST);
  writeFileSync(join(home, "big.ts"), WORST);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * One answer's size as the page's tool cap counts it.
 *
 * @param text the answer line the verb prints
 * @returns its UTF-8 bytes
 */
function bytesOf({ text }: { text: string }): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Read one window of a file under the throwaway home as `talk file read` would.
 *
 * @param budget the window size asked for
 * @param from the byte offset the window opens at
 * @param raw the `~/` path
 * @returns the text window
 */
function pageAtPath({ budget, from, raw }: { budget: number; from: number; raw: string }): LocalRead {
  const read = unwrap(
    readLocalFile({
      budget,
      from,
      policy: {
        denylist: [],
        homeDir: home,
        protectedPaths: [],
        refusalsLifted: false,
        stores: credentialStores({ homeDir: home, homeEntries: [], slopweaverHomes: [join(home, ".slopweaver")] }),
      },
      raw,
    }),
  );
  if (read.kind !== "text") {
    throw new Error(`expected a text window, got a ${read.mediaType} picture`);
  }
  return read;
}

/**
 * Read the worst-case page from its start, at one budget.
 *
 * @param budget the window size asked for
 * @returns the text window
 */
function pageAt({ budget }: { budget: number }): LocalRead {
  return pageAtPath({ budget, from: 0, raw: "~/.slopweaver/pages/big/index.html" });
}

describe("the voice's default read window", () => {
  it("fits a worst-case published page's file_read answer inside the page's tool cap, and pages on", () => {
    const read = pageAt({ budget: DEFAULT_CODE_BUDGET });
    expect(bytesOf({ text: fileReadJson({ read }) })).toBeLessThanOrEqual(PAGE_TOOL_CAP);
    expect(read.window.nextFrom).toBe(DEFAULT_CODE_BUDGET);
  });

  it("overflowed the cap at the old 256 KiB default, so the bound above is the change", () => {
    expect(bytesOf({ text: fileReadJson({ read: pageAt({ budget: OLD_BUDGET }) }) })).toBeGreaterThan(PAGE_TOOL_CAP);
  });

  it("masks a secret block scalar on every window when it is paged at the default, its key line one window back", () => {
    const body = Array.from(
      { length: 199 },
      (_, line) => `  bodyline-${String(line).padStart(4, "0")}-${"q".repeat(63)}`,
    );
    const raw = `client_secret: |\n${body.join("\n")}\nnext: plain\n`;
    writeFileSync(join(home, "creds.yaml"), raw);
    const texts: string[] = [];
    let from: number | null = 0;
    while (from !== null) {
      const window = pageAtPath({ budget: DEFAULT_CODE_BUDGET, from, raw: "~/creds.yaml" });
      texts.push(window.text);
      from = window.window.nextFrom;
    }
    expect(raw.match(/bodyline-/gu)!.length).toBe(199);
    expect(texts.length).toBe(2);
    expect(texts.join("").match(/bodyline-/gu)).toBeNull();
    expect(texts.join("")).toContain("next: plain");
  });

  it("fits a worst-case window AND a full worst-case outline inside the page's tool cap", () => {
    const heading = `<h2>${'"'.repeat(PAGE_OUTLINE_TEXT_MAX_CHARS)}</h2>`;
    writeFileSync(join(home, "outlined.html"), `${WORST}${heading.repeat(PAGE_OUTLINE_MAX_ENTRIES)}`);
    const read = pageAtPath({ budget: DEFAULT_CODE_BUDGET, from: 0, raw: "~/outlined.html" });
    expect(read.outline.length).toBe(PAGE_OUTLINE_MAX_ENTRIES);
    expect(read.outline[0]!.text).toBe('"'.repeat(PAGE_OUTLINE_TEXT_MAX_CHARS));
    expect(read.window.nextFrom).toBe(DEFAULT_CODE_BUDGET);
    expect(bytesOf({ text: fileReadJson({ read }) })).toBeLessThanOrEqual(PAGE_TOOL_CAP);
  });

  it("keeps a full outline of control-character headings inside the cap, read beside the same window", () => {
    // JSON escapes U+0001 to six characters, so these headings once cost 28,898.
    const heading = `<h2>x${"\u0001".repeat(PAGE_OUTLINE_TEXT_MAX_CHARS)}</h2>`;
    writeFileSync(join(home, "controls.html"), `${WORST}${heading.repeat(PAGE_OUTLINE_MAX_ENTRIES)}`);
    const read = pageAtPath({ budget: DEFAULT_CODE_BUDGET, from: 0, raw: "~/controls.html" });
    expect(read.outline.length).toBe(PAGE_OUTLINE_MAX_ENTRIES);
    expect(read.outline[0]!.text).toBe("x");
    expect(bytesOf({ text: fileReadJson({ read }) })).toBeLessThanOrEqual(PAGE_TOOL_CAP);
  });

  it("sheds four-byte headings by their bytes, which fit the cap counted in characters and overflow it in bytes", () => {
    const path = "/tmp/emoji.html";
    const read: LocalRead = {
      kind: "text",
      outline: Array.from({ length: PAGE_OUTLINE_MAX_ENTRIES }, (_, at) => ({
        from: DEFAULT_CODE_BUDGET + at * 400,
        level: 2 as const,
        text: "🙂".repeat(PAGE_OUTLINE_TEXT_MAX_CHARS),
      })),
      outlineCut: false,
      path,
      redactions: [],
      resolvedPath: path,
      size: 20_000,
      text: '"'.repeat(DEFAULT_CODE_BUDGET),
      window: { end: DEFAULT_CODE_BUDGET, nextFrom: DEFAULT_CODE_BUDGET, start: 0, truncated: true },
    };
    const whole = JSON.stringify({ ...read, outline: read.outline });
    expect(whole.length).toBeLessThan(PAGE_TOOL_CAP);
    const json = fileReadJson({ read });
    expect(bytesOf({ text: json })).toBeLessThanOrEqual(PAGE_TOOL_CAP);
    const carried = (JSON.parse(json) as { outline: unknown[] }).outline;
    expect(carried.length).toBeGreaterThan(0);
    expect(carried.length).toBeLessThan(PAGE_OUTLINE_MAX_ENTRIES);
  });

  it("sheds outline headings, never the window, when a long path leaves the outline no room", () => {
    // A 420-character path fitted with no outline and overflowed with a full one.
    const path = `/tmp/${"p".repeat(1000)}/page.html`;
    const read: LocalRead = {
      kind: "text",
      outline: Array.from({ length: PAGE_OUTLINE_MAX_ENTRIES }, (_, at) => ({
        from: DEFAULT_CODE_BUDGET + at * 90,
        level: 2 as const,
        text: '"'.repeat(PAGE_OUTLINE_TEXT_MAX_CHARS),
      })),
      outlineCut: false,
      path,
      redactions: [],
      resolvedPath: path,
      size: 20_000,
      text: '"'.repeat(DEFAULT_CODE_BUDGET),
      window: { end: DEFAULT_CODE_BUDGET, nextFrom: DEFAULT_CODE_BUDGET, start: 0, truncated: true },
    };
    expect(bytesOf({ text: fileReadJson({ read: { ...read, outline: [] } }) })).toBeLessThanOrEqual(PAGE_TOOL_CAP);
    const json = fileReadJson({ read });
    expect(bytesOf({ text: json })).toBeLessThanOrEqual(PAGE_TOOL_CAP);
    const carried = (JSON.parse(json) as { outline: unknown[]; text: string }).outline;
    expect(carried.length).toBeGreaterThan(0);
    expect(carried.length).toBeLessThan(PAGE_OUTLINE_MAX_ENTRIES);
    expect(carried).toEqual(read.outline.slice(0, carried.length));
    expect(PAGE_TOOL_ANSWER_MAX_BYTES).toBe(PAGE_TOOL_CAP);
    expect(json).toContain('"outlineCut":true');
    expect(
      fileReadJson({ read: { ...read, path: "/tmp/p.html", resolvedPath: "/tmp/p.html", text: "a" } }),
    ).not.toContain("outlineCut");
  });

  it("carries no outline key once every heading is shed, so a window exactly at the cap stays at it", () => {
    // An empty `"outline":[]` still cost 13 characters past a window that fit exactly.
    const path = "/tmp/p.html";
    const bare = { kind: "text", nextFrom: null, path, redactions: [], resolvedPath: path, size: 10_240, start: 0 };
    // The marker is what an emptied outline still costs, and it is never shed: a read saying nothing would be a false
    // whole. A real window leaves far more room than this, which the worst-case cases above pin.
    const envelope = JSON.stringify({ ...bare, outlineCut: true, text: "", truncated: false }).length;
    const read: LocalRead = {
      kind: "text",
      outline: [{ from: 0, level: 1, text: "H" }],
      outlineCut: false,
      path,
      redactions: [],
      resolvedPath: path,
      size: 10_240,
      text: "a".repeat(PAGE_TOOL_CAP - envelope),
      window: { end: 10_240, nextFrom: null, start: 0, truncated: false },
    };
    const json = fileReadJson({ read });
    expect(bytesOf({ text: json })).toBe(PAGE_TOOL_CAP);
    expect(json).not.toContain('"outline"');
    expect(json).toContain('"outlineCut":true');
    expect(fileReadJson({ read: { ...read, text: "a" } })).toContain('"outline":[{"from":0,"level":1,"text":"H"}]');
  });

  it("says the page's outline was cut when the page has a heading past the cap, and only then", () => {
    const heading = "<h2>H</h2>";
    writeFileSync(join(home, "full.html"), heading.repeat(PAGE_OUTLINE_MAX_ENTRIES));
    writeFileSync(join(home, "over.html"), heading.repeat(PAGE_OUTLINE_MAX_ENTRIES + 1));
    const full = pageAtPath({ budget: DEFAULT_CODE_BUDGET, from: 0, raw: "~/full.html" });
    const over = pageAtPath({ budget: DEFAULT_CODE_BUDGET, from: 0, raw: "~/over.html" });
    expect(full.outlineCut).toBe(false);
    expect(fileReadJson({ read: full })).not.toContain("outlineCut");
    expect(over.outline.length).toBe(PAGE_OUTLINE_MAX_ENTRIES);
    expect(over.outlineCut).toBe(true);
    expect(fileReadJson({ read: over })).toContain('"outlineCut":true');
  });

  it("fits a worst-case tracked file's code_read answer inside the page's tool cap, and pages on", () => {
    const read = unwrap(
      readTrackedFile({
        budget: DEFAULT_CODE_BUDGET,
        from: 0,
        path: "big.ts",
        root: home,
        tracked: new Set(["big.ts"]),
      }),
    );
    expect(bytesOf({ text: codeReadJson({ read, root: home }) })).toBeLessThanOrEqual(PAGE_TOOL_CAP);
    expect(read.window.nextFrom).toBe(DEFAULT_CODE_BUDGET);
  });
});
