/**
 * What a sed invocation's own script does beyond printing: the files a `w` command or an `s` command's `w` flag
 * writes, told apart from a replacement or an input file that merely starts with a `w`, and whether an `e`
 * command or an `s` command's `e` flag runs a shell command.
 */
import { describe, expect, it } from "vitest";

import { scriptFromStdin, sedEffects } from "../../../admit/sedScript.js";
import { shellWords } from "../../../admit/shellLexing.js";

/** The effects of one sed command line's arguments. */
function effectsOf({ text }: { text: string }): ReturnType<typeof sedEffects> {
  return sedEffects({ args: shellWords({ text }).words.slice(1) });
}

/** The write targets of one sed command line's arguments. */
function targetsOf({ text }: { text: string }): readonly string[] {
  return effectsOf({ text }).writes;
}

describe("sedEffects executes", () => {
  it.each<[string, string]>([
    ["an e command", "sed '1e touch out' in"],
    ["an e command after a regex address", "sed '/x/e date' in"],
    ["the e flag of an s command", "sed 's/.*/touch out/e' in"],
    ["the e flag among other flags", "sed -e 's|a|b|ge' in"],
    ["an e command after a label GNU sed ends at a semicolon", "gsed ':x;e printf owned' in"],
  ])("flags %s", (_label, text) => {
    expect(effectsOf({ text }).executes).toBe(true);
  });

  it.each<[string, string]>([
    ["a replacement holding an e", "sed 's/a/e/g' in"],
    ["an appended line holding an e", "sed '1a echo' in"],
    ["a transliteration holding e", "sed 'y/e/f/' in"],
    ["a branch label starting with e", "sed ':end;n;bend' in"],
  ])("passes %s", (_label, text) => {
    expect(effectsOf({ text }).executes).toBe(false);
  });
});

describe("scriptFromStdin", () => {
  /** Whether one command line's arguments read a script from stdin. */
  function readsStdin({ text }: { text: string }): boolean {
    return scriptFromStdin({ args: shellWords({ text }).words.slice(1) });
  }

  it.each<[string, string]>([
    ["sed -f -", "sed -f - in"],
    ["a clustered sed -nf -", "sed -nf - in"],
    ["sed --file=/dev/stdin", "sed --file=/dev/stdin in"],
    ["awk -f /dev/fd/0", "awk -f /dev/fd/0 in"],
    ["an attached awk -f-", "awk -f- in"],
    ["gawk --exec -", "gawk --exec - in"],
  ])("flags %s", (_label, text) => {
    expect(readsStdin({ text })).toBe(true);
  });

  it.each<[string, string]>([
    ["a script file on disk", "sed -f edits.sed in"],
    ["stdin as the input, not the script", "sed -n 1p -"],
    ["an awk program file", "awk -f prog.awk in"],
  ])("passes %s", (_label, text) => {
    expect(readsStdin({ text })).toBe(false);
  });
});

describe("sedEffects writes", () => {
  it.each<[string, string, readonly string[]]>([
    ["a bare w with the filename attached", "sed 'wout' in", ["out"]],
    ["a w after a line address", "sed '1w out.txt' in", ["out.txt"]],
    ["a W after the last-line address", "sed -n '$W out' in", ["out"]],
    ["a w after a range and a negation", "sed '1,5!w out' in", ["out"]],
    ["a w after a regex address", "sed -n '/err/w errors.log' in", ["errors.log"]],
    ["the w flag with the filename attached", "sed 's/x/y/wout' in", ["out"]],
    ["the w flag after other flags, under another delimiter", "sed 's|a|b|gw out' in", ["out"]],
    ["a w in a later -e script", "sed -e 's/a/b/' -e '2w out' in", ["out"]],
    ["a w attached to its -e", "sed -e'wout' in", ["out"]],
    ["a w in a clustered -ne script", "sed -ne 'wout' in", ["out"]],
    ["a w after a braced group", "sed -n '/a/{p;w out\n}' in", ["out"]],
  ])("names %s", (_label, text, expected) => {
    expect(targetsOf({ text })).toEqual(expected);
  });

  it.each<[string, string]>([
    ["a replacement starting with w", "sed 's/foo/world/' in"],
    ["a replacement that is only w", "sed 's/a/w/g' in"],
    ["an escaped delimiter before a w", "sed 's/a\\/w/b/' in"],
    ["a transliteration holding w", "sed 'y/w/v/' in"],
    ["an appended line holding w", "sed '1a wout' in"],
    ["a branch label starting with w", "sed ':wait;n;bwait' in"],
    ["an input file named like a w command", "sed -n 1p wout.txt"],
    ["a script read from a file", "sed -f edits.sed wout.txt"],
  ])("passes %s", (_label, text) => {
    expect(targetsOf({ text })).toEqual([]);
  });
});
