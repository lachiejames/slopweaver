import { describe, expect, it } from "vitest";

import { shellWords } from "../../../admit/shellLexing.js";
import { programAt } from "../../../admit/wrappedProgram.js";

/** The words a command runs, as text, and the program among them, or `undefined` when there is none. */
function program({ command }: { command: string }): { texts: readonly string[]; name: string | undefined } {
  const { at, words } = programAt({ words: shellWords({ text: command }).words });
  return { name: at === undefined ? undefined : words[at]!.text, texts: words.map((word) => word.text) };
}

describe("programAt", () => {
  it.each([
    { command: "rm a", name: "rm", texts: ["rm", "a"] },
    { command: "X=1 sudo -u dev rm a", name: "rm", texts: ["X=1", "sudo", "-u", "dev", "rm", "a"] },
    { command: "! time -o log rm a", name: "rm", texts: ["!", "time", "-o", "log", "rm", "a"] },
    { command: "env", name: undefined, texts: ["env"] },
    { command: "coproc rm a", name: "rm", texts: ["coproc", "rm", "a"] },
    { command: "coproc NAME { rm a", name: "rm", texts: ["coproc", "NAME", "{", "rm", "a"] },
    { command: "nice -n 5 rm a", name: "rm", texts: ["nice", "-n", "5", "rm", "a"] },
    { command: "timeout -s KILL 5 rm a", name: "rm", texts: ["timeout", "-s", "KILL", "5", "rm", "a"] },
    { command: "caffeinate -i -t 9 rm a", name: "rm", texts: ["caffeinate", "-i", "-t", "9", "rm", "a"] },
    { command: "arch -arch arm64 rm a", name: "rm", texts: ["arch", "-arch", "arm64", "rm", "a"] },
    { command: "arch -arm64 rm a", name: "rm", texts: ["arch", "-arm64", "rm", "a"] },
    { command: "stdbuf -oL rm a", name: "rm", texts: ["stdbuf", "-oL", "rm", "a"] },
    { command: "doas -u dev rm a", name: "rm", texts: ["doas", "-u", "dev", "rm", "a"] },
  ])("finds $name in $command", ({ command, name, texts }) => {
    expect(program({ command })).toEqual({ name, texts });
  });

  it.each([
    { command: 'env -S "rm a"', texts: ["env", "rm", "a"] },
    { command: "env -S'rm a' b", texts: ["env", "rm", "a", "b"] },
    { command: 'env -iS "rm a"', texts: ["env", "rm", "a"] },
    { command: 'env --split-string="rm a"', texts: ["env", "rm", "a"] },
    { command: 'env --sp "rm a"', texts: ["env", "rm", "a"] },
    { command: "env -S \"env -S 'rm a'\"", texts: ["env", "env", "rm", "a"] },
    { command: 'env -C /t -S "rm a"', texts: ["env", "-C", "/t", "rm", "a"] },
  ])("splits env's string in $command", ({ command, texts }) => {
    expect(program({ command })).toEqual({ name: "rm", texts });
  });

  it.each([
    { command: "env -uS rm a", texts: ["env", "-uS", "rm", "a"] },
    { command: "env -u S rm a", texts: ["env", "-u", "S", "rm", "a"] },
    { command: "env --chdir=/t rm a", texts: ["env", "--chdir=/t", "rm", "a"] },
    { command: 'sudo -S "rm a"', texts: ["sudo", "-S", "rm a"] },
  ])("leaves $command unsplit", ({ command, texts }) => {
    expect(program({ command }).texts).toEqual(texts);
  });

  it("returns no program for a split string that ends the command with nothing in it", () => {
    expect(program({ command: 'env -S ""' })).toEqual({ name: undefined, texts: ["env"] });
  });
});
