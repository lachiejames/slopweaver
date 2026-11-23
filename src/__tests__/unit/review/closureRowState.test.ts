/**
 * The precondition an ended-question settle passes at the write: a question edited since the board read leaves the
 * row, and so does a row somebody is now on.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { closureRowState, endedQuestionPrecondition } from "../../../review/closureRowState.js";
import { ask } from "../sweep/askDocFixture.js";

const QUESTION = "Close https://github.com/acme/app/pull/2?";
const homes: string[] = [];

/** A throwaway state home with an empty runs directory. */
function home(): string {
  const root = mkdtempSync(join(tmpdir(), "closure-row-"));
  homes.push(root);
  mkdirSync(join(root, "runs"), { recursive: true });
  return root;
}

const liveDoc = ask({ settlement: undefined, settlementWitness: undefined, slug: "close-it", summary: QUESTION });

afterEach(() => {
  homes.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
});

describe("closureRowState", () => {
  it("reads a row with no journal as ready and never started", () => {
    expect(closureRowState({ doc: liveDoc, runsDir: join(home(), "runs") })).toEqual({
      run: "never-started",
      status: "ready",
    });
  });
});

describe("endedQuestionPrecondition", () => {
  it("settles a row whose question is unchanged and whose run never started", () => {
    expect(endedQuestionPrecondition({ question: QUESTION })({ doc: liveDoc, home: home() })).toBe(undefined);
  });

  it("leaves a row whose question changed after the board read it", () => {
    const why = endedQuestionPrecondition({ question: "An earlier wording?" })({ doc: liveDoc, home: home() });

    expect(why).toBe(
      "its question changed after the board read it, so GitHub was not asked about every pull request it names now — the next pass reads it again",
    );
  });

  it("leaves a row whose run started after the board read it", () => {
    const root = home();
    writeFileSync(
      join(root, "runs", "close-it.jsonl"),
      `${JSON.stringify({ atIso: "2026-11-08T07:00:00.000Z", branch: "b", docHash: "h", kind: "started" })}\n`,
      "utf8",
    );

    expect(endedQuestionPrecondition({ question: QUESTION })({ doc: liveDoc, home: root })).toBe(
      "its run is active, and that run ends it",
    );
  });
});
