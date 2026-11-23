/**
 * The poll gate names the one command that replaces a refused poll — and every verb it names really carries
 * the flag it names, read off that verb's own flag spec rather than restated here.
 */
import { describe, expect, it } from "vitest";

import { decidePoll, pollRefusal } from "../../../admit/pollGate.js";
import { pollReplacement, pullRequestNumber, WAIT_REPLACEMENTS } from "../../../admit/pollReplacement.js";
import { classifyBashPoll, classifyPollShape } from "../../../admit/pollShape.js";
import { CMUX_FLAG_NAMES } from "../../../cli/commands/cmux/core.js";
import { GITHUB_CHECKS_FLAG_NAMES } from "../../../cli/commands/github/checksCore.js";
import { GITHUB_STACK_PUSH_FLAG_NAMES } from "../../../cli/commands/github/stackPushCore.js";
import { MACHINE_CAPACITY_FLAG_NAMES } from "../../../cli/commands/machine/capacity.js";
import { TURN_REVIEW_FLAG_SPEC } from "../../../cli/commands/turn/core.js";

/** Every named verb's REAL flags, `--`-prefixed. */
const REAL_FLAGS: Readonly<Record<string, readonly string[]>> = {
  "cmux spawn": CMUX_FLAG_NAMES["spawn"]!,
  "github checks": GITHUB_CHECKS_FLAG_NAMES,
  "github stack push": GITHUB_STACK_PUSH_FLAG_NAMES,
  "machine capacity": MACHINE_CAPACITY_FLAG_NAMES,
  "turn review": [...TURN_REVIEW_FLAG_SPEC.boolean, ...TURN_REVIEW_FLAG_SPEC.string].map((name) => `--${name}`),
};

/** The measured merge-watch loop that started the re-measurement, trimmed to one line. */
const MERGE_WATCH =
  "for i in $(seq 1 24); do out=$(slopweaver github read https://github.com/o/r/pull/834 --json 2>&1 | " +
  'grep \'"merged"\'); case "$out" in *\'"merged": true\'*) exit 0;; esac; sleep 75; done';

describe("WAIT_REPLACEMENTS", () => {
  it("names only flags the verb really accepts", () => {
    expect(WAIT_REPLACEMENTS.length).toBeGreaterThan(0);
    const missing = WAIT_REPLACEMENTS.filter((row) => !REAL_FLAGS[row.verb]!.includes(row.flag)).map(
      (row) => `${row.verb} ${row.flag}`,
    );
    expect(missing).toEqual([]);
  });

  it("puts the flag it names in the command it prints", () => {
    const unnamed = WAIT_REPLACEMENTS.filter((row) => !row.command.includes(row.flag)).map((row) => row.verb);
    expect(unnamed).toEqual([]);
  });

  it("gives every row at least one pattern to match on", () => {
    const empty = WAIT_REPLACEMENTS.filter((row) => row.patterns.length === 0).map((row) => row.verb);
    expect(empty).toEqual([]);
  });
});

describe("pullRequestNumber", () => {
  it("lifts a number out of a pull-request URL", () => {
    expect(pullRequestNumber({ command: "slopweaver github read https://github.com/o/r/pull/933" })).toBe("933");
  });

  it("lifts a number out of --pr", () => {
    expect(pullRequestNumber({ command: "slopweaver github enqueue --pr 944 --dry-run" })).toBe("944");
  });

  it("lifts a number out of --number", () => {
    expect(pullRequestNumber({ command: "slopweaver github checks --number 12" })).toBe("12");
  });

  it("finds none in a command that names no pull request", () => {
    expect(pullRequestNumber({ command: "tail -5 /tmp/x/validate.log" })).toBeUndefined();
  });
});

describe("pollReplacement", () => {
  it("names a verb's own --wait for a loop around that verb", () => {
    expect(
      pollReplacement({
        command: "while true; do slopweaver turn review --dispatch X --poll; sleep 30; done",
        target: "loop:x",
      }),
    ).toBe("slopweaver turn review --dispatch <id> --poll --wait");
  });

  it("names slopweaver wait --pid for a pid probe", () => {
    expect(pollReplacement({ command: "kill -0 4242", target: "pid:4242" })).toBe("slopweaver wait --pid 4242");
  });

  it("names slopweaver wait --file for a log read", () => {
    expect(pollReplacement({ command: "tail -5 /tmp/x/validate.log", target: "/tmp/x/validate.log" })).toBe(
      "slopweaver wait --file /tmp/x/validate.log --contains <the line that means it finished>",
    );
  });

  it("names nothing better than the blocking TaskOutput recipe for a task", () => {
    expect(pollReplacement({ command: undefined, target: "task:b1" })).toBeUndefined();
  });
});

