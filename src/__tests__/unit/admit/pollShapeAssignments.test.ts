/**
 * The poll classifier over a call's literal assignments — which bindings it splices into the read that follows, so
 * the change token fingerprints the file the shell opens, and every binding (an expansion, a quote, a rebind, a name
 * that steers lookup, a budget overrun) where it names no file and the gate keeps the 60-second rule. The shapes it
 * catches and the work it never mistakes for a poll are in `pollShape.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { classifyBashPoll } from "../../../admit/pollShape.js";

const SP = "/private/tmp/claude-501/-Users-x-dev-slopweaver--claude-worktrees-slug/0123-abcd/scratchpad";

describe("a poll's literal assignments", () => {
  it("substitutes a leading assignment into the read that follows it", () => {
    expect(classifyBashPoll({ command: `S=${SP}; tail -c 500 "$S/validate.log"` })).toEqual({
      kind: "poll",
      label: "log read",
      operands: ["500"],
      paths: [`${SP}/validate.log`],
      target: `${SP}/validate.log`,
    });
  });

  it("substitutes a braced assignment across a newline", () => {
    expect(classifyBashPoll({ command: `SP=${SP}\ncat \${SP}/ci.txt` })).toEqual({
      kind: "poll",
      label: "log read",
      operands: [],
      paths: [`${SP}/ci.txt`],
      target: `${SP}/ci.txt`,
    });
  });

  it("names no file where the shallow target rewrites the front of a longer variable name, keeping trunk's key", () => {
    expect(classifyBashPoll({ command: `S=/tmp/fake; SHELL=${SP}; tail "$SHELL/run.log"` })).toMatchObject({
      paths: [],
      target: "/tmp/fakeHELL/run.log",
    });
  });

  it("binds no value the shell would expand at assignment, so the read it feeds names no file", () => {
    expect(classifyBashPoll({ command: `S=~/x; tail "$S/run.log"` })).toMatchObject({
      paths: [],
      target: "~/x/run.log",
    });
    expect(classifyBashPoll({ command: `S=$(pwd); tail "$S/run.log"` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `S="/a b"; tail "$S/run.log"` })).toMatchObject({ paths: [] });
  });

  it("names no file where a substituted variable sits in single quotes or behind a backslash, which the shell reads as written", () => {
    expect(classifyBashPoll({ command: `S=/tmp/fp; tail '$S/run.log'` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `S=/tmp/fp; tail \\$S/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `S=/tmp/fp; tail $'$S/run.log'` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `S=/tmp/fp; tail "$S/it's.log"` })).toMatchObject({
      paths: ["/tmp/fp/it's.log"],
    });
  });

  it("names no file when a substituted variable carries a zsh modifier or subscript, which changes the file opened", () => {
    expect(classifyBashPoll({ command: `S=${SP}/run.log; tail "$S:r"` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `S=${SP}/run.log; tail "$S[1,-1]"` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `S=${SP}/run.log; tail $S:h` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `S=${SP}/run.log; tail "\${S}"` })).toMatchObject({
      paths: [`${SP}/run.log`],
    });
  });

  it("binds no value written with an expansion, even of an earlier literal binding", () => {
    expect(classifyBashPoll({ command: `A=/tmp; B=$A/run.log; tail "$B"` })).toMatchObject({ paths: [] });
  });

  it("names no file when the call touches how an expansion splits — IFS or a shell option", () => {
    expect(classifyBashPoll({ command: `IFS=,; X=a.log,b.log; tail $X` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `set -o SH_WORD_SPLIT; tail -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `export IFS; tail -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
  });

  it("names no file when the call carries whitespace the shell keeps inside a word", () => {
    expect(classifyBashPoll({ command: `grep pat ${SP}/run.log notes file` })).toMatchObject({
      paths: [`${SP}/run.log`],
    });
    expect(classifyBashPoll({ command: `grep pat ${SP}/run.log notes file` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `grep pat ${SP}/run.log notes\rfile` })).toMatchObject({ paths: [] });
  });

  it("names no file when the call carries any character outside printable ASCII, whitespace `\\s` misses included", () => {
    expect(classifyBashPoll({ command: `grep 'p\u0085at' ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `grep 'café' ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `grep 'pat' ${SP}/run.log` })).toMatchObject({ paths: [`${SP}/run.log`] });
  });

  it("names no file when the call exports a value, which a later command can read a file through", () => {
    expect(classifyBashPoll({ command: `export 'TZ=:/tmp/zone'; tail /tmp/run.log; date +%z` })).toMatchObject({
      paths: [],
    });
    expect(classifyBashPoll({ command: `export LANG=C; tail -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
  });

  it("binds at most 32 assignments, naming no file in a call that binds one more, used or not", () => {
    // `v<n>X`, so no name is a prefix of another for the shallow trunk pass to rewrite, and each is mixed-case.
    const assignments = ({ count }: { count: number }): string =>
      Array.from({ length: count }, (_, index) => `v${String(index)}X=${SP}`).join("; ");
    expect(classifyBashPoll({ command: `${assignments({ count: 32 })}; tail -1 "$v31X/run.log"` })).toMatchObject({
      paths: [`${SP}/run.log`],
    });
    expect(classifyBashPoll({ command: `${assignments({ count: 33 })}; tail -1 "$v0X/run.log"` })).toMatchObject({
      paths: [],
    });
  });

  it("names no file once the strict expansion outgrows its budget, so a repeated value cannot grow the text quadratically", () => {
    const value = "x".repeat(1024);
    expect(classifyBashPoll({ command: `A=${value}; tail -1 ${SP}/${"$A".repeat(10)}.log` })).toMatchObject({
      paths: [`${SP}/${value.repeat(10)}.log`],
    });
    expect(classifyBashPoll({ command: `A=${value}; tail -1 ${SP}/${"$A".repeat(70)}.log` })).toMatchObject({
      paths: [],
    });
    expect(classifyBashPoll({ command: `A=x; tail -1 ${SP}/${"z".repeat(70_000)}$A.log` })).toMatchObject({
      paths: [],
    });
  });

  it("names no file in a call longer than the budget, though its empty segments cost the strict pass nothing", () => {
    expect(classifyBashPoll({ command: `A=x${"\n".repeat(1_000)}tail -1 ${SP}/run.log $A` })).toMatchObject({
      paths: [`${SP}/run.log`],
    });
    expect(classifyBashPoll({ command: `A=x${"\n".repeat(70_000)}tail -1 ${SP}/run.log $A` })).toMatchObject({
      paths: [],
    });
  });

  it("names no file when a name is rebound to a value the strict pass will not splice", () => {
    expect(classifyBashPoll({ command: `A=${SP}/a; A=${SP}/b; tail -1 "$A/run.log"` })).toMatchObject({
      paths: [`${SP}/b/run.log`],
    });
    expect(classifyBashPoll({ command: `A=${SP}/a; A='${SP}/b c'; tail -1 "$A/run.log"` })).toMatchObject({
      paths: [],
    });
    expect(classifyBashPoll({ command: `A=${SP}/a; printf -v A %s ${SP}/b; tail -1 "$A/run.log"` })).toMatchObject({
      paths: [],
    });
    expect(classifyBashPoll({ command: `printf %s ---; tail -1 ${SP}/run.log` })).toMatchObject({
      paths: [`${SP}/run.log`],
    });
  });

  it("names no file when an assignment steers command lookup or a file a later command reads", () => {
    expect(classifyBashPoll({ command: `PATH=/tmp; tail -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `path=/tmp; tail -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `TZ=:/tmp/zone; date +%z; tail -1 ${SP}/run.log` })).toMatchObject({
      paths: [],
    });
    expect(classifyBashPoll({ command: `LC_ALL=C; tail -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `tmpPath=/tmp; tail -1 ${SP}/run.log` })).toMatchObject({
      paths: [`${SP}/run.log`],
    });
  });

  it("binds only a name no shell reserves — one or two characters, or mixed case — since a special one expands to something else", () => {
    // zsh: `RANDOM=1` seeds the generator, so `$RANDOM` reads 16807.log, not 1.log.
    expect(classifyBashPoll({ command: `RANDOM=1; tail $RANDOM.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `SECONDS=${SP}; tail "$SECONDS/run.log"` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `_=${SP}; tail "$_/run.log"` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `LOG=${SP}; tail -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `logDir=${SP}; tail "$logDir/run.log"` })).toMatchObject({
      paths: [`${SP}/run.log`],
    });
    expect(classifyBashPoll({ command: `S2=${SP}; tail "$S2/run.log"` })).toMatchObject({
      paths: [`${SP}/run.log`],
    });
  });
});
