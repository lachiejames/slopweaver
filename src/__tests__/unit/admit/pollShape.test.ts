/**
 * The poll classifier — the measured shapes it must catch, and the real work it must never mistake for one.
 * Every "catches" case is a command lifted from a transcript, normalised.
 */
import { describe, expect, it } from "vitest";

import { classifyBashPoll, classifyPollShape, isLogLikePath } from "../../../admit/pollShape.js";
import { hasInertDollar } from "../../../admit/pollWords.js";

const SP = "/private/tmp/claude-501/-Users-x-dev-slopweaver--claude-worktrees-slug/0123-abcd/scratchpad";

describe("the measured poll shapes are polls", () => {
  it("catches a tail of a scratchpad log", () => {
    expect(classifyBashPoll({ command: `tail -c 400 ${SP}/validate.log` })).toEqual({
      kind: "poll",
      label: "log read",
      operands: ["400"],
      paths: [`${SP}/validate.log`],
      target: `${SP}/validate.log`,
    });
  });

  it("catches a cat of a scratchpad file", () => {
    expect(classifyBashPoll({ command: `cat ${SP}/gate.out` })).toEqual({
      kind: "poll",
      label: "log read",
      operands: [],
      paths: [`${SP}/gate.out`],
      target: `${SP}/gate.out`,
    });
  });

  it("catches a metadata read but names no file, since what it reports — an access time, a mode — is outside the token", () => {
    expect(classifyBashPoll({ command: `stat -f %a ${SP}/run.log` })).toEqual({
      kind: "poll",
      label: "log read",
      operands: [],
      paths: [],
      target: `${SP}/run.log`,
    });
    expect(classifyBashPoll({ command: `ls -l ${SP}/run.log` })).toMatchObject({ kind: "poll", paths: [] });
    expect(classifyBashPoll({ command: `test -r ${SP}/run.log` })).toMatchObject({ kind: "poll", paths: [] });
    expect(classifyBashPoll({ command: `wc -l ${SP}/run.log` })).toMatchObject({ paths: [`${SP}/run.log`] });
  });

  it("names no file when the command word itself comes from an assignment", () => {
    expect(classifyBashPoll({ command: `C=tail; "$C" -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
  });

  it("names no file when the command word is quoted at all, vouching only for a word written bare", () => {
    expect(classifyBashPoll({ command: `'tail' -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `"tail" -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `tail -1 ${SP}/run.log` })).toMatchObject({ paths: [`${SP}/run.log`] });
  });

  it("names no file when a command word has a path or an expansion, which could run any script", () => {
    expect(classifyBashPoll({ command: `~/bin/echo; tail -1 ${SP}/run.log` })).toMatchObject({
      paths: [],
      target: `${SP}/run.log`,
    });
    expect(classifyBashPoll({ command: `./sleep 1; tail -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `sleep 0 </tmp/secret; tail -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `sleep 5; tail -1 ${SP}/run.log` })).toMatchObject({
      paths: [`${SP}/run.log`],
    });
    expect(classifyBashPoll({ command: `/usr/bin/tail -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `echo; tail -1 ${SP}/run.log` })).toMatchObject({
      paths: [`${SP}/run.log`],
    });
  });

  it("names no file when a neutral segment could read one the token would not see", () => {
    expect(classifyBashPoll({ command: `echo "$(cat /tmp/secret.txt)"; tail -1 ${SP}/run.log` })).toMatchObject({
      paths: [],
      target: `${SP}/run.log`,
    });
    expect(classifyBashPoll({ command: `echo $(</tmp/secret.txt); tail -1 ${SP}/run.log` })).toMatchObject({
      paths: [],
    });
    expect(classifyBashPoll({ command: `tail -1 ${SP}/run.log | sed -n 1p` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `tail -1 ${SP}/run.log | awk '{print}'` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `X=1 cat /tmp/secret.txt; tail -1 ${SP}/run.log` })).toMatchObject({
      paths: [],
    });
    expect(classifyBashPoll({ command: `echo hi > /tmp/out.txt; tail -1 ${SP}/run.log` })).toMatchObject({
      paths: [],
    });
  });

  it("names what a neutral segment reads, and nothing for one that reads nothing", () => {
    expect(classifyBashPoll({ command: `echo ---; tail -5 ${SP}/run.log` })).toMatchObject({
      operands: [],
      paths: [`${SP}/run.log`],
    });
    expect(classifyBashPoll({ command: `tail -5 ${SP}/run.log | grep -f pats` })).toMatchObject({
      operands: ["pats"],
      paths: [`${SP}/run.log`],
    });
    expect(classifyBashPoll({ command: `date -r /tmp/stamp; tail -5 ${SP}/run.log` })).toMatchObject({
      operands: ["/tmp/stamp"],
      paths: [`${SP}/run.log`],
    });
  });

  it("counts a dash-leading word after an option as a possible file, since the option may take it", () => {
    expect(classifyBashPoll({ command: `grep -f -patterns ${SP}/run.log` })).toMatchObject({
      operands: ["-patterns"],
      paths: [`${SP}/run.log`],
    });
    expect(classifyBashPoll({ command: `grep -v -f -patterns ${SP}/run.log` })).toMatchObject({
      operands: ["-f", "-patterns"],
      paths: [`${SP}/run.log`],
    });
    expect(classifyBashPoll({ command: `grep -vE x ${SP}/run.log` })).toMatchObject({
      operands: ["x"],
      paths: [`${SP}/run.log`],
    });
  });

  it("catches a pid probe, which names no file to fingerprint", () => {
    expect(classifyBashPoll({ command: "kill -0 50618 2>/dev/null && echo running || echo done" })).toEqual({
      kind: "poll",
      label: "pid probe",
      operands: [],
      paths: [],
      target: "pid:50618",
    });
  });

  it("catches an until loop and keys it on the file it greps", () => {
    expect(
      classifyBashPoll({ command: `until grep -qE "exited with code" ${SP}/checks.log; do sleep 15; done` }),
    ).toEqual({
      kind: "poll",
      label: "foreground loop",
      operands: [],
      // A loop waits on whatever its body reads, so it carries no token: the clock rule.
      paths: [],
      target: `${SP}/checks.log`,
    });
  });

  it("catches a bounded `for i in $(seq …)` counting loop — 665 of 841 measured loops were this shape", () => {
    const command =
      "for i in $(seq 1 24); do out=$(slopweaver github read https://github.com/o/r/pull/834 --json); " +
      'case "$out" in *merged*) exit 0;; esac; sleep 75; done';
    expect(classifyBashPoll({ command })).toEqual({
      kind: "poll",
      label: "foreground loop",
      // A URL is no file, so the loop keeps the clock rule.
      operands: [],
      paths: [],
      // The pull-request URL is the first path-looking word, so two loops watching the same pull request
      // share one 60-second window instead of each getting its own `loop:<text>` key.
      target: "https://github.com/o/r/pull/834",
    });
  });

  it("catches a for loop over a numeric word list too, keyed on the file it reads", () => {
    const shape = classifyBashPoll({ command: `for i in 1 2 3; do tail -5 ${SP}/push.log; sleep 20; done` });
    expect(shape).toEqual({
      kind: "poll",
      label: "foreground loop",
      operands: [],
      paths: [],
      target: `${SP}/push.log`,
    });
  });

  it("catches a loop that opens a LATER segment, after a cd", () => {
    const shape = classifyBashPoll({ command: `cd /repo && for f in 1 2 3; do tail -3 ${SP}/b.log; sleep 4; done` });
    // The key is the first path-looking word in the WHOLE command, so a leading `cd` donates it — coarser
    // than the log the loop reads, and long-standing behaviour of this branch rather than anything the
    // segment-opener check introduced. It still dedupes; it just dedupes two loops under one repository.
    expect(shape).toEqual({ kind: "poll", label: "foreground loop", operands: [], paths: [], target: "/repo" });
  });

  it("catches the multi-line spelling, where `do` sits on its own line", () => {
    const shape = classifyBashPoll({ command: `for i in $(seq 1 5)\ndo\n  cat ${SP}/c.log\n  sleep 9\ndone` });
    expect(shape).toEqual({
      kind: "poll",
      label: "foreground loop",
      operands: [],
      paths: [],
      target: `${SP}/c.log`,
    });
  });

  it("catches the C-style for loop spelling", () => {
    const shape = classifyBashPoll({ command: `for ((i=0;i<20;i++)); do cat ${SP}/ci.status; sleep 30; done` });
    expect(shape).toEqual({
      kind: "poll",
      label: "foreground loop",
      operands: [],
      paths: [],
      target: `${SP}/ci.status`,
    });
  });

  it("catches a SECONDS deadline loop and keys it on its own text when it names no file", () => {
    const command =
      "end=$((SECONDS+420)); while [ $SECONDS -lt $end ]; do out=$(slopweaver turn review --poll); sleep 20; done";
    const shape = classifyBashPoll({ command });
    expect(shape.kind).toBe("poll");
    expect(shape.kind === "poll" && shape.label).toBe("foreground loop");
    expect(shape.kind === "poll" && shape.target.startsWith("loop:")).toBe(true);
    expect(shape).toMatchObject({ kind: "poll", operands: [], paths: [] });
  });

  it("keys a loop that names no file on the pid it probes, before its own text", () => {
    expect(classifyBashPoll({ command: "while kill -0 4242 ; do sleep 5; done" })).toEqual({
      kind: "poll",
      label: "foreground loop",
      operands: [],
      paths: [],
      target: "pid:4242",
    });
  });

  it("catches a sleep followed by a log read, keyed on the log alone", () => {
    expect(classifyBashPoll({ command: `sleep 30; tail -20 ${SP}/run.log` })).toEqual({
      kind: "poll",
      label: "log read",
      operands: [],
      paths: [`${SP}/run.log`],
      target: `${SP}/run.log`,
    });
  });

  it("names no file when a pid probe rides beside a log read — a token for the file cannot vouch for the pid", () => {
    expect(classifyBashPoll({ command: `kill -0 4242; tail -1 ${SP}/run.log` })).toEqual({
      kind: "poll",
      label: "pid probe + log read",
      operands: [],
      paths: [],
      target: `${SP}/run.log pid:4242`,
    });
  });

  it("catches a second grep of a source file in a worktree under .claude/, and names the file to fingerprint", () => {
    const source = "/Users/x/dev/slopweaver/.claude/worktrees.noindex/slug/src/admit/pollGate.ts";
    expect(classifyBashPoll({ command: `grep -n decidePoll ${source}` })).toEqual({
      kind: "poll",
      label: "log read",
      // The pattern is an operand the fingerprint stats and skips when no file by that name exists.
      operands: ["decidePoll"],
      paths: [source],
      target: source,
    });
  });

  it("catches a cd, a read of a state log, and an echo — the no-ops do not launder it", () => {
    expect(
      classifyBashPoll({ command: "cd /repo && cat /opt/state/.slopweaver/live/listener/journal.jsonl; echo ok" }),
    ).toEqual({
      kind: "poll",
      label: "log read",
      operands: [],
      paths: [],
      target: "/opt/state/.slopweaver/live/listener/journal.jsonl",
    });
  });

  it("catches a task-output cat piped through a filter, keyed on the file", () => {
    expect(classifyBashPoll({ command: `cat ${SP}/tasks/bj5t85hag.output | tail -12` })).toEqual({
      kind: "poll",
      label: "log read",
      operands: [],
      paths: [`${SP}/tasks/bj5t85hag.output`],
      target: `${SP}/tasks/bj5t85hag.output`,
    });
    expect(
      classifyBashPoll({ command: `cat ${SP}/tasks/b69n75fjb.output 2>/dev/null | cut -c1-200 | tail -25` }),
    ).toEqual({
      kind: "poll",
      label: "log read",
      operands: [],
      paths: [`${SP}/tasks/b69n75fjb.output`],
      target: `${SP}/tasks/b69n75fjb.output`,
    });
  });

  it("catches a ps probe of a pid", () => {
    expect(classifyBashPoll({ command: "ps -p 35535 -o command= 2>/dev/null" })).toEqual({
      kind: "poll",
      label: "pid probe",
      operands: [],
      paths: [],
      target: "pid:35535",
    });
  });

  it("names EVERY file a single read names, though only the first keys the window", () => {
    expect(classifyBashPoll({ command: `tail -n 3 ${SP}/b.log ${SP}/a.log notes 2>/dev/null` })).toEqual({
      kind: "poll",
      label: "log read",
      operands: ["3", "notes"],
      paths: [`${SP}/a.log`, `${SP}/b.log`],
      target: `${SP}/b.log`,
    });
  });

  it("names no file when the command changes directory, which the token neither resolves against nor records", () => {
    expect(classifyBashPoll({ command: "cd /other; tail -1 run.log" })).toMatchObject({
      kind: "poll",
      operands: [],
      paths: [],
    });
    expect(classifyBashPoll({ command: `cd /other && tail -1 ${SP}/run.log notes` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `cd /other && tail -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `tail -1 ${SP}/cdrom.log` })).toMatchObject({ paths: [`${SP}/cdrom.log`] });
    expect(classifyBashPoll({ command: `'cd' /tmp/other; cat run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `"cd" /tmp/other; tail -1 run.log` })).toMatchObject({ paths: [] });
  });

  it("keeps a bare number as an operand, since `cat 123` reads a file named 123", () => {
    expect(classifyBashPoll({ command: `cat 123 ${SP}/run.log` })).toMatchObject({
      operands: ["123"],
      paths: [`${SP}/run.log`],
    });
  });

  it("names no file when an option carries a file in the same word — the token could not see it", () => {
    expect(classifyBashPoll({ command: `grep -f${SP}/patterns ${SP}/run.log` })).toEqual({
      kind: "poll",
      label: "log read",
      operands: [],
      paths: [],
      target: `${SP}/run.log`,
    });
    expect(classifyBashPoll({ command: `grep --file=pats ${SP}/run.log` })).toMatchObject({ operands: [], paths: [] });
    expect(classifyBashPoll({ command: `grep -fpatterns ${SP}/run.log` })).toMatchObject({ operands: [], paths: [] });
    expect(classifyBashPoll({ command: `tail -1 ${SP}/run.log | sort -oresult` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `tail -1 ${SP}/run.log | sort -nTtmp` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `date -r/tmp/stamp; tail -1 ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `tail -1 ${SP}/run.log | cut -f2-3` })).toMatchObject({
      paths: [`${SP}/run.log`],
    });
    expect(classifyBashPoll({ command: `grep -nf pats ${SP}/run.log` })).toMatchObject({
      operands: ["pats"],
      paths: [`${SP}/run.log`],
    });
    expect(classifyBashPoll({ command: `grep -oE poll ${SP}/run.log` })).toMatchObject({
      operands: ["poll"],
      paths: [`${SP}/run.log`],
    });
    expect(classifyBashPoll({ command: `cat -- -n ${SP}/run.log` })).toMatchObject({ operands: [], paths: [] });
    expect(classifyBashPoll({ command: `grep -i --count poll ${SP}/run.log` })).toMatchObject({
      operands: ["--count", "poll"],
      paths: [`${SP}/run.log`],
    });
  });

  it("names no file when a redirect could open one, but reads straight through an inert one", () => {
    expect(classifyBashPoll({ command: `tail -1 ${SP}/run.log <extra` })).toMatchObject({ operands: [], paths: [] });
    expect(classifyBashPoll({ command: `tail -1 ${SP}/run.log 2>&1 >/dev/null` })).toMatchObject({
      operands: [],
      paths: [`${SP}/run.log`],
    });
  });

  it("names no file when the shell expands a word — a substitution, a variable or a glob reads what the token cannot see", () => {
    expect(classifyBashPoll({ command: `grep "$(cat pattern)" ${SP}/run.log` })).toMatchObject({
      kind: "poll",
      operands: [],
      paths: [],
    });
    expect(classifyBashPoll({ command: `grep \`cat pattern\` ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `tail -1 ${SP}/run.log $EXTRA` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `tail -1 ${SP}/run.log other*` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `tail -1 ~/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `cat =ls ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `cat ^skip ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `cat ${SP}/run.log foo<1-10>` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `grep "$HOME" ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `grep 'unclosed ${SP}/run.log` })).toMatchObject({ paths: [] });
    expect(classifyBashPoll({ command: `rg poll ${SP}/run.log` })).toMatchObject({ paths: [] });
  });

  it("names a quoted word that the shell passes through untouched, whatever it holds", () => {
    expect(classifyBashPoll({ command: `grep -B4 'landing failed: #2854' ${SP}/run.log` })).toMatchObject({
      operands: ["landing failed: #2854"],
      paths: [`${SP}/run.log`],
    });
    expect(classifyBashPoll({ command: `grep -vE '^\\s*$' ${SP}/run.log` })).toMatchObject({
      operands: ["^\\s*$"],
      paths: [`${SP}/run.log`],
    });
    expect(classifyBashPoll({ command: `grep "a b" ${SP}/run.log` })).toMatchObject({
      operands: ["a b"],
      paths: [`${SP}/run.log`],
    });
    // One shell word, `xa b`: a quote glued to a word joins it, never splits it.
    expect(classifyBashPoll({ command: `cat ${SP}/run.log x'a b'` })).toMatchObject({ operands: ["xa b"] });
  });

  it("joins several probed targets into one sorted key, and names every file", () => {
    expect(classifyBashPoll({ command: `tail -1 ${SP}/b.log; tail -1 ${SP}/a.log` })).toEqual({
      kind: "poll",
      label: "log read",
      operands: [],
      paths: [`${SP}/a.log`, `${SP}/b.log`],
      target: `${SP}/a.log ${SP}/b.log`,
    });
  });
});

describe("real work is never a poll", () => {
  it("allows a cat of a source file", () => {
    expect(classifyBashPoll({ command: "cat src/admit/pollShape.ts" })).toEqual({ kind: "not-poll" });
  });

  it("allows a read followed by real work", () => {
    expect(classifyBashPoll({ command: `tail -1 ${SP}/x.log && yarn validate` })).toEqual({ kind: "not-poll" });
  });

  it("allows a slopweaver verb, even beside a scratchpad assignment", () => {
    expect(
      classifyBashPoll({ command: `S=${SP}; slopweaver github checks --wait --repo o/r --pr 1 > "$S/ci.log"` }),
    ).toEqual({
      kind: "not-poll",
    });
  });

  it("allows a bare sleep on its own (the harness already refuses it)", () => {
    expect(classifyBashPoll({ command: "sleep 5" })).toEqual({ kind: "not-poll" });
  });

  it("allows an empty command", () => {
    expect(classifyBashPoll({ command: "   " })).toEqual({ kind: "not-poll" });
  });

  it("allows a tail with no file", () => {
    expect(classifyBashPoll({ command: "tail -n 5" })).toEqual({ kind: "not-poll" });
  });

  it("allows a grep over the repository", () => {
    expect(classifyBashPoll({ command: 'grep -rn "poll" src/' })).toEqual({ kind: "not-poll" });
  });

  it("allows a commit whose MESSAGE says for, sleep and done — the `for` arm needs loop syntax", () => {
    const command = 'git commit -m "Wait for the lock instead of a sleep loop; the retry is done"';
    expect(classifyBashPoll({ command })).toEqual({ kind: "not-poll" });
  });

  it("allows a sleep between two echoes, one of which says `for` — a bare sleep is the harness's business", () => {
    expect(classifyBashPoll({ command: 'echo "waiting for CI"; sleep 30; echo done' })).toEqual({ kind: "not-poll" });
  });

  it("allows a verb whose own ARGUMENT quotes a whole loop — the real gate refused this exact call", () => {
    const command =
      'slopweaver knowledge record --domain poll-gate --evidence "665 of 841 were ' +
      '`for i in $(seq 1 N); do … sleep N; done`" --repro "grep -E \'(while|for) .*sleep [0-9]\'"';
    expect(classifyBashPoll({ command })).toEqual({ kind: "not-poll" });
  });

  it("allows a python heredoc that happens to mention a scratchpad path", () => {
    expect(classifyBashPoll({ command: `python3 - <<'PY'\nprint(open("${SP}/x.log").read())\nPY` })).toEqual({
      kind: "not-poll",
    });
  });
});

describe("classifyPollShape by tool", () => {
  it("keys a TaskOutput call on its task id", () => {
    expect(
      classifyPollShape({ toolInput: { block: true, task_id: "bo32y78d4", timeout: 600_000 }, toolName: "TaskOutput" }),
    ).toEqual({
      kind: "poll",
      label: "task output",
      operands: [],
      paths: [],
      target: "task:bo32y78d4",
    });
  });

  it("ignores a TaskOutput call with no task id", () => {
    expect(classifyPollShape({ toolInput: {}, toolName: "TaskOutput" })).toEqual({ kind: "not-poll" });
  });

  it("never judges a Monitor", () => {
    expect(classifyPollShape({ toolInput: { command: `tail -f ${SP}/x.log` }, toolName: "Monitor" })).toEqual({
      kind: "not-poll",
    });
  });

  it("ignores a Bash payload with no command", () => {
    expect(classifyPollShape({ toolInput: {}, toolName: "Bash" })).toEqual({ kind: "not-poll" });
  });
});

describe("isLogLikePath", () => {
  it("accepts a temp, scratchpad, state or log-extension path", () => {
    expect(isLogLikePath({ path: "/var/folders/2g/x/T/out" })).toBe(true);
    expect(isLogLikePath({ path: `${SP}/anything` })).toBe(true);
    expect(isLogLikePath({ path: "/opt/state/.slopweaver/runs/a.jsonl" })).toBe(true);
    expect(isLogLikePath({ path: "build/output.log" })).toBe(true);
  });

  it("rejects a source path", () => {
    expect(isLogLikePath({ path: "src/admit/pollShape.ts" })).toBe(false);
  });
});

describe("hasInertDollar", () => {
  it("finds a dollar the shell passes through unexpanded", () => {
    expect(hasInertDollar({ text: `tail '$S/x'` })).toBe(true);
    expect(hasInertDollar({ text: `tail \\$S/x` })).toBe(true);
    expect(hasInertDollar({ text: `tail "a\\$S"` })).toBe(true);
    expect(hasInertDollar({ text: `tail $'$S'` })).toBe(true);
  });

  it("passes a dollar the shell expands, a single quote inside double quotes included", () => {
    expect(hasInertDollar({ text: `tail "$S/x"` })).toBe(false);
    expect(hasInertDollar({ text: `tail "it's" $S` })).toBe(false);
    expect(hasInertDollar({ text: `tail 'a' $S \\n` })).toBe(false);
    expect(hasInertDollar({ text: "" })).toBe(false);
  });
});
