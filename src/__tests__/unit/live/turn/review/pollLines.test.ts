/**
 * `reviewPollLines` — the lines a poll prints for each truth, and whether the worker is done: a clean
 * verdict is sufficient, a polish is not a stale verdict, and a superseded file is refused outright.
 * Pure: a truth in, lines out.
 */
import { describe, expect, it } from "vitest";

import { CLEAN_IS_SUFFICIENT, reviewPollLines } from "../../../../../live/turn/reviewPoll.js";

describe("reviewPollLines", () => {
  it("is done only on a bound verdict, and says where a clean one goes next", () => {
    const clean = reviewPollLines({
      truth: { digestMatches: true, kind: "verdict", outcome: "clean", path: "/tmp/v.json" },
    });
    expect(clean.done).toBe(true);
    expect(clean.lines).toStrictEqual([
      "verdict: clean /tmp/v.json",
      "carry it to the door: slopweaver turn answer … --verdict /tmp/v.json",
      CLEAN_IS_SUFFICIENT,
    ]);
  });

  // The six-round spiral: a clean verdict that does not say clean is ENOUGH leaves the worker to
  // invent a stopping rule, and the one it invents costs hours. See CLEAN_IS_SUFFICIENT's own note.
  it("tells a worker on a clean verdict that the low-impact residue is advisory", () => {
    const clean = reviewPollLines({
      truth: { digestMatches: true, kind: "verdict", outcome: "clean", path: "/tmp/v.json" },
    });

    expect(clean.lines[2]).toBe(CLEAN_IS_SUFFICIENT);
    expect(CLEAN_IS_SUFFICIENT).toContain("VOIDS this verdict");
    // The limit is load-bearing: "advisory" must never read as "ignore a claim that is actually wrong".
    expect(CLEAN_IS_SUFFICIENT).toContain("materially WRONG is not polish");
  });

  // The recovery half: once a worker HAS polished after a pass, the mismatch branch used to tell it to
  // "review again", which is the instruction that closed the loop. A polish after CLEAN is a different
  // situation from a stale verdict after BROKEN, and only the second one wants another round.
  it("distinguishes a polish after a PASS from a genuinely stale verdict", () => {
    const polished = reviewPollLines({
      truth: { digestMatches: false, kind: "verdict", outcome: "clean", path: "/tmp/v.json" },
    });
    const stale = reviewPollLines({
      truth: { digestMatches: false, kind: "verdict", outcome: "broken", path: "/tmp/v.json" },
    });

    expect(polished.done).toBe(false);
    // It must NOT assert which of the two happened: a current reviewer binding the wrong digest produces
    // this same truth, and telling that worker to "restore and send" would be wrong.
    expect(polished.lines[1]).toContain("bound to bytes other than the ones you hold");
    expect(polished.lines[2]).toContain("If your edit was a POLISH");
    // Restoring must never be offered for a SUBSTANTIVE correction, or the advice reverses a
    // real fix whose false claim the verdict had wrongly marked supported.
    expect(polished.lines[4]).toContain("KEEP it and take the round");
    expect(polished.lines[5]).toContain("restore your way past a real fix");
    expect(stale.lines[1]).toBe(
      "the reviewer bound its verdict to different bytes: review again rather than editing either file",
    );
  });

  it("tells the worker a broken verdict will be refused and what to do instead", () => {
    const broken = reviewPollLines({
      truth: { digestMatches: true, kind: "verdict", outcome: "broken", path: "/tmp/v.json" },
    });
    expect(broken.done).toBe(true);
    expect(broken.lines[1]).toBe(
      "the door will refuse this — read the verdict's claims, fix the answer, re-validate and review again",
    );
  });

  it("names a dead reviewer as something to re-run, not something to keep polling", () => {
    const dead = reviewPollLines({ truth: { kind: "phantom", reason: "host exited", why: "host-exited" } });
    expect(dead.done).toBe(false);
    expect(dead.lines).toStrictEqual(["reviewer died before writing a verdict: host exited — run turn review again"]);
  });

  it("REFUSES a superseded file outright instead of inviting another poll of the same bytes", () => {
    const stale = reviewPollLines({
      truth: { kind: "superseded", path: "/tmp/v.json", wroteIt: "reviewer workspace workspace:3 (id-workspace:3)" },
    });
    expect(stale.done).toBe(false);
    expect(stale.lines[0]).toBe(
      "REFUSED: /tmp/v.json holds a PREVIOUS round's verdict, written by reviewer workspace workspace:3 (id-workspace:3) — not this reviewer's",
    );
    expect(stale.lines[1]).toBe(
      "it is not this answer's review and re-reading it will never make it current; record.json's answerDigest is the authoritative one",
    );
    expect(stale.lines[2]).toBe(
      "turn review --poll archives a file like this itself and records it in the loop-breakage ledger — poll again; a refusal that repeats means that archive is failing, and the line before this one says why",
    );
  });
});
