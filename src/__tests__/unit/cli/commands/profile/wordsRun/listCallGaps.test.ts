/*
 * `profile words` naming a console call it could not read as a gap, never as no call: an indexed call whose file
 * is gone or holds no call activity, an unindexed file holding only a reconnect, and an indexed entry that is not
 * a regular file.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import { callIndexPath } from "../../../../../../talk/callStore.js";
import { home, run, useWordsHomes } from "./harness.js";

useWordsHomes();

describe("profile words — a list", () => {
  it("names a call the index records whose file is gone, rather than reading it as no call", () => {
    const call = "6e7f8091-0213-4b4c-9d5e-6f7081920314";
    mkdirSync(join(home, "talk"), { recursive: true });
    writeFileSync(callIndexPath({ home }), `${call}\n`, "utf8");

    const { code, lines } = run({ rest: [] });

    expect([code, lines.slice(1)]).toEqual([
      EXIT_ERROR,
      [`  not read — console-calls: call:${call} is in the call index but its file is gone`],
    ]);
  });

  it("names a call the index records whose file holds no call activity, rather than reading it as no call", () => {
    const empty = "6e7f8091-0213-4b4c-9d5e-6f7081920314";
    const blank = "7f809102-1324-4c5d-8e6f-708192031425";
    const reconnectOnly = "8091a213-2435-4d6e-9f70-8192a3b4c5d6";
    const reconnect = {
      atIso: "2026-10-04T09:00:00.000Z",
      event: { attempt: 1, delayMs: 0, kind: "scheduled", total: 5 },
      kind: "reconnect",
    };
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    writeFileSync(callIndexPath({ home }), `${empty}\n${blank}\n${reconnectOnly}\n`, "utf8");
    writeFileSync(join(home, "talk", "calls", `${empty}.jsonl`), "", "utf8");
    writeFileSync(join(home, "talk", "calls", `${blank}.jsonl`), "  \n\n", "utf8");
    writeFileSync(join(home, "talk", "calls", `${reconnectOnly}.jsonl`), `${JSON.stringify(reconnect)}\n`, "utf8");

    const { code, lines } = run({ rest: [] });

    expect([code, lines.slice(1)]).toEqual([
      EXIT_ERROR,
      [
        `  not read — console-calls: call:${empty} is in the call index but its file holds no call activity`,
        `  not read — console-calls: call:${blank} is in the call index but its file holds no call activity`,
        `  not read — console-calls: call:${reconnectOnly} is in the call index but its file holds no call activity`,
      ],
    ]);
  });

  it("names an unindexed call file whose only parsed line is a reconnect as not read", () => {
    const call = "6e7f8091-0213-4b4c-9d5e-6f7081920314";
    const reconnect = {
      atIso: "2026-10-04T09:00:00.000Z",
      event: { attempt: 1, delayMs: 0, kind: "scheduled", total: 5 },
      kind: "reconnect",
    };
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    writeFileSync(
      join(home, "talk", "calls", `${call}.jsonl`),
      `{"kind":"segm\n${JSON.stringify(reconnect)}\n`,
      "utf8",
    );

    const { code, lines } = run({ rest: [] });

    expect([code, lines.slice(1)]).toEqual([
      EXIT_ERROR,
      [`  not read — console-calls: ${call}: only reconnect lines parsed, beside 1 line(s) that did not`],
    ]);
  });

  it("names an indexed call whose entry is not a regular file once, as that, rather than also as gone", () => {
    const call = "6e7f8091-0213-4b4c-9d5e-6f7081920314";
    mkdirSync(join(home, "talk", "calls", `${call}.jsonl`), { recursive: true });
    writeFileSync(callIndexPath({ home }), `${call}\n`, "utf8");

    const { code, lines } = run({ rest: [] });

    expect([code, lines.slice(1)]).toEqual([
      EXIT_ERROR,
      [`  not read — console-calls: ${call}.jsonl: named for a call but not a regular file`],
    ]);
  });
});
