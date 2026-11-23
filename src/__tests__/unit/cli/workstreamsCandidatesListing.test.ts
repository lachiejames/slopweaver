import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { VERB_OUTPUT_MAX_BYTES } from "../../../talk/verbOutput.js";
import { LISTING_MAX_BYTES } from "../../../workstreams/candidateRulings.js";
import { SYNTHETIC_STATED, writeStatedCandidatesFile } from "../../statedCandidatesFixture.js";
import { validCandidates } from "../workstreams/candidatesFixture.js";
import { failingStore } from "../workstreams/storeRegisterFixture.js";
import {
  cleanupScratch,
  empty,
  fresh,
  listedCandidate,
  NOW,
  putCandidates,
  registered,
  registerOf,
  run,
  seeded,
} from "./workstreamsCandidatesVerbsHarness.js";

afterEach(cleanupScratch);

describe("workstreams define", () => {
  it("records a picked option before the yes, and the yes carries it onto the new tile", async () => {
    const seat = await fresh();
    const { home } = seat;
    const defined = await run({
      seat,
      rest: ["--candidate", "c-002", "--option", "owned-and-read", "--via", "console", "--home", home],
      verb: "define",
    });
    expect([defined.exit, defined.out]).toEqual([
      EXIT_OK,
      [
        'c-002  done means "Each postmortem has a named owner and the on-call lead has read it" (recorded)',
        "c-002 is not an accepted workstream yet; its yes will carry this onto the tile",
      ],
    ]);
    await run({
      seat,
      rest: ["--candidate", "c-002", "--as", "yes", "--via", "console", "--home", home],
      verb: "react",
    });
    const register = await registerOf({ seat });
    const done = "Each postmortem has a named owner and the on-call lead has read it";
    expect(register.workstreams.map((one) => [one.id, one.milestones.map((milestone) => milestone.name)])).toEqual([
      ["postmortems-that-happen", [done]],
    ]);
  });

  it("refuses an option the candidate does not offer, and both spellings at once, as usage errors", async () => {
    const seat = await fresh();
    const { home } = seat;
    const unknown = await run({
      seat,
      rest: ["--candidate", "c-002", "--option", "nope", "--home", home],
      verb: "define",
    });
    const both = await run({
      seat,
      rest: ["--candidate", "c-002", "--option", "owned-and-read", "--text", "mine", "--home", home],
      verb: "define",
    });
    expect([unknown.exit, both.exit]).toEqual([EXIT_USAGE, EXIT_USAGE]);
    expect(unknown.diagnostics[0]).toBe(
      "workstreams define: no definition recorded — c-002 offers no option nope; it offers written-within-a-week, owned-and-read",
    );
    expect(existsSync(join(home, "workstreams", "definitions.jsonl"))).toBe(false);
  });
});

describe("workstreams candidates-put", () => {
  it("refuses a re-mine that hands an answered id to a different workstream, and keeps the old set", async () => {
    const seat = await seeded();
    const { home } = seat;
    await run({ seat, rest: ["2 yes", "--home", home], verb: "react" });
    const value = validCandidates();
    const candidates = value["candidates"] as { name: string }[];
    [candidates[1]!.name, candidates[2]!.name] = [candidates[2]!.name, candidates[1]!.name];
    const remined = join(home, "remined.json");
    writeFileSync(remined, JSON.stringify(value));
    const refused = await run({ seat, rest: ["--file", remined, "--home", home], verb: "candidates-put" });
    expect(refused.exit).toBe(EXIT_ERROR);
    expect(refused.diagnostics[0]).toContain(
      `c-002 was answered as "Postmortems that happen" but this set names it "Cloudflare WAF rollout"`,
    );
    expect((await listedCandidate({ seat, id: "c-002" }))["name"]).toBe("Postmortems that happen");
  });

  // An id the file took but the console's relay refused could never carry a spoken
  // ruling, so the file holds ids to the relay's bound.
  it("refuses a candidate id longer than the 80 characters a spoken ruling can carry", async () => {
    const seat = await registered();
    const value = validCandidates();
    (value["candidates"] as { id: string }[])[0]!.id = `c-${"a".repeat(79)}`;
    const refused = await putCandidates({ seat, value });
    expect(refused.exit).toBe(EXIT_ERROR);
    expect(refused.diagnostics.join("\n")).toContain("a candidate id is at most 80 characters");
  });
});

