import { describe, expect, it } from "vitest";

import { type ShellWord, shellWords, splitOperators } from "../../../admit/shellLexing.js";
import {
  assignsBeforeSpecialBuiltin,
  filterLaunches,
  gluesParenthesis,
  namesDescriptor,
  storesFromArguments,
  teeWrites,
} from "../../../admit/wordOperators.js";

/** A command's words with each operator split into a word of its own, as a stage sees them. */
function wordsOf({ text }: { text: string }): readonly ShellWord[] {
  return splitOperators({ words: shellWords({ text }).words });
}

describe("gluesParenthesis", () => {
  it.each([
    ["time(sleep 1)", true],
    ["!(sleep 1)", true],
    ["echo x(y)", true],
    ["rg 'a(b' src", false],
    ["find . \\( -name x \\)", false],
    ["echo $((1+(2))) $[(3)] ${a[(1)]}", false],
    ["a=(1 2)", false],
    ["a+=(3)", false],
  ])("%s → %s", (text, expected) => {
    expect(gluesParenthesis({ words: wordsOf({ text }) })).toBe(expected);
  });
});

describe("namesDescriptor", () => {
  it.each([
    ["true {fd}</dev/null", true],
    ["exec {a[1]}>&2", true],
    ["exec {fd}>&-", true],
    ["echo {fd}", false],
    ["echo '{fd}'</dev/null", false],
    ["echo {} >/dev/null", false],
  ])("%s → %s", (text, expected) => {
    expect(namesDescriptor({ words: wordsOf({ text }) })).toBe(expected);
  });
});

describe("storesFromArguments", () => {
  it.each([
    ["printf -v X %s ok", true],
    ["printf %s ok", false],
    ["wait -p X", true],
    ["wait", false],
    ["[[ y=1 -eq 1 ]]", true],
    ["test -v a[z=1]", true],
    ["[ a[x++] -gt 0 ]", true],
    ["test a = b", false],
    ["[[ $a == b ]]", false],
    ["[ -n x ]", false],
    ["[[ -v 'a[$(sleep 1)]' ]]", true],
  ])("%s → %s", (text, expected) => {
    const [head, ...args] = wordsOf({ text });
    const options = args.filter((arg) => arg.text.startsWith("-")).map((arg) => arg.text);
    expect(storesFromArguments({ args, name: head!.text, options })).toBe(expected);
  });
});

describe("filterLaunches", () => {
  it.each([
    ["rg --pre /bin/sleep x /dev/null", true],
    ["rg --pre=/bin/sleep x", true],
    ["rg --hostname-bin=/bin/sleep x", true],
    ["sort --compress-program=sleep f", true],
    ["sort --compress-prog sleep f", true],
    ["rg --pretty x src", false],
    ["rg --pre-glob '*.gz' x", false],
    ["sort -u f", false],
    ["grep --pre x f", false],
  ])("%s → %s", (text, expected) => {
    const [head, ...args] = wordsOf({ text });
    expect(filterLaunches({ args, name: head!.text })).toBe(expected);
  });
});

describe("teeWrites", () => {
  const harmless = /^\/dev\/(?:null|stdout|stderr)$/;
  it.each([
    ["tee out", true],
    ["tee -a out", true],
    ["tee /dev/null -a", true],
    ["tee -", true],
    ["tee -- -a", true],
    ["tee -a /dev/null", false],
    ["tee", false],
    ["tee -i /dev/stderr", false],
  ])("%s → %s", (text, expected) => {
    const [, ...args] = wordsOf({ text });
    expect(teeWrites({ args, harmless })).toBe(expected);
  });
});

describe("assignsBeforeSpecialBuiltin", () => {
  const assignment = /^[A-Za-z_]\w*\+?=/;
  it.each([
    ["R104=owned :", true],
    ["A=1 B=2 export C", true],
    ["X=1 set -o posix", true],
    ["NODE_ENV=test yarn build", false],
    ["X=1", false],
    [": ok", false],
  ])("%s → %s", (text, expected) => {
    expect(assignsBeforeSpecialBuiltin({ assignment, statement: wordsOf({ text }) })).toBe(expected);
  });
});
