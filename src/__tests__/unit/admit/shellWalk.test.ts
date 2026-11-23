/**
 * `shellWalk.ts`: where a directory builtin leaves the walk, and the command lists a bare `&` separates.
 */
import { describe, expect, it } from "vitest";

import { shellWords } from "../../../admit/shellLexing.js";
import {
  backgroundLists,
  directoryAfter,
  foregroundCommand,
  withoutSubshellClose,
  wrappedDirectory,
} from "../../../admit/shellWalk.js";

/** The words of one literal command line. */
function words({ text }: { text: string }): ReturnType<typeof shellWords>["words"] {
  return shellWords({ text }).words;
}

describe("directoryAfter", () => {
  it.each([
    ["cd desktop", "/repo/desktop"],
    ["cd -- /elsewhere", "/elsewhere"],
    ["cd -L -P ..", "/"],
    ["pushd desktop", "/repo/desktop"],
  ])("follows `%s` from /repo", (line, expected) => {
    expect(directoryAfter({ from: "/repo", words: words({ text: line }) })).toBe(expected);
  });

  it.each(["cd", "cd -", "cd ~/x", "pushd +1", "popd", 'cd "$DIR"'])("leaves `%s` unknown", (line) => {
    expect(directoryAfter({ from: "/repo", words: words({ text: line }) })).toBe(undefined);
  });
});

describe("wrappedDirectory", () => {
  it.each([
    ["env -C /slop yarn typecheck", "/slop"],
    ["env --chdir=/slop yarn typecheck", "/slop"],
    ["env --chdir desktop yarn typecheck", "/repo/desktop"],
    ["env -iC/slop yarn typecheck", "/slop"],
    ["/usr/bin/env -i -C .. yarn typecheck", "/"],
    ["sudo -D /slop env -C desktop yarn typecheck", "/slop/desktop"],
    ["sudo -C 3 yarn typecheck", "/repo"],
    ["env X=1 yarn typecheck", "/repo"],
  ])("runs `%s` from /repo in %s", (line, expected) => {
    const all = words({ text: line });
    expect(wrappedDirectory({ from: "/repo", program: all.slice(-2), words: all })).toBe(expected);
  });

  it.each(['env -C "$DIR" yarn typecheck', "env -C ~/slop yarn typecheck", "env -C - yarn typecheck"])(
    "leaves `%s` in an unknown directory",
    (line) => {
      const all = words({ text: line });
      expect(wrappedDirectory({ from: "/repo", program: all.slice(-2), words: all })).toBe(undefined);
    },
  );
});

describe("backgroundLists", () => {
  it.each([
    ["true & yarn typecheck", [["true"], ["yarn", "typecheck"]]],
    ["true&yarn typecheck", [["true"], ["yarn", "typecheck"]]],
    ["sleep 1 &", [["sleep", "1"]]],
    ["echo '&' x", [["echo", "&", "x"]]],
    [
      'echo "x"&yarn typecheck',
      [
        ["echo", "x"],
        ["yarn", "typecheck"],
      ],
    ],
    [
      "echo \\>&yarn typecheck",
      [
        ["echo", ">"],
        ["yarn", "typecheck"],
      ],
    ],
    ["yarn test 2>&1 &> log && echo a|&cat", [["yarn", "test", "&&", "echo", "a|&cat"]]],
    ["echo $(a & b) x", [["echo", "$(a & b)", "x"]]],
  ])("splits `%s`", (line, expected) => {
    expect(backgroundLists({ text: line }).map((list) => list.map((word) => word.text))).toEqual(expected);
  });
});

describe("withoutSubshellClose", () => {
  it("peels a subshell's `)` and drops a word it empties", () => {
    const peeled = withoutSubshellClose({ words: words({ text: "yarn typecheck ) )" }) });
    expect(peeled.map((word) => word.text)).toEqual(["yarn", "typecheck"]);
  });

  it("keeps a quoted `)`", () => {
    expect(withoutSubshellClose({ words: words({ text: "echo ')'" }) }).map((word) => word.text)).toEqual([
      "echo",
      ")",
    ]);
  });
});

describe("foregroundCommand", () => {
  it("keeps what follows the last bare `&`, the list this shell runs", () => {
    expect(foregroundCommand({ command: "export X=1 & wait" })).toBe(" wait");
    expect(foregroundCommand({ command: "a & b &c" })).toBe("c");
  });

  it("leaves a line with no bare `&` whole, redirections and `&&` included", () => {
    expect(foregroundCommand({ command: "export X=1 2>&1" })).toBe("export X=1 2>&1");
    expect(foregroundCommand({ command: "a &> log && b |& c" })).toBe("a &> log && b |& c");
  });
});
