/**
 * The install replacement map's format, parser and applier, over synthetic names only (`oldco` becomes `acme`).
 */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyReplacementMap,
  loadReplacementMap,
  parseReplacementMap,
  type ReplacementRule,
  replacementMapStatusLine,
} from "../../../hygiene/replacementMap.js";
import { ReplacementMapErrors } from "../../../hygiene/replacementMapErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const PATH = "/home/hygiene-replacements.tsv";

/** The rules one text parses to, asserting it parsed. */
const rulesOf = ({ text }: { text: string }): readonly ReplacementRule[] =>
  unwrap(parseReplacementMap({ path: PATH, text }));

/** One text through a map given as its own file text. */
const apply = ({ map, text }: { map: string; text: string }): string =>
  applyReplacementMap({ rules: rulesOf({ text: map }), text });

describe("parseReplacementMap", () => {
  it("skips blank and comment lines, keeps file order, and records each rule's line", () => {
    const rules = rulesOf({ text: "# head\n\nliteral\toldco.example\tacme.example\nregex\tx+\ty\n" });
    expect(rules.map((rule) => [rule.line, rule.mode])).toEqual([
      [3, "literal"],
      [4, "regex"],
    ]);
  });

  it("trims only the flags column, so a pattern keeps its own spaces", () => {
    expect(apply({ map: " literal , i \t Old Name\tNew", text: "a  old name b" })).toBe("a New b");
  });

  it("refuses a line without exactly three columns, naming the line and quoting neither column", () => {
    const error = unwrapErr(parseReplacementMap({ path: PATH, text: "literal\toldco\n" }));
    expect(error).toEqual(ReplacementMapErrors.columnsInvalid({ line: 1, path: PATH }));
    expect(error.message).not.toContain("oldco");
    expect(error.message).toContain(`${PATH}:1`);
  });

  it("refuses an empty pattern", () => {
    expect(unwrapErr(parseReplacementMap({ path: PATH, text: "literal\t\tacme" })).code).toBe("MAP_COLUMNS_INVALID");
  });

  it("refuses an unknown flag, two modes, no mode, and preserve-case beside i or on a regex", () => {
    const codes = ["literal,x", "literal,regex", "i", "literal,preserve-case,i", "regex,preserve-case"].map(
      (flags) => unwrapErr(parseReplacementMap({ path: PATH, text: `${flags}\toldco\tacme` })).code,
    );
    expect(codes).toEqual([
      "MAP_FLAGS_INVALID",
      "MAP_FLAGS_INVALID",
      "MAP_FLAGS_INVALID",
      "MAP_FLAGS_INVALID",
      "MAP_FLAGS_INVALID",
    ]);
  });

  it("refuses a preserve-case side that is not one bare word", () => {
    expect(unwrapErr(parseReplacementMap({ path: PATH, text: "literal,preserve-case\told co\tacme" })).code).toBe(
      "MAP_PATTERN_INVALID",
    );
    expect(unwrapErr(parseReplacementMap({ path: PATH, text: "literal,preserve-case\toldco\tac-me" })).code).toBe(
      "MAP_PATTERN_INVALID",
    );
  });

  it("refuses a pattern that does not compile", () => {
    expect(unwrapErr(parseReplacementMap({ path: PATH, text: "regex\t(\tacme" })).code).toBe("MAP_PATTERN_INVALID");
  });

  it("refuses a backreference to a group the pattern does not have, and an unknown escape", () => {
    expect(unwrapErr(parseReplacementMap({ path: PATH, text: "regex\t(a)\t\\2" })).code).toBe(
      "MAP_BACKREFERENCE_INVALID",
    );
    expect(unwrapErr(parseReplacementMap({ path: PATH, text: "regex\ta\t\\n" })).code).toBe(
      "MAP_BACKREFERENCE_INVALID",
    );
  });
});

