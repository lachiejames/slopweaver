import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { DONE_MILESTONE_ID } from "../../../workstreams/store/doneMilestoneId.js";
import { validCandidates } from "../workstreams/candidatesFixture.js";
import { failingStore } from "../workstreams/storeRegisterFixture.js";
import {
  cleanupScratch,
  fresh,
  putCandidates,
  registered,
  registerIds,
  registerOf,
  run,
  runEach,
  seeded,
  storedOf,
} from "./workstreamsCandidatesVerbsHarness.js";

afterEach(cleanupScratch);

describe("workstreams react", () => {
  it("records the owner's words and makes a new yes a register entry, once", async () => {
    const seat = await seeded();
    const { home } = seat;
    const first = await run({
      seat,
      rest: ["2", "yes,", "3", "sort", "of", "--via", "word", "--home", home, "--json"],
      verb: "react",
    });
    expect(first.exit).toBe(EXIT_OK);
    expect(JSON.parse(first.out[0]!).promoted).toEqual([{ as: "postmortems-that-happen", candidate: "c-002" }]);
    const before = await registerOf({ seat });
    expect(before.workstreams.map((one) => one.id)).toContain("postmortems-that-happen");
    const again = await run({ seat, rest: ["2 yes", "--home", home, "--json"], verb: "react" });
    expect(JSON.parse(again.out[0]!).alreadyHeld).toEqual([{ as: "postmortems-that-happen", candidate: "c-002" }]);
    // The retried yes writes nothing: every workstream, its revision and its entry ids are as the first yes left them.
    const after = await registerOf({ seat });
    expect(after).toEqual(before);
    const promoted = after.workstreams.find((one) => one.id === "postmortems-that-happen")!;
    expect(new Set(promoted.entries.map((one) => one.id)).size).toBe(promoted.entries.length);
    expect(promoted.milestones.at(-1)!.id).toBe(DONE_MILESTONE_ID);
  });

  it("adds no tile when the owner's words cannot be recorded", async () => {
    const seat = await seeded();
    const { home } = seat;
    const before = await registerOf({ seat });
    writeFileSync(join(home, "workstreams", "reactions.jsonl"), "", { mode: 0o400 });
    const failed = await run({ seat, rest: ["--candidate", "c-002", "--as", "yes", "--home", home], verb: "react" });
    expect(failed.exit).toBe(EXIT_ERROR);
    expect(failed.diagnostics[0]).toContain("could not write");
    expect(await registerOf({ seat })).toEqual(before);
  });

  it("leaves a failed register write as a promotion owed, which one retried yes settles with one tile", async () => {
    const seat = await seeded();
    const { home } = seat;
    const failed = await run({
      rest: ["--candidate", "c-002", "--as", "yes", "--home", home],
      seat,
      store: failingStore({ fail: "write", store: seat.store }),
      verb: "react",
    });
    expect(failed.exit).toBe(EXIT_ERROR);
    expect(failed.diagnostics[0]).toContain("c-002 owe a promotion");
    const listed = JSON.parse((await run({ seat, rest: ["--home", home, "--json"], verb: "candidates" })).out[0]!);
    expect(listed.promotionOwed).toEqual(["c-002"]);
    const retried = await run({
      seat,
      rest: ["--candidate", "c-002", "--as", "yes", "--home", home, "--json"],
      verb: "react",
    });
    expect(JSON.parse(retried.out[0]!).promoted).toEqual([{ as: "postmortems-that-happen", candidate: "c-002" }]);
    expect((await registerIds({ seat })).filter((id) => id.startsWith("postmortems-that-happen"))).toEqual([
      "postmortems-that-happen",
    ]);
  });

  it("never gives one candidate's owed id to another candidate whose name makes the same id", async () => {
    const seat = await registered();
    const { home } = seat;
    // The register holds `merge-gate`, so c-002 "Merge gate" is owed `merge-gate-2` — the id c-003 "Merge gate 2" makes.
    const value = validCandidates();
    const names = value["candidates"] as { name: string }[];
    names[0]!.name = "Nothing merges red";
    names[1]!.name = "Merge gate";
    names[2]!.name = "Merge gate 2";
    expect((await putCandidates({ seat, value })).exit).toBe(EXIT_OK);
    const failing = failingStore({ fail: "write", store: seat.store });
    await run({ rest: ["--candidate", "c-002", "--as", "yes", "--home", home], seat, store: failing, verb: "react" });
    const other = await run({
      seat,
      rest: ["--candidate", "c-003", "--as", "yes", "--home", home, "--json"],
      verb: "react",
    });
    expect(JSON.parse(other.out[0]!).promoted).toEqual([{ as: "merge-gate-2-2", candidate: "c-003" }]);
    const owed = await run({
      seat,
      rest: ["--candidate", "c-002", "--as", "yes", "--home", home, "--json"],
      verb: "react",
    });
    expect(JSON.parse(owed.out[0]!).promoted).toEqual([{ as: "merge-gate-2", candidate: "c-002" }]);
  });

  it("promotes no second workstream for a yes, failed or repeated, said on top of the owner's same-as", async () => {
    const seat = await seeded();
    const { home } = seat;
    const said = await run({
      rest: ["--candidate", "c-002", "--as", "same-as", "--same-as", "merge-gate", "--home", home],
      seat,
      verb: "react",
    });
    expect(said.exit).toBe(EXIT_OK);
    const before = await registerIds({ seat });
    const yes = ["--candidate", "c-002", "--as", "yes", "--home", home, "--json"];
    await run({ rest: yes, seat, store: failingStore({ fail: "write", store: seat.store }), verb: "react" });
    const retried = await run({ rest: yes, seat, verb: "react" });
    expect(JSON.parse(retried.out[0]!).alreadyHeld).toEqual([{ as: "merge-gate", candidate: "c-002" }]);
    const again = await run({ rest: yes, seat, verb: "react" });
    expect(JSON.parse(again.out[0]!).promoted).toEqual([]);
    expect(await registerIds({ seat })).toEqual(before);
  });

  it("ends the same-as workstream when an abandon whose write failed is retried, adding none", async () => {
    const seat = await seeded();
    const { home } = seat;
    const said = ["--candidate", "c-002", "--as", "same-as", "--same-as", "merge-gate", "--home", home];
    expect((await run({ rest: said, seat, verb: "react" })).exit).toBe(EXIT_OK);
    const before = await registerIds({ seat });
    const dropped = ["2 cancelled", "--via", "word", "--reason", "we dropped it", "--anchor", "talk-call:x#turn_y"];
    const abandon = [...dropped, "--home", home];
    await run({ rest: abandon, seat, store: failingStore({ fail: "write", store: seat.store }), verb: "react" });
    const retried = await run({ rest: abandon, seat, verb: "react" });
    expect(retried.out).toEqual([
      "c-002  abandoned",
      "c-002 is abandoned on the register as merge-gate: we dropped it",
    ]);
    expect(await registerIds({ seat })).toEqual(before);
    expect((await storedOf({ seat, id: "merge-gate" })).detail["ending"]).toEqual({
      anchor: "talk-call:x#turn_y",
      kind: "abandoned",
      on: "2026-10-02",
      reason: "we dropped it",
    });
  });

  it("promotes nothing for a yes on a candidate already on the register", async () => {
    const seat = await seeded();
    const { home } = seat;
    const before = await registerOf({ seat });
    const pressed = await run({
      seat,
      rest: [
        "--candidate",
        "c-001",
        "--as",
        "yes",
        "--via",
        "console",
        "--by-session",
        "work-console",
        "--home",
        home,
        "--json",
      ],
      verb: "react",
    });
    expect(pressed.exit).toBe(EXIT_OK);
    expect(JSON.parse(pressed.out[0]!)).toEqual({
      alreadyHeld: [{ as: "merge-gate", candidate: "c-001" }],
      ended: [],
      placed: [],
      promoted: [],
      rows: [
        {
          anchor: null,
          bySession: "work-console",
          candidate: "c-001",
          coveredBy: null,
          heard: null,
          iso: "2026-10-02T13:30:00.000Z",
          milestoneOf: null,
          name: "Merge gate",
          outcomeOf: null,
          owner: null,
          promotedAs: null,
          reaction: "yes",
          reason: null,
          sameAs: null,
          steer: null,
          supersededBy: null,
          via: "console",
        },
      ],
    });
    expect(await registerOf({ seat })).toEqual(before);
  });

  it("ends the held entry on an abandoned word, saying so, and stores the ending on the register", async () => {
    const seat = await seeded();
    const { home } = seat;
    const recorded = await run({
      seat,
      rest: [
        "1 cancelled",
        "--via",
        "word",
        "--reason",
        "we dropped the tool",
        "--anchor",
        "talk-call:x#turn_y",
        "--home",
        home,
      ],
      verb: "react",
    });
    expect([recorded.exit, recorded.out]).toEqual([
      EXIT_OK,
      ["c-001  abandoned", "c-001 is abandoned on the register as merge-gate: we dropped the tool"],
    ]);
    expect((await storedOf({ seat, id: "merge-gate" })).detail["ending"]).toEqual({
      anchor: "talk-call:x#turn_y",
      kind: "abandoned",
      on: "2026-10-02",
      reason: "we dropped the tool",
    });
  });

  it("refuses an abandoned word without its reason or anchor, two at once, and a stray reason, recording nothing", async () => {
    const seat = await seeded();
    const { home } = seat;
    const tries = [
      ["1 abandoned", "--anchor", "talk-call:x#turn_y"],
      ["1 abandoned", "--reason", "dropped"],
      ["1 2 abandoned", "--reason", "dropped", "--anchor", "talk-call:x#turn_y"],
      ["1 yes", "--reason", "dropped"],
    ];
    const refused = await runEach({ seat, tries: tries.map((rest) => [...rest, "--home", home]), verb: "react" });
    expect(refused.map((one) => [one.exit, one.diagnostics[0]])).toEqual([
      [
        EXIT_USAGE,
        "workstreams react: an abandoned word needs --reason: why it ended, in the owner's words — nothing recorded",
      ],
      [EXIT_USAGE, "workstreams react: an abandoned word needs --anchor: where the owner said it — nothing recorded"],
      [
        EXIT_USAGE,
        "workstreams react: one abandoned candidate per call, so its reason is its own — got c-001, c-002 — nothing recorded",
      ],
      [
        EXIT_USAGE,
        "workstreams react: --reason goes with one abandoned, done, milestone-of, outcome-of, superseded or no word, so the reason is its own — nothing recorded",
      ],
    ]);
    expect(existsSync(join(home, "workstreams", "reactions.jsonl"))).toBe(false);
  });

  it("refuses a bad batch and records nothing", async () => {
    const seat = await seeded();
    const { home } = seat;
    const refused = await run({ seat, rest: ["2 yes 9 no", "--home", home], verb: "react" });
    expect(refused.exit).toBe(EXIT_ERROR);
    expect(refused.diagnostics[0]).toBe("workstreams react: nothing recorded — no candidate is numbered 9");
    expect(existsSync(join(home, "workstreams", "reactions.jsonl"))).toBe(false);
  });

  it("refuses a reaction outside the five and both spellings at once as usage errors", async () => {
    const seat = await seeded();
    const { home } = seat;
    expect(
      (await run({ seat, rest: ["--candidate", "c-001", "--as", "maybe", "--home", home], verb: "react" })).exit,
    ).toBe(EXIT_USAGE);
    expect(
      (await run({ seat, rest: ["1 yes", "--candidate", "c-001", "--as", "yes", "--home", home], verb: "react" })).exit,
    ).toBe(EXIT_USAGE);
  });

  it("keeps the owner's words as heard on the row: --heard when given, else their words by number", async () => {
    const seat = await seeded();
    const { home } = seat;
    await run({
      seat,
      rest: ["--candidate", "c-001", "--as", "no", "--heard", "not a workstream, it's a bug fix", "--home", home],
      verb: "react",
    });
    await run({ seat, rest: ["2 sort of", "--home", home], verb: "react" });
    const rows = readFileSync(join(home, "workstreams", "reactions.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { candidate: string; heard: string | null });
    expect(rows.map((row) => [row.candidate, row.heard])).toEqual([
      ["c-001", "not a workstream, it's a bug fix"],
      ["c-002", "2 sort of"],
    ]);
  });

  it("refuses an empty --heard and records nothing", async () => {
    const seat = await seeded();
    const { home } = seat;
    const refused = await run({
      seat,
      rest: ["--candidate", "c-001", "--as", "no", "--heard", " ", "--home", home],
      verb: "react",
    });
    expect([refused.exit, refused.diagnostics[0]]).toEqual([
      EXIT_USAGE,
      "workstreams react: --heard carries the owner's words, and it was empty",
    ]);
    expect(existsSync(join(home, "workstreams", "reactions.jsonl"))).toBe(false);
  });

  it("starts the register with the first yes on a fresh install", async () => {
    const seat = await fresh();
    const { home } = seat;
    const accepted = await run({ seat, rest: ["3 yes", "--home", home], verb: "react" });
    expect([accepted.exit, accepted.out]).toEqual([
      EXIT_OK,
      ["c-003  yes", "c-003 is now on the register as cloudflare-waf-rollout (discovery; the seat owes its story)"],
    ]);
    expect(await registerIds({ seat })).toEqual(["cloudflare-waf-rollout"]);
    const started = await storedOf({ seat, id: "cloudflare-waf-rollout" });
    expect(started.milestones.map((one) => [one.id, one.name])).toEqual([[DONE_MILESTONE_ID, started.outcome]]);
  });
});
