/**
 * The stated candidates read from the state home's `workstreams/stated-candidates.json`: absent is none stated, a file
 * that validates is its candidates and their exact former titles, and one that does not is a refusal naming the problem.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { readStatedCandidates } from "../../../workstreams/candidateStore.js";
import { answeredIdConflicts, type ReactionRow } from "../../../workstreams/candidates.js";
import {
  SYNTHETIC_FORMER,
  SYNTHETIC_STATED,
  statedCandidatesDocument,
  writeStatedCandidatesFile,
} from "../../statedCandidatesFixture.js";
import { row } from "./candidatesHarness.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A throwaway home — never the ambient one. */
function scratch(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-stated-"));
  homes.push(home);
  return home;
}

/** Where a home's stated-candidates file sits. */
function statedPath({ home }: { home: string }): string {
  return join(home, "workstreams", "stated-candidates.json");
}

describe("readStatedCandidates", () => {
  it("reads a home with no stated-candidates file as no outcome stated", () => {
    const stated = unwrap(readStatedCandidates({ home: scratch() }));
    expect([stated.candidates, [...stated.formerNames]]).toEqual([[], []]);
  });

  it("reads a valid file as its candidates in statement order and each exact former title by id", () => {
    const home = scratch();
    expect(writeStatedCandidatesFile({ home })).toBe(statedPath({ home }));
    const stated = unwrap(readStatedCandidates({ home }));
    expect(SYNTHETIC_STATED.length).toBe(12);
    expect(stated.candidates).toEqual(SYNTHETIC_STATED);
    expect([...stated.formerNames]).toEqual([[SYNTHETIC_FORMER.id, SYNTHETIC_FORMER.title]]);
  });

  it("refuses a file that is not JSON, naming its path", () => {
    const home = scratch();
    mkdirSync(dirname(statedPath({ home })), { recursive: true });
    writeFileSync(statedPath({ home }), "{ not json");
    const refused = unwrapErr(readStatedCandidates({ home }));
    expect(refused.code).toBe("CANDIDATES_UNREADABLE");
    expect(refused.message).toContain(statedPath({ home }));
  });

  it("refuses a file that breaks the schema, naming the path and the field", () => {
    const home = scratch();
    writeStatedCandidatesFile({ document: { candidates: SYNTHETIC_STATED, schemaVersion: 1 }, home });
    const refused = unwrapErr(readStatedCandidates({ home }));
    expect([refused.code, refused.message]).toEqual([
      "CANDIDATES_INVALID",
      `the stated candidates in ${statedPath({ home })} do not validate — formerNames: Invalid input: expected record, received undefined`,
    ]);
  });

  it("refuses a former title keyed by an id no stated candidate carries", () => {
    const home = scratch();
    writeStatedCandidatesFile({ document: statedCandidatesDocument({ formerNames: { "acme-nope": "Gone" } }), home });
    const refused = unwrapErr(readStatedCandidates({ home }));
    expect(refused.message).toBe(
      `the stated candidates in ${statedPath({ home })} do not validate — formerNames.acme-nope: no stated candidate has the id acme-nope`,
    );
  });

  it("refuses two stated candidates sharing an id or a number", () => {
    const home = scratch();
    const doubled = [SYNTHETIC_STATED[0]!, SYNTHETIC_STATED[0]!];
    writeStatedCandidatesFile({ document: statedCandidatesDocument({ candidates: doubled, formerNames: {} }), home });
    const refused = unwrapErr(readStatedCandidates({ home }));
    expect(refused.message).toBe(
      `the stated candidates in ${statedPath({ home })} do not validate — candidate id acme-schema-applied appears twice; ` +
        `candidate number 901 appears twice; acme-schema-applied "The acme schema applied, every table populated" names ` +
        `the same workstream as acme-schema-applied — merge them into one candidate`,
    );
  });

  it("refuses evidence linking into a Slack conversation, which a stated candidate has no channels to name", () => {
    const home = scratch();
    const first = SYNTHETIC_STATED[0]!;
    const linked = {
      ...first,
      evidence: [{ ...first.evidence[0]!, href: "https://acme.slack.com/archives/C0FIXTURE1/p1700000000000100" }],
    };
    writeStatedCandidatesFile({ document: statedCandidatesDocument({ candidates: [linked], formerNames: {} }), home });
    const refused = unwrapErr(readStatedCandidates({ home }));
    expect(refused.message).toBe(
      `the stated candidates in ${statedPath({ home })} do not validate — evidence links into Slack channel C0FIXTURE1, which a stated candidate has no channels to name`,
    );
  });

  it("accepts an answer under a former title for its own id only, and only as that exact title", () => {
    const home = scratch();
    writeStatedCandidatesFile({ home });
    const stated = unwrap(readStatedCandidates({ home }));
    const answered = ({ candidate, name }: { candidate: string; name: string }): ReactionRow => ({
      ...row({ candidate: "c-001", reaction: "yes" }),
      candidate,
      name,
    });
    const reviewers = SYNTHETIC_STATED.find((one) => one.id === "acme-reviewers-bumped")!;

    expect(
      answeredIdConflicts({
        file: stated,
        formerNames: stated.formerNames,
        rows: [answered({ candidate: SYNTHETIC_FORMER.id, name: SYNTHETIC_FORMER.title })],
      }),
    ).toEqual([]);
    expect(
      answeredIdConflicts({
        file: stated,
        formerNames: stated.formerNames,
        rows: [answered({ candidate: reviewers.id, name: SYNTHETIC_FORMER.title })],
      }),
    ).toEqual([
      `acme-reviewers-bumped was answered as "${SYNTHETIC_FORMER.title}" but this set names it "${reviewers.name}" — ` +
        "carry an answered candidate forward under its id and name, and give a new one a fresh id and name",
    ]);
    const green = SYNTHETIC_STATED.find((one) => one.id === SYNTHETIC_FORMER.id)!;
    expect(
      answeredIdConflicts({
        file: stated,
        formerNames: stated.formerNames,
        rows: [answered({ candidate: SYNTHETIC_FORMER.id, name: `${SYNTHETIC_FORMER.title}!` })],
      }),
    ).toEqual([
      `acme-green-prs-merged was answered as "${SYNTHETIC_FORMER.title}!" but this set names it "${green.name}" — ` +
        "carry an answered candidate forward under its id and name, and give a new one a fresh id and name",
    ]);
  });
});