describe("applyReplacementMap", () => {
  it("runs rules top to bottom, so a specific rule above a general one wins", () => {
    const map = "literal\tapi.oldco.example\tapi.acme.example\nliteral\toldco\tacme-wide";
    expect(apply({ map, text: "see api.oldco.example and oldco" })).toBe("see api.acme.example and acme-wide");
  });

  it("matches a literal byte for byte: regex metacharacters and a $ in the replacement stay literal", () => {
    expect(apply({ map: "literal\ta.b(c)\t$1 cost", text: "axb(c) a.b(c)" })).toBe("axb(c) $1 cost");
  });

  it("matches a literal case-sensitively unless it carries i", () => {
    expect(apply({ map: "literal\toldco\tacme", text: "oldco Oldco" })).toBe("acme Oldco");
    expect(apply({ map: "literal,i\toldco\tacme", text: "oldco Oldco" })).toBe("acme acme");
  });

  it("preserve-case writes the casing it found, inside a longer word too", () => {
    expect(apply({ map: "literal,preserve-case\toldco\tacme", text: "oldco Oldco OLDCO myOldcoTeam oLdCo" })).toBe(
      "acme Acme ACME myAcmeTeam acme",
    );
  });

  it("a regex rule substitutes \\1 groups, a \\\\ as one backslash and a $ as itself", () => {
    expect(apply({ map: "regex,i\t\\b(api|staging)\\.oldco\\b\t\\1.acme\\\\$", text: "API.oldco staging.OLDCO" })).toBe(
      "API.acme\\$ staging.acme\\$",
    );
  });

  it("an empty map returns the text unchanged", () => {
    expect(applyReplacementMap({ rules: [], text: "oldco" })).toBe("oldco");
  });
});

describe("loadReplacementMap and its status line", () => {
  let home: string | undefined;
  afterEach(() => {
    rmSync(home!, { force: true, recursive: true });
  });

  it("an absent file is a normal state, and the line says the map did NOT run", () => {
    home = mkdtempSync(join(tmpdir(), "rmap-"));
    const load = unwrap(loadReplacementMap({ home }));
    expect(load.kind).toBe("absent");
    expect(replacementMapStatusLine({ load })).toBe(
      `redaction: replacement map NOT LOADED (no ${join(home, "hygiene-replacements.tsv")}) — only the committed ` +
        "hashed rules ran, so every name they found was masked rather than replaced",
    );
  });

  it("a written file round-trips into its rules, and the line counts them", () => {
    home = mkdtempSync(join(tmpdir(), "rmap-"));
    writeFileSync(join(home, "hygiene-replacements.tsv"), "literal\toldco\tacme\n", { mode: 0o600 });
    const load = unwrap(loadReplacementMap({ home }));
    expect(applyReplacementMap({ rules: load.rules, text: "oldco" })).toBe("acme");
    expect(replacementMapStatusLine({ load })).toBe(
      `redaction: replacement map LOADED, 1 rule(s) applied from ${join(home, "hygiene-replacements.tsv")}`,
    );
  });

  it("a present file with no rule says so", () => {
    home = mkdtempSync(join(tmpdir(), "rmap-"));
    writeFileSync(join(home, "hygiene-replacements.tsv"), "# nothing yet\n", { mode: 0o600 });
    expect(replacementMapStatusLine({ load: unwrap(loadReplacementMap({ home })) })).toBe(
      `redaction: replacement map PRESENT BUT EMPTY at ${join(home, "hygiene-replacements.tsv")} — only the ` +
        "committed hashed rules ran",
    );
  });

  it("a read failing for any reason but absence is a refusal, never an empty map", () => {
    home = mkdtempSync(join(tmpdir(), "rmap-"));
    const denied = (): string => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    };
    const error = unwrapErr(loadReplacementMap({ home, readText: denied }));
    expect(error.code).toBe("MAP_UNREADABLE");
    expect(error.message).toContain("EACCES");
  });

  it("a dangling symlink at the map's path answers ENOENT yet is a refusal, never an absent map", () => {
    home = mkdtempSync(join(tmpdir(), "rmap-"));
    symlinkSync(join(home, "gone.tsv"), join(home, "hygiene-replacements.tsv"));
    const error = unwrapErr(loadReplacementMap({ home }));
    expect(error.code).toBe("MAP_UNREADABLE");
    expect(error.message).toContain("dangling symlink");
  });
});
