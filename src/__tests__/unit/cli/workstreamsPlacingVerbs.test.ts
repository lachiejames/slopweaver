import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { unwrap } from "#lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { candidateCatalog } from "../../../workstreams/candidateCatalog.js";
import { parseCandidatesFile } from "../../../workstreams/candidates.js";
import { placementNote } from "../../../workstreams/placement.js";
import { DONE_MILESTONE_ID } from "../../../workstreams/store/doneMilestoneId.js";
import { retitleNote } from "../../../workstreams/titleStore.js";
import { validCandidates } from "../workstreams/candidatesFixture.js";
import {
  cleanupScratch,
  empty,
  lastEntryText,
  listedCandidate,
  NOW,
  registerOf,
  run,
  runEach,
  seeded,
  storedOf,
} from "./workstreamsCandidatesVerbsHarness.js";

afterEach(cleanupScratch);

const catalog = unwrap(
  candidateCatalog({ mined: unwrap(parseCandidatesFile({ value: validCandidates() })), stated: [] }),
);
const postmortems = catalog.candidates.find((one) => one.id === "c-002")!;
const wafRollout = catalog.candidates.find((one) => one.id === "c-003")!;

describe("workstreams react, placing words", () => {
  it("files a milestone-of inside the workstream it names, with its note and an own milestone", async () => {
    const seat = await seeded();
    const { home } = seat;
    const rest = ["--candidate", "c-002", "--as", "milestone-of", "--milestone-of", "logs-scrub"];
    const filed = await run({ seat, rest: [...rest, "--reason", "a blocker midway", "--home", home], verb: "react" });
    expect(filed.exit).toBe(EXIT_OK);
    const stored = await storedOf({ seat, id: "logs-scrub" });
    expect(lastEntryText({ stored })).toBe(
      placementNote({ candidate: postmortems, reason: "a blocker midway", word: "milestone-of" }),
    );
    // Its own milestone sits before the workstream's done, which stays last.
    expect(stored.milestones.map((one) => [one.anchor, one.name])).toEqual([
      ["mined candidate c-002", "Postmortems that happen"],
      ["transcript:a#done", "No sensitive data in logs"],
    ]);
    expect(stored.milestones.at(-1)!.id).toBe(DONE_MILESTONE_ID);
  });

  it("files an outcome-of as a note only, never a milestone, and keeps a superseded word with what replaced it", async () => {
    const seat = await seeded();
    const { home } = seat;
    const outcome = ["--candidate", "c-003", "--as", "outcome-of", "--outcome-of", "logs-scrub", "--home", home];
    expect((await run({ seat, rest: outcome, verb: "react" })).exit).toBe(EXIT_OK);
    const stored = await storedOf({ seat, id: "logs-scrub" });
    expect([lastEntryText({ stored }), stored.milestones.map((one) => one.id)]).toEqual([
      placementNote({ candidate: wafRollout, reason: null, word: "outcome-of" }),
      [DONE_MILESTONE_ID],
    ]);
    const superseded = ["--candidate", "c-002", "--as", "superseded", "--superseded-by", "the team ABC"];
    expect((await run({ seat, rest: [...superseded, "--home", home], verb: "react" })).exit).toBe(EXIT_OK);
    const listed = JSON.parse((await run({ seat, rest: ["--home", home, "--json"], verb: "candidates" })).out[0]!);
    const c002 = await listedCandidate({ seat, id: "c-002" });
    expect([c002["reaction"], c002["supersededBy"], listed.placementOwed]).toEqual(["superseded", "the team ABC", []]);
  });

  it("keeps a no's owner and the workstream covering it as a side effect", async () => {
    const seat = await seeded();
    const { home } = seat;
    const rest = ["--candidate", "c-002", "--as", "no", "--owner", "Sadie's team", "--covered-by", "merge-gate"];
    expect((await run({ seat, rest: [...rest, "--home", home], verb: "react" })).exit).toBe(EXIT_OK);
    const c002 = await listedCandidate({ seat, id: "c-002" });
    expect([c002["owner"], c002["coveredBy"]]).toEqual(["Sadie's team", "merge-gate"]);
    expect(lastEntryText({ stored: await storedOf({ seat, id: "merge-gate" }) })).toBe(
      placementNote({ candidate: postmortems, reason: null, word: "covered-by" }),
    );
  });

  it("refuses a placing word that names nothing, a flag on the wrong word, and an entry with no timeline", async () => {
    const seat = await seeded();
    const { home } = seat;
    const tries = [
      ["--candidate", "c-002", "--as", "superseded"],
      ["--candidate", "c-002", "--as", "yes", "--owner", "Sadie"],
      ["--candidate", "c-002", "--as", "milestone-of", "--milestone-of", "the-tool"],
    ];
    const refused = await runEach({ seat, tries: tries.map((rest) => [...rest, "--home", home]), verb: "react" });
    expect(refused.map((one) => [one.exit, one.diagnostics[0]])).toEqual([
      [
        EXIT_USAGE,
        `workstreams react: a superseded word needs --superseded-by "<the owner's words>": what replaced it — nothing recorded`,
      ],
      [EXIT_USAGE, "workstreams react: --owner goes with one no word, so what it names is its own — nothing recorded"],
      [
        EXIT_ERROR,
        "workstreams react: nothing recorded — the-tool is a local entry, which has no timeline to file c-002 on",
      ],
    ]);
    expect(existsSync(join(home, "workstreams", "reactions.jsonl"))).toBe(false);
  });
});