describe("a merge watch is answered by a DIFFERENT verb", () => {
  it("names github checks --until merge for a github read loop watching for merged", () => {
    expect(pollReplacement({ command: MERGE_WATCH, target: "loop:x" })).toBe(
      "slopweaver github checks --number 834 --until merge",
    );
  });

  it("names it for the github enqueue --dry-run spelling of the same watch", () => {
    expect(
      pollReplacement({
        command:
          "for i in $(seq 1 24); do out=$(slopweaver github enqueue --pr 880 --repo o/r --dry-run 2>&1); " +
          'case "$out" in *merged*) exit 0;; esac; sleep 60; done',
        target: "loop:x",
      }),
    ).toBe("slopweaver github checks --number 880 --until merge");
  });

  it("names --until any for a github read loop that is not watching for a merge", () => {
    expect(
      pollReplacement({
        command:
          "for i in $(seq 1 12); do slopweaver github read https://github.com/o/r/pull/927 --json; sleep 60; done",
        target: "loop:x",
      }),
    ).toBe("slopweaver github checks --number 927 --until any");
  });

  it("keeps the placeholder when the loop names no pull request", () => {
    expect(
      pollReplacement({
        command: "until slopweaver github enqueue --dry-run | grep -q merged; do sleep 60; done",
        target: "loop:x",
      }),
    ).toBe("slopweaver github checks --number <n> --until merge");
  });

  it("still answers a plain github checks loop with that verb's own --wait", () => {
    expect(
      pollReplacement({
        command: "while true; do slopweaver github checks --number 501; sleep 30; done",
        target: "loop:x",
      }),
    ).toBe("slopweaver github checks --number 501 --wait (or --until review|any|merge)");
  });

  it("names github stack push --wait for the lock-contention retry loop", () => {
    expect(
      pollReplacement({
        command:
          'for i in 1 2 3 4 5 6 7 8; do out=$(slopweaver github stack push --form "$(cat $F)" 2>&1); ' +
          'if ! echo "$out" | grep -q "another stack operation is in progress"; then break; fi; sleep 30; done',
        target: "loop:x",
      }),
    ).toBe("slopweaver github stack push --form <json> --wait");
  });
});

describe("the refusal names the replacement", () => {
  it("names a machine capacity loop's --wait for the key the classifier gave it", () => {
    const command = "until ! slopweaver machine capacity --json | grep -q '\"hold\":true'; do sleep 60; done";
    const shape = classifyBashPoll({ command });
    expect(shape.kind).toBe("poll");
    const target = (shape as Extract<typeof shape, { kind: "poll" }>).target;
    expect(pollReplacement({ command, target })).toBe("slopweaver machine capacity --wait");
  });

  it("puts the replacement into the refusal a repeat gets", () => {
    const shape = { kind: "poll", label: "foreground loop", operands: [], paths: [], target: "loop:x" } as const;
    const replacement = "slopweaver machine capacity --wait";
    const message = pollRefusal({ label: "foreground loop", replacement, secondsAgo: 10, target: "loop:x" });
    expect(
      decidePoll({
        allowPoll: false,
        fingerprint: undefined,
        lastFingerprint: undefined,
        lastSeenMs: 0,
        nowMs: 10_000,
        replacement,
        shape,
      }),
    ).toEqual({
      kind: "block",
      message,
    });
    expect(message).toContain("Wait with ONE call instead: slopweaver machine capacity --wait");
  });

  it("carries no replacement for a TaskOutput poll", () => {
    expect(classifyPollShape({ toolInput: { task_id: "b1" }, toolName: "TaskOutput" })).toEqual({
      kind: "poll",
      label: "task output",
      operands: [],
      paths: [],
      target: "task:b1",
    });
  });
});
