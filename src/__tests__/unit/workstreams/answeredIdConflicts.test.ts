import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { answeredIdConflicts, parseCandidatesFile, type ReactionRow } from "../../../workstreams/candidates.js";
import { validCandidates } from "./candidatesFixture.js";
import { row } from "./candidatesHarness.js";

const KEEP = "carry an answered candidate forward under its id and name, and give a new one a fresh id and name";

/** No candidate has had a former title. */
const NO_FORMER: ReadonlyMap<string, string> = new Map();

describe("answeredIdConflicts", () => {
  it("passes a re-mine that keeps every answered id and name, whatever else it changes", () => {
    const value = validCandidates();
    (value["candidates"] as { outcome: string }[])[1]!.outcome = "a sharper outcome";
    const remined = unwrap(parseCandidatesFile({ value }));
    expect(
      answeredIdConflicts({
        file: remined,
        formerNames: NO_FORMER,
        rows: [row({ candidate: "c-002", reaction: "yes" })],
      }),
    ).toEqual([]);
  });

  it("names an answered id the re-mine gives a different workstream", () => {
    const value = validCandidates();
    (value["candidates"] as { name: string }[])[1]!.name = "Something else";
    const remined = unwrap(parseCandidatesFile({ value }));
    expect(
      answeredIdConflicts({
        file: remined,
        formerNames: NO_FORMER,
        rows: [row({ candidate: "c-002", reaction: "no" })],
      }),
    ).toEqual([`c-002 was answered as "Postmortems that happen" but this set names it "Something else" — ${KEEP}`]);
  });

  it("accepts a row answered under a candidate's former title for that id, and for no other id", () => {
    const value = validCandidates();
    (value["candidates"] as { name: string }[])[1]!.name = "Postmortems as they happen";
    const remined = unwrap(parseCandidatesFile({ value }));
    const rows = [row({ candidate: "c-002", reaction: "yes" })];
    expect(
      answeredIdConflicts({ file: remined, formerNames: new Map([["c-002", "Postmortems that happen"]]), rows }),
    ).toEqual([]);
    expect(
      answeredIdConflicts({ file: remined, formerNames: new Map([["c-003", "Postmortems that happen"]]), rows }),
    ).toEqual([
      `c-002 was answered as "Postmortems that happen" but this set names it "Postmortems as they happen" — ${KEEP}`,
    ]);
  });

  it("accepts a former title only as the answered name exactly, trimmed, never as a pattern or case-folded", () => {
    const value = validCandidates();
    (value["candidates"] as { name: string }[])[1]!.name = "Postmortems as they happen";
    const remined = unwrap(parseCandidatesFile({ value }));
    const rows = [row({ candidate: "c-002", reaction: "yes" })];
    const renamed = `c-002 was answered as "Postmortems that happen" but this set names it "Postmortems as they happen" — ${KEEP}`;

    expect(
      answeredIdConflicts({ file: remined, formerNames: new Map([["c-002", "postmortems that happen"]]), rows }),
    ).toEqual([renamed]);
    expect(answeredIdConflicts({ file: remined, formerNames: new Map([["c-002", "^Postmortems.*$"]]), rows })).toEqual([
      renamed,
    ]);
    expect(
      answeredIdConflicts({ file: remined, formerNames: new Map([["c-002", "  Postmortems that happen "]]), rows }),
    ).toEqual([]);
  });

  it("tells two names apart by every letter in any script, so one cannot take the other's answered id", () => {
    const value = validCandidates();
    (value["candidates"] as { name: string }[])[1]!.name = "Q4 移行";
    const answered = unwrap(parseCandidatesFile({ value }));
    const rows: ReactionRow[] = [
      { ...row({ candidate: "c-002", reaction: "yes" }), name: answered.candidates[1]!.name },
    ];
    (value["candidates"] as { name: string }[])[1]!.name = "Q4 監視";
    const remined = unwrap(parseCandidatesFile({ value }));
    expect(answeredIdConflicts({ file: remined, formerNames: NO_FORMER, rows })).toEqual([
      `c-002 was answered as "Q4 移行" but this set names it "Q4 監視" — ${KEEP}`,
    ]);
  });

  it("judges a rename on the exact name, so a changed vowel mark or case is still a rename", () => {
    const value = validCandidates();
    (value["candidates"] as { name: string }[])[1]!.name = "Q4 दिन";
    const answered = unwrap(parseCandidatesFile({ value }));
    const rows: ReactionRow[] = [
      { ...row({ candidate: "c-002", reaction: "yes" }), name: answered.candidates[1]!.name },
    ];
    (value["candidates"] as { name: string }[])[1]!.name = "Q4 दीन";
    expect(answeredIdConflicts({ file: unwrap(parseCandidatesFile({ value })), formerNames: NO_FORMER, rows })).toEqual(
      [`c-002 was answered as "Q4 दिन" but this set names it "Q4 दीन" — ${KEEP}`],
    );
    (value["candidates"] as { name: string }[])[1]!.name = "q4 दिन";
    expect(answeredIdConflicts({ file: unwrap(parseCandidatesFile({ value })), formerNames: NO_FORMER, rows })).toEqual(
      [`c-002 was answered as "Q4 दिन" but this set names it "q4 दिन" — ${KEEP}`],
    );
  });

  it("names an answered workstream the re-mine renumbers: its old id dropped, its name reissued", () => {
    const value = validCandidates();
    (value["candidates"] as { id: string }[])[1]!.id = "c-010";
    const remined = unwrap(parseCandidatesFile({ value }));
    expect(
      answeredIdConflicts({
        file: remined,
        formerNames: NO_FORMER,
        rows: [row({ candidate: "c-002", reaction: "yes" })],
      }),
    ).toEqual([
      `c-002 "Postmortems that happen" is answered but this set drops it — ${KEEP}`,
      `c-010 reissues "Postmortems that happen", answered as c-002 — ${KEEP}`,
    ]);
  });
});