describe("workstreams retitle, propose and who-first", () => {
  it("keeps the owner's title beside the mined name, and renames the entry their yes already made", async () => {
    const seat = await seeded();
    const { home } = seat;
    await run({ seat, rest: ["--candidate", "c-002", "--as", "yes", "--home", home], verb: "react" });
    const title = "Every incident is written up";
    const retitled = await run({
      seat,
      rest: ["--candidate", "c-002", "--title", title, "--home", home],
      verb: "retitle",
    });
    expect(retitled.out).toEqual([
      'c-002  titled "Every incident is written up" (mined as "Postmortems that happen"; recorded)',
      "c-002's register entry postmortems-that-happen carries the title",
    ]);
    const stored = await storedOf({ seat, id: "postmortems-that-happen" });
    expect([stored.name, lastEntryText({ stored })]).toEqual([
      title,
      retitleNote({ minedName: "Postmortems that happen" }),
    ]);
    // The same title said again writes nothing: the entry's revision and entry ids stand as the first one left them.
    const before = await registerOf({ seat });
    const again = await run({
      seat,
      rest: ["--candidate", "c-002", "--title", title, "--home", home],
      verb: "retitle",
    });
    expect(again.exit).toBe(EXIT_OK);
    expect(await registerOf({ seat })).toEqual(before);
    expect(new Set(stored.entries.map((one) => one.id)).size).toBe(stored.entries.length);
    const c002 = await listedCandidate({ seat, id: "c-002" });
    expect([c002["name"], c002["title"]]).toEqual(["Postmortems that happen", title]);
  });

  it("refuses a row its own ledger's reader would refuse, a blank session, and writes no ledger at all", async () => {
    const seat = await seeded();
    const { home } = seat;
    const blank = ["--by-session", "   ", "--via", "word", "--home", home];
    const retitled = await run({
      seat,
      rest: ["--candidate", "c-001", "--title", "New title", ...blank],
      verb: "retitle",
    });
    const defined = await run({
      seat,
      rest: ["--candidate", "c-001", "--text", "their words", ...blank],
      verb: "define",
    });
    const short = "bySession: Too small: expected string to have >=1 characters";
    expect([retitled.exit, retitled.diagnostics, defined.exit, defined.diagnostics]).toEqual([
      EXIT_USAGE,
      [`workstreams retitle: nothing recorded — ${short}`],
      EXIT_USAGE,
      [`workstreams define: no definition recorded — ${short}`],
    ]);
    const ledgers = ["titles.jsonl", "definitions.jsonl"].map((name) => existsSync(join(home, "workstreams", name)));
    expect(ledgers).toEqual([false, false]);
  });

  it("records a proposal outright with no candidates mined, and one beside a candidate, owed to the next mine", async () => {
    const outright = empty();
    const said = ["--title", "Human PR review friction", "--why", "are code owners set up sensibly"];
    const first = await run({
      seat: outright,
      rest: [...said, "--via", "word", "--anchor", "talk:fcc6cb0d-40a4", "--home", outright.home],
      verb: "propose",
    });
    expect([first.exit, first.out]).toEqual([
      EXIT_OK,
      ['p-001  "Human PR review friction" proposed outright; the next mine owes it a candidate'],
    ]);
    const seat = await seeded();
    const { home } = seat;
    const beside = ["--title", "DB load testing", "--from", "c-003", "--relation", "sibling", "--home", home];
    expect((await run({ seat, rest: beside, verb: "propose" })).exit).toBe(EXIT_OK);
    const listed = JSON.parse((await run({ seat, rest: ["--home", home, "--json"], verb: "candidates" })).out[0]!);
    expect(listed.proposalOwed).toEqual(["p-001"]);
    expect([listed.proposals[0].relation, listed.proposals[0].from, listed.proposals[0].minedAs]).toEqual([
      "sibling",
      "c-003",
      null,
    ]);
  });

  it("refuses --from without --relation, and a relation outside split, instead and sibling", async () => {
    const seat = await seeded();
    const { home } = seat;
    const halves = await run({ seat, rest: ["--title", "x", "--from", "c-001", "--home", home], verb: "propose" });
    const unknown = await run({
      seat,
      rest: ["--title", "x", "--from", "c-001", "--relation", "own", "--home", home],
      verb: "propose",
    });
    expect([halves.exit, halves.diagnostics[0], unknown.diagnostics[0]]).toEqual([
      EXIT_USAGE,
      "workstreams propose: --from <candidate id> and --relation split|instead|sibling go together; give neither for one outright",
      "workstreams propose: --relation is one of split, instead, sibling, not own",
    ]);
  });

  it("keeps who first as people apart from the owning team, and appends nothing on a repeat", async () => {
    const seat = await seeded();
    const { home } = seat;
    const rest = ["--candidate", "c-003", "--people", "Jasper and Quinn", "--team", "platform team", "--home", home];
    const said = await run({ seat, rest, verb: "who-first" });
    const again = await run({ seat, rest, verb: "who-first" });
    expect([said.out, again.out]).toEqual([
      ["c-003  first: Jasper, Quinn; owning team: platform team (recorded)"],
      ["c-003  first: Jasper, Quinn; owning team: platform team (already stood)"],
    ]);
    const c003 = await listedCandidate({ seat, id: "c-003" });
    expect(c003["whoFirst"]).toEqual({ iso: NOW, people: ["Jasper", "Quinn"], team: "platform team" });
  });
});
