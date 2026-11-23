/**
 * `routedRows`: which board rows an `answered` witness routes a turn to, so `intake-mark` carries the owner's words there.
 */
import { describe, expect, it } from "vitest";

import { carryCommand, routedRows } from "../../../supervisor/intakeRoute.js";

const BOARD = new Set(["the-ask", "a-second-row", "v2.", "main"]);

describe("routedRows", () => {
  it("routes a witness that is the slug alone", () => {
    expect(routedRows({ slugs: BOARD, witness: "the-ask" })).toEqual(["the-ask"]);
  });

  it("routes a slug named in prose — the incident's own shape", () => {
    expect(routedRows({ slugs: BOARD, witness: "goes to row the-ask, carried there" })).toEqual(["the-ask"]);
  });

  it("peels wrapping punctuation, and keeps a slug that itself ends in a dot", () => {
    expect(routedRows({ slugs: BOARD, witness: "(`the-ask`)." })).toEqual(["the-ask"]);
    expect(routedRows({ slugs: new Set(["row-v2."]), witness: "see (row-v2.)" })).toEqual(["row-v2."]);
  });

  it("routes a whole witness that is exactly a trailing-dot slug to that row, not its peeled neighbour", () => {
    expect(routedRows({ slugs: new Set(["row-v2", "row-v2."]), witness: "row-v2." })).toEqual(["row-v2."]);
  });

  it("names each distinct row once, in the order the witness first names it", () => {
    expect(routedRows({ slugs: BOARD, witness: "a-second-row and the-ask, then a-second-row again" })).toEqual([
      "a-second-row",
      "the-ask",
    ]);
  });

  it("routes nowhere for a slug the board does not hold", () => {
    expect(routedRows({ slugs: BOARD, witness: "goes to live-bot-loop-21sep-c-a4" })).toEqual([]);
  });

  it("never routes a hyphenless word inside prose, even one a row happens to be named", () => {
    expect(routedRows({ slugs: BOARD, witness: "merged to main" })).toEqual([]);
  });

  it("routes a hyphenless slug when it is the whole witness", () => {
    expect(routedRows({ slugs: BOARD, witness: " `main`. " })).toEqual(["main"]);
  });

  it("never routes a token isSafeSlug refuses, even one the lookup claims", () => {
    expect(routedRows({ slugs: new Set(["../a-row"]), witness: "goes to ../a-row" })).toEqual([]);
  });

  it("routes nowhere for an empty witness", () => {
    expect(routedRows({ slugs: BOARD, witness: "" })).toEqual([]);
  });
});

describe("carryCommand", () => {
  it("names the handover quote line that carries one turn onto one row, in the mark's own home", () => {
    expect(carryCommand({ home: "/tmp/custom-home", pointer: "talk:abc", slug: "the-ask" })).toBe(
      "slopweaver handover quote the-ask --add-steer talk:abc --apply --home /tmp/custom-home",
    );
  });

  it("keeps a transcript pointer's mid-word # bare, and single-quotes a pointer a shell would split", () => {
    expect(carryCommand({ home: "/h", pointer: "transcript:s-1#t-2", slug: "the-ask" })).toBe(
      "slopweaver handover quote the-ask --add-steer transcript:s-1#t-2 --apply --home /h",
    );
    expect(carryCommand({ home: "/h", pointer: "talk-call:c-1#seg;false", slug: "the-ask" })).toBe(
      "slopweaver handover quote the-ask --add-steer 'talk-call:c-1#seg;false' --apply --home /h",
    );
  });

  it("never leaves a word bare that opens with # or =", () => {
    expect(carryCommand({ home: "#h", pointer: "=p", slug: "the-ask" })).toBe(
      "slopweaver handover quote the-ask --add-steer '=p' --apply --home '#h'",
    );
  });

  it("single-quotes a home a shell would split or expand", () => {
    expect(carryCommand({ home: "/tmp/it's a home", pointer: "talk:abc", slug: "the-ask" })).toBe(
      "slopweaver handover quote the-ask --add-steer talk:abc --apply --home '/tmp/it'\\''s a home'",
    );
  });
});
