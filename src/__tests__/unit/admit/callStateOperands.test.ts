import { describe, expect, it } from "vitest";

import { destructiveOperands } from "../../../admit/callStateOperands.js";
import { shellWords } from "../../../admit/shellLexing.js";

/** What one command destroys, as the texts of its words and whether it cleans its own directory. */
function destroys({ command }: { command: string }): { texts: readonly string[]; cleansCwd: boolean } {
  const read = destructiveOperands({ words: shellWords({ text: command }).words });
  return { cleansCwd: read.cleansCwd, texts: read.words.map((word) => word.text) };
}

describe("destructiveOperands", () => {
  it.each([
    { command: "rm -f a b", texts: ["a", "b"] },
    { command: "sudo rm a", texts: ["a"] },
    { command: '"env" rm a', texts: ["a"] },
    { command: "! rm a", texts: ["a"] },
    { command: "if rm a", texts: ["a"] },
    { command: "then mv a b", texts: ["a", "b"] },
    { command: "'!' rm a", texts: [] },
    { command: "case x in x) rm a", texts: ["a"] },
    { command: "case x in", texts: [] },
    { command: "y) rm a", texts: ["a"] },
    { command: "f() { rm a", texts: ["a"] },
    { command: "function f { rm a", texts: ["a"] },
    { command: "env -C calls rm x.jsonl /abs", texts: ["calls/x.jsonl", "/abs"] },
    { command: "env --chdir=/h rm x.jsonl", texts: ["/h/x.jsonl"] },
    { command: "sudo -D /h mv a b", texts: ["/h/a", "/h/b"] },
    { command: "sudo -C 5 rm a", texts: ["a"] },
    { command: "find -- x.jsonl -delete", texts: ["x.jsonl"] },
    { command: "find -L -- x.jsonl y -delete", texts: ["x.jsonl", "y"] },
    { command: "truncate -s 0 a", texts: ["a"] },
    { command: "mv a b", texts: ["a", "b"] },
    { command: "cp a /h", texts: ["/h/a"] },
    { command: "ln -f /s/x.jsonl", texts: ["./x.jsonl"] },
    { command: "cp -at /h /s/x.jsonl", texts: ["/h/x.jsonl"] },
    { command: "cp -t/h /s/x.jsonl", texts: ["/h/x.jsonl"] },
    { command: "cp --target-directory=/h /s/x.jsonl", texts: ["/h/x.jsonl"] },
    { command: "cp -St a /h", texts: ["/h/a"] },
    { command: "cp -n a b", texts: [] },
    { command: "cp -an a b", texts: [] },
    { command: "cp -Sn a /h", texts: ["/h/a"] },
    { command: "tee -a a", texts: [] },
    { command: "cat a", texts: [] },
    { command: "dd if=/dev/null of=/h/a.jsonl", texts: ["/h/a.jsonl"] },
    { command: "dd if=/h/a.jsonl", texts: [] },
  ])("$command destroys $texts", ({ command, texts }) => {
    expect(destroys({ command })).toEqual({ cleansCwd: false, texts });
  });

  it("reaches git's grammar past an assignment and a wrapper", () => {
    expect(destroys({ command: "GIT_WORK_TREE=/h sudo git clean -f" })).toEqual({ cleansCwd: false, texts: ["/h"] });
    expect(destroys({ command: "git rm -f a" })).toEqual({ cleansCwd: false, texts: ["a"] });
  });
});