describe("workstreams candidates", () => {
  it("prints the joined document, with what the seat owes", async () => {
    const seat = await seeded();
    const { home } = seat;
    writeStatedCandidatesFile({ home });
    await run({ seat, rest: ["3 yes 1 no", "--home", home], verb: "react" });
    const listed = await run({ seat, rest: ["--home", home, "--json"], verb: "candidates" });
    expect(listed.exit).toBe(EXIT_OK);
    const document = JSON.parse(listed.out[0]!);
    expect(document.counts).toEqual({
      abandoned: 0,
      done: 0,
      "lets-talk": 0,
      "milestone-of": 0,
      no: 1,
      "not-sure": 0,
      "outcome-of": 0,
      "same-as": 0,
      "sort-of": 0,
      superseded: 0,
      unanswered: 1 + SYNTHETIC_STATED.length,
      yes: 1,
    });
    expect(document.storyOwed).toEqual(["cloudflare-waf-rollout"]);
    expect(document.promotionOwed).toEqual([]);
  });

  it("reads a fresh install with no register, carrying each picked definition and owed conversation", async () => {
    const seat = await fresh();
    const { home } = seat;
    writeStatedCandidatesFile({ home });
    await run({
      seat,
      rest: ["--candidate", "c-002", "--text", "someone owns each one", "--home", home],
      verb: "define",
    });
    const listed = await run({ seat, rest: ["--home", home, "--json"], verb: "candidates" });
    expect(listed.exit).toBe(EXIT_OK);
    const document = JSON.parse(listed.out[0]!);
    expect([document.registerExists, document.counts.unanswered]).toEqual([false, 3 + SYNTHETIC_STATED.length]);
    const second = document.candidates.find((one: { id: string }) => one.id === "c-002");
    expect(second.definition.selection).toEqual({ kind: "words", stretch: null, text: "someone owns each one" });
    expect(second.loopIn.map((one: { draftState: string }) => one.draftState)).toEqual(["none"]);
    expect(document.candidates.find((one: { id: string }) => one.id === "c-001").definition).toBe(null);
  });

  it("names a tile still owing its definition after a register write failed, which the same define repairs", async () => {
    const seat = await seeded();
    const { home } = seat;
    await run({ seat, rest: ["2 yes", "--home", home], verb: "react" });
    const failed = await run({
      rest: ["--candidate", "c-002", "--text", "owned", "--home", home],
      seat,
      store: failingStore({ fail: "write", store: seat.store }),
      verb: "define",
    });
    expect([failed.exit, failed.diagnostics[0]!.includes("re-run the same")]).toEqual([EXIT_ERROR, true]);
    const owed = JSON.parse((await run({ seat, rest: ["--home", home, "--json"], verb: "candidates" })).out[0]!);
    expect(owed.definitionOwed).toEqual(["c-002"]);
    const repaired = await run({
      seat,
      rest: ["--candidate", "c-002", "--text", "owned", "--home", home],
      verb: "define",
    });
    expect(repaired.out[0]).toBe('c-002  done means "owned" (already stood)');
    const after = JSON.parse((await run({ seat, rest: ["--home", home, "--json"], verb: "candidates" })).out[0]!);
    expect(after.definitionOwed).toEqual([]);
  });

  // The owner's bug report, from a call: the voice offered candidates they had already ruled on. The list it
  // walks must never carry one.
  it("never lists a ruled candidate under --unruled, whatever the owner's word was", async () => {
    const seat = await seeded();
    const { home } = seat;
    writeStatedCandidatesFile({ home });
    await run({
      seat,
      rest: ["--candidate", "c-001", "--as", "no", "--heard", "not a workstream", "--home", home],
      verb: "react",
    });
    await run({ seat, rest: ["--candidate", "c-003", "--as", "not-sure", "--home", home], verb: "react" });
    const listed = await run({ seat, rest: ["--unruled", "--home", home, "--json"], verb: "candidates" });
    expect(listed.exit).toBe(EXIT_OK);
    const document = JSON.parse(listed.out[0]!) as { candidates: { id: string }[]; counts: { unanswered: number } };
    expect(document.candidates.map((one) => one.id)).toEqual([...SYNTHETIC_STATED.map((one) => one.id), "c-002"]);
    expect(document.counts.unanswered).toBe(1 + SYNTHETIC_STATED.length);
    const text = await run({ seat, rest: ["--unruled", "--home", home], verb: "candidates" });
    expect(text.out.filter((line) => line.includes("unanswered  "))).toHaveLength(1 + SYNTHETIC_STATED.length);
    expect(text.out.join("\n")).not.toContain("c-001");
  });

  it("names each ruling under --ruled: their word, the day and what they said", async () => {
    const seat = await seeded();
    const { home } = seat;
    writeStatedCandidatesFile({ home });
    await run({
      seat,
      rest: ["--candidate", "c-001", "--as", "no", "--heard", "not a workstream", "--home", home],
      verb: "react",
    });
    await run({ seat, rest: ["--candidate", "c-003", "--as", "not-sure", "--home", home], verb: "react" });
    const listed = await run({ seat, rest: ["--ruled", "--home", home], verb: "candidates" });
    expect(listed.exit).toBe(EXIT_OK);
    expect(listed.out.slice(0, 2)).toEqual([
      '  1  c-001  no          Merge gate  — ruled 2026-10-02: "not a workstream"  on the register as merge-gate',
      "  3  c-003  not-sure    Cloudflare WAF rollout  — ruled 2026-10-02, the owner's words not recorded",
    ]);
    expect(listed.out[2]).toBe(
      "15 candidates: 0 yes, 1 no, 0 sort-of, 1 not-sure, 0 lets-talk, 0 done, 0 same-as, 0 milestone-of, 0 outcome-of, 0 superseded, 0 abandoned, 13 unanswered",
    );
  });

  // A long name sat ahead of the ruling, so the line's cut took the ruling.
  it("names the ruling whole however long the candidate's id and name", async () => {
    const seat = await registered();
    const { home } = seat;
    const value = validCandidates();
    const third = (value["candidates"] as { id: string; name: string }[])[2]!;
    const id = `c-${"a".repeat(78)}`;
    third.id = id;
    third.name = "y".repeat(2000);
    expect((await putCandidates({ seat, value })).exit).toBe(EXIT_OK);
    const heard = "z".repeat(99);
    await run({ seat, rest: ["--candidate", id, "--as", "no", "--heard", heard, "--home", home], verb: "react" });
    const listed = await run({ seat, rest: ["--ruled", "--home", home], verb: "candidates" });
    expect(listed.out[0]).toBe(`  3  ${id}  no          ${"y".repeat(79)}…  — ruled 2026-10-02: "${heard}"`);
  });

  // `\s` leaves out U+0085 NEXT LINE.
  it("collapses every whitespace run in the owner's words to one space, U+0085 included", async () => {
    const seat = await seeded();
    const { home } = seat;
    await run({
      seat,
      rest: ["--candidate", "c-003", "--as", "no", "--heard", "alpha\u0085\u0085beta", "--home", home],
      verb: "react",
    });
    const listed = await run({ seat, rest: ["--ruled", "--home", home], verb: "candidates" });
    expect(listed.out[0]).toBe('  3  c-003  no          Cloudflare WAF rollout  — ruled 2026-10-02: "alpha beta"');
  });

  // The cut counted UTF-16 units, so an emoji at the boundary became U+FFFD.
  it("counts the owner's words in characters, so an emoji at the cut is kept whole", async () => {
    const seat = await seeded();
    const { home } = seat;
    const heard = `${"a".repeat(98)}😀b`;
    await run({ seat, rest: ["--candidate", "c-003", "--as", "no", "--heard", heard, "--home", home], verb: "react" });
    const listed = await run({ seat, rest: ["--ruled", "--home", home], verb: "candidates" });
    expect(listed.out[0]).toBe(`  3  c-003  no          Cloudflare WAF rollout  — ruled 2026-10-02: "${heard}"`);
    const long = `${"a".repeat(98)}😀bc`;
    await run({ seat, rest: ["--candidate", "c-003", "--as", "no", "--heard", long, "--home", home], verb: "react" });
    const cut = await run({ seat, rest: ["--ruled", "--home", home], verb: "candidates" });
    expect(cut.out[0]).toBe(
      `  3  c-003  no          Cloudflare WAF rollout  — ruled 2026-10-02: "${"a".repeat(98)}😀…"`,
    );
  });

  // A newline in a name split the candidate from its ruling across two lines.
  it("keeps a candidate and its ruling on one line when the name carries a newline", async () => {
    const seat = await registered();
    const { home } = seat;
    const value = validCandidates();
    (value["candidates"] as { name: string }[])[2]!.name = "Alpha\nBeta";
    expect((await putCandidates({ seat, value })).exit).toBe(EXIT_OK);
    await run({
      seat,
      rest: ["--candidate", "c-003", "--as", "no", "--heard", "not mine", "--home", home],
      verb: "react",
    });
    const listed = await run({ seat, rest: ["--ruled", "--home", home], verb: "candidates" });
    expect(listed.out[0]).toBe('  3  c-003  no          Alpha Beta  — ruled 2026-10-02: "not mine"');
  });

  it("lists the newest ruling first under --ruled, so a listing cut to its budget leaves out the oldest", async () => {
    const seat = await seeded();
    const { home } = seat;
    await run({ seat, rest: ["--candidate", "c-001", "--as", "no", "--home", home], verb: "react" });
    await run({ seat, rest: ["--candidate", "c-003", "--as", "yes", "--home", home], verb: "react" });
    const ledger = join(home, "workstreams", "reactions.jsonl");
    const [first, second] = readFileSync(ledger, "utf8").trim().split("\n");
    writeFileSync(ledger, `${first!.replace(NOW, "2026-09-30T09:00:00.000Z")}\n${second!}\n`);
    const listed = await run({ seat, rest: ["--ruled", "--home", home], verb: "candidates" });
    expect(listed.out.slice(0, 2).map((line) => line.slice(5, 10))).toEqual(["c-003", "c-001"]);
  });

  it("orders rulings by their instant, not their spelling, when the stamps differ in fractional precision", async () => {
    const seat = await seeded();
    const { home } = seat;
    await run({ seat, rest: ["--candidate", "c-001", "--as", "no", "--home", home], verb: "react" });
    await run({ seat, rest: ["--candidate", "c-003", "--as", "yes", "--home", home], verb: "react" });
    const ledger = join(home, "workstreams", "reactions.jsonl");
    const [first, second] = readFileSync(ledger, "utf8").trim().split("\n");
    const older = second!.replace(NOW, "2026-10-02T13:30:00Z");
    writeFileSync(ledger, `${first!.replace(NOW, "2026-10-02T13:30:00.500Z")}\n${older}\n`);
    const listed = await run({ seat, rest: ["--ruled", "--home", home], verb: "candidates" });
    expect(listed.out.slice(0, 2).map((line) => line.slice(5, 10))).toEqual(["c-001", "c-003"]);
  });

  // Neither id nor name has a length bound, so 110 long ones overran the 20 KiB the
  // voice reads a verb answer in. The listing is fitted to its budget and says what it left out.
  it("fits a listing of long ids and names to one voice read, and says how many it left out", async () => {
    const seat = await registered();
    const { home } = seat;
    writeStatedCandidatesFile({ home });
    const base = validCandidates();
    const template = (base["candidates"] as Record<string, unknown>[])[2]!;
    const candidates = Array.from({ length: 110 }, (_, index) => {
      const n = String(index + 1).padStart(3, "0");
      return {
        ...template,
        evidence: [{ anchor: null, date: "2026-06-01", href: `https://example.test/m/${n}`, quote: "q" }],
        id: `c-${n}-${"a".repeat(74)}`,
        n: index + 1,
        name: `Candidate ${n} ${"x".repeat(106)}`,
      };
    });
    expect((await putCandidates({ seat, value: { ...base, candidates } })).exit).toBe(EXIT_OK);
    const listed = await run({ seat, rest: ["--unruled", "--home", home], verb: "candidates" });
    const bytes = Buffer.byteLength(listed.out.join("\n"), "utf8");
    expect(bytes).toBeLessThanOrEqual(LISTING_MAX_BYTES + 512);
    expect(LISTING_MAX_BYTES + 512).toBeLessThan(VERB_OUTPUT_MAX_BYTES);
    const shown = listed.out.filter((line) => line.includes("unanswered  ")).length;
    expect(listed.out).toContain(
      `… ${String(110 + SYNTHETIC_STATED.length - shown)} more unruled not shown: each one the owner rules on leaves this list`,
    );
    expect(shown).toBeGreaterThan(0);
  });

  it("refuses --unruled with --ruled", async () => {
    const seat = await seeded();
    const { home } = seat;
    const refused = await run({ seat, rest: ["--unruled", "--ruled", "--home", home], verb: "candidates" });
    expect([refused.exit, refused.diagnostics[0]]).toEqual([
      EXIT_USAGE,
      "workstreams candidates: --unruled and --ruled each keep one half — give one",
    ]);
  });

  it("lists the owner's stated outcomes on a fresh home, before any candidates are mined, rather than exiting empty", async () => {
    const seat = empty();
    writeStatedCandidatesFile({ home: seat.home });
    const listed = await run({ seat, rest: ["--home", seat.home, "--json"], verb: "candidates" });
    expect(listed.exit).toBe(EXIT_OK);
    const document = JSON.parse(listed.out[0]!) as { candidates: { id: string }[]; counts: { unanswered: number } };
    expect(document.candidates.map((one) => one.id)).toEqual(SYNTHETIC_STATED.map((one) => one.id));
    expect(document.counts.unanswered).toBe(SYNTHETIC_STATED.length);
  });
});
