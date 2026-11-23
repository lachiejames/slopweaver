import { describe, expect, it } from "vitest";

import {
  assignsInExpansion,
  embeddedShellPayload,
  envSplitString,
  evalText,
  findCommands,
  hereStringBody,
  trapAction,
  watchedCommand,
} from "../../../admit/launchedText.js";
import { type ShellWord, shellWords } from "../../../admit/shellLexing.js";

/** The words of a command line, as the gate reads them. */
function wordsOf({ text }: { text: string }): readonly ShellWord[] {
  return shellWords({ text }).words;
}

describe("envSplitString", () => {
  it.each([
    ["env -S 'sleep 1'", "sleep 1"],
    ["env -vS'sleep 1'", "sleep 1"],
    ["X=1 env --split-string='sleep 1'", "sleep 1"],
    ["env -u HOME -S 'sleep 1'", "sleep 1"],
  ])("reads the split string of %s", (text, expected) => {
    expect(envSplitString({ words: wordsOf({ text }) })).toBe(expected);
  });

  it.each(["env FOO=1 ls", "ls -S", "env -- -S x"])("finds none in %s", (text) => {
    expect(envSplitString({ words: wordsOf({ text }) })).toBe(undefined);
  });
});

describe("trapAction", () => {
  it("reads the action a trap installs, past --", () => {
    expect(trapAction({ args: wordsOf({ text: "-- 'sleep 1' EXIT" }), name: "trap" })).toBe("sleep 1");
  });

  it.each(["-p", "- EXIT", "'' EXIT"])("installs nothing for trap %s", (text) => {
    expect(trapAction({ args: wordsOf({ text }), name: "trap" })).toBe(undefined);
  });
});

describe("findCommands", () => {
  it("splits each exec action, an unterminated one included", () => {
    const commands = findCommands({ args: wordsOf({ text: ". -exec sleep 1 ; -ok rm {} + -execdir ls" }) });
    expect(commands.map((command) => command.map((word) => word.text))).toEqual([["sleep", "1"], ["rm", "{}"], ["ls"]]);
  });
});

describe("the other launchers", () => {
  it("reads watch's command past -n's value", () => {
    expect(watchedCommand({ args: wordsOf({ text: "-n 1 sleep 2" }), name: "watch" })).toBe("sleep 2");
  });

  it("joins eval's arguments, and reads nothing from a bare eval", () => {
    expect(evalText({ args: wordsOf({ text: "sleep 1" }), name: "eval" })).toBe("sleep 1");
    expect(evalText({ args: [], name: "eval" })).toBe(undefined);
  });

  it("finds a shell's -c payload inside another program's arguments", () => {
    expect(embeddedShellPayload({ args: wordsOf({ text: ". -exec sh -c 'sleep 1' ;" }) })).toBe("sleep 1");
    expect(embeddedShellPayload({ args: wordsOf({ text: "bash -c notes.txt" }) })).toBe("notes.txt");
  });

  it("reads a here-string glued or spaced", () => {
    expect(hereStringBody({ words: wordsOf({ text: "cat <<<'one'" }) })).toBe("one");
    expect(hereStringBody({ words: wordsOf({ text: "cat <<< two" }) })).toBe("two");
    expect(hereStringBody({ words: wordsOf({ text: "cat one" }) })).toBe(undefined);
  });
});

describe("assignsInExpansion", () => {
  it.each([
    "${X:=ok}",
    "a${X=1}b",
    "${a[0]:=v}",
    "$((X=5))",
    "$((X+=1))",
    "$[X++]",
    "$((--X))",
    "$((X<<=1))",
    "${a[x=7]}",
    "${c:r=1}",
    "$((a['$(sleep 1)']))",
    "${ echo hi; }",
    "${| REPLY=1; }",
    "${a[$'\\x24(touch f)']}",
  ])("reads %s as assigning", (text) => {
    expect(assignsInExpansion({ text })).toBe(true);
  });

  it.each([
    "${X}",
    "${X:-d}",
    "${X:+y}",
    "${#X}",
    "$((X==5))",
    "$((X!=5))",
    "$((6&3))",
    "X=1 plain",
    "${a[0]}",
    "${c:1:2}",
    "$((a[1]))",
    "${X}${Y:-d}",
  ])("reads %s as not assigning", (text) => {
    expect(assignsInExpansion({ text })).toBe(false);
  });
});
