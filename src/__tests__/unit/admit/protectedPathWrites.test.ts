/**
 * Where one simple command acts and what it writes, read from the shell's own directory: a redirection where the shell
 * stands, a program's operands after a wrapper's chdir, a git's directory after each of its `-C`s, once. Synthetic
 * paths only.
 */
import { describe, expect, it } from "vitest";

import { absolutePatterns, piecePlace, pieceWrites } from "../../../admit/protectedPathWrites.js";
import { type ShellWord, shellWords, splitOperators } from "../../../admit/shellLexing.js";

const ENV = { HOME: "/Users/example" };
const SHELL = "/Users/example/work/sub";
const WORK = "/Users/example/work";

/** The lexed words of one simple command. */
function piece({ command }: { command: string }): ReturnType<typeof shellWords>["words"] {
  return shellWords({ text: command }).words;
}

/** One simple command's words, redirections cut out as the tripwire cuts them. */
function cutPiece({ text }: { text: string }): readonly ShellWord[] {
  return splitOperators({ words: shellWords({ text }).words });
}

/** What a command run from the work directory writes. */
function writes({ text }: { text: string }): readonly string[] {
  return pieceWrites({ cwd: WORK, env: ENV, piece: cutPiece({ text }) });
}

describe("piecePlace", () => {
  it("is the shell's directory for a plain program, with no git directory", () => {
    expect(piecePlace({ cwd: SHELL, env: ENV, piece: piece({ command: "touch x" }) })).toEqual({
      dir: SHELL,
      gitDir: undefined,
    });
  });

  it("applies each git -C once, in order, from the shell's directory", () => {
    expect(piecePlace({ cwd: SHELL, env: ENV, piece: piece({ command: "git -C .. -C ../other add ." }) })).toEqual({
      dir: SHELL,
      gitDir: "/Users/example/other",
    });
  });

  it("applies a wrapper's chdir before the git's -C, and moves nothing for an attached -C", () => {
    expect(piecePlace({ cwd: SHELL, env: ENV, piece: piece({ command: "env -C .. git -C ~/x add ." }) })).toEqual({
      dir: "/Users/example/work",
      gitDir: "/Users/example/x",
    });
    expect(piecePlace({ cwd: SHELL, env: ENV, piece: piece({ command: "git -C.. add ." }) })).toEqual({
      dir: SHELL,
      gitDir: SHELL,
    });
  });

  it("steps over a wrapper option's value, which names no wrapper", () => {
    expect(piecePlace({ cwd: SHELL, env: ENV, piece: piece({ command: "env -u sudo -C .. git add ." }) })).toEqual({
      dir: "/Users/example/work",
      gitDir: "/Users/example/work",
    });
  });

  it("leaves the directory unknown when the shell's is", () => {
    expect(piecePlace({ cwd: undefined, env: ENV, piece: piece({ command: "git -C .. add ." }) })).toEqual({
      dir: undefined,
      gitDir: undefined,
    });
  });
});

describe("pieceWrites", () => {
  it("reads a redirection from the shell's directory and a creator's operand from the wrapper's", () => {
    expect(pieceWrites({ cwd: SHELL, env: ENV, piece: piece({ command: "env -C .. touch a > b" }) })).toEqual([
      `${SHELL}/b`,
      "/Users/example/work/a",
    ]);
  });

  it("reads a moved operand opening on an unknown variable from the shell's directory too", () => {
    expect(pieceWrites({ cwd: SHELL, env: ENV, piece: piece({ command: 'env -C /tmp touch "$OTHER"' }) })).toEqual([
      "/tmp/*",
      `${SHELL}/*`,
    ]);
  });

  it("writes at a writing git's directory and nowhere for a read", () => {
    expect(pieceWrites({ cwd: SHELL, env: ENV, piece: piece({ command: "nice git -C .. commit -m x" }) })).toEqual([
      "/Users/example/work",
    ]);
    expect(pieceWrites({ cwd: SHELL, env: ENV, piece: piece({ command: "git -C .. log" }) })).toEqual([]);
  });
});

describe("pieceWrites, by kind of program", () => {
  it("reads a writing redirection's file and not a reading one's", () => {
    expect(writes({ text: "cat /a/in >> out.log" })).toStrictEqual(["/Users/example/work/out.log"]);
    expect(writes({ text: "cat < /a/in" })).toStrictEqual([]);
  });

  it("reads every operand of a creator, its options dropped", () => {
    expect(writes({ text: "touch -c one /abs/two" })).toStrictEqual(["/Users/example/work/one", "/abs/two"]);
  });

  it("reads a copier's destination — its last operand, else its -t directory", () => {
    expect(writes({ text: "cp -n src /dst/file" })).toStrictEqual(["/dst/file"]);
    expect(writes({ text: "cp -t /dst/dir a b" })).toStrictEqual(["/dst/dir"]);
  });

  it("reads dd's of= and not its if=", () => {
    expect(writes({ text: "dd if=/src/in of=/dst/out" })).toStrictEqual(["/dst/out"]);
  });

  it("reads a writing git's -C directory and nothing for a git read or a bare listing", () => {
    expect(writes({ text: "git -C /repo commit -m x" })).toStrictEqual(["/repo"]);
    expect(writes({ text: "git status" })).toStrictEqual([]);
    expect(writes({ text: "git branch" })).toStrictEqual([]);
    expect(writes({ text: "git branch topic" })).toStrictEqual([WORK]);
  });

  it("reads nothing from a program that neither creates nor copies", () => {
    expect(writes({ text: "ls /abs/dir" })).toStrictEqual([]);
  });
});

describe("absolutePatterns", () => {
  it("resolves a relative word from the directory and keeps an absolute one", () => {
    expect(absolutePatterns({ cwd: WORK, env: ENV, words: cutPiece({ text: "a/b /c" }) })).toStrictEqual([
      "/Users/example/work/a/b",
      "/c",
    ]);
  });

  it("drops a relative word when the directory is unknown", () => {
    expect(absolutePatterns({ cwd: undefined, env: ENV, words: cutPiece({ text: "a/b /c" }) })).toStrictEqual(["/c"]);
  });
});
