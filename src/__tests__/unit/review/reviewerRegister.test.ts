/*
 * The reviewer register: an ask is written once however many readings see it, a pick is written every time, a
 * decline with no reason and a group named as a reviewer are refused before anything is written, and a
 * malformed line refuses the read with its line number. The round trip writes into a `mkdtempSync` home and
 * passes it explicitly, per `.claude/rules/testing.md`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  askedRowsOf,
  codeOwnerTeamsOf,
  parseReviewerLine,
  type ReviewerAskedRow,
  type ReviewerPickRow,
  ReviewerRegisterErrors,
  rowsToAppend,
} from "../../../review/reviewerRegister.js";
import { appendReviewerRows, readReviewerRegister } from "../../../review/reviewerRegisterStore.js";
import { landingRowFake } from "../../landingRowFake.js";

const NOW = "2026-09-25T05:00:00.000Z";

const ASK = {
  atIso: "2026-09-23T04:46:00.000Z",
  channel: "#dev-alerts",
  isDirectMessage: false,
  leg: "corpus" as const,
  messageKey: "C0SYN000002:1790138766.748499",
  permalink: "https://acme.slack.com/archives/C0SYN000002/p1790138766748499",
  recipients: ["U0SYN000006"],
};

const ROW = landingRowFake({
  askTrail: [ASK],
  authorLogin: "octocat",
  blockedOn: ["@acme/security", "@pranav"],
  number: 17012,
  repoSlug: "acme/acme-admin",
});

const ASKED: ReviewerAskedRow = {
  atIso: ASK.atIso,
  authorLogin: "octocat",
  channel: "#dev-alerts",
  codeOwnerTeams: ["@acme/security"],
  isDirectMessage: false,
  kind: "asked",
  messageKey: ASK.messageKey,
  names: { U0SYN000006: "Pranav" },
  number: 17012,
  permalink: ASK.permalink,
  prKey: "acme/acme-admin#17012",
  recipients: ["U0SYN000006"],
  recordedAtIso: NOW,
  repoSlug: "acme/acme-admin",
  schema: 1,
};

const PICK: ReviewerPickRow = {
  atIso: NOW,
  bySession: "work-console",
  kind: "pick",
  number: 17012,
  prKey: "acme/acme-admin#17012",
  repoSlug: "acme/acme-admin",
  reviewer: "U0SYN000006",
  schema: 1,
  verdict: "approve",
};

const homes: string[] = [];

/** A fresh state home, removed after the test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-rr-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("askedRowsOf", () => {
  it("writes one row per ask, with the teams GitHub named and never a person among them", () => {
    const people = { U0SYN000006: { name: "Pranav" }, U0SYNUNASKED: { name: "Nobody" } };
    expect(askedRowsOf({ people, recordedAtIso: NOW, rows: [ROW, landingRowFake({ askTrail: [] })] })).toEqual([ASKED]);
  });
});

describe("codeOwnerTeamsOf", () => {
  it("keeps the @org/team tokens only", () => {
    expect(codeOwnerTeamsOf({ blockedOn: ["@a/b", "@person", "@c/d"] })).toEqual(["@a/b", "@c/d"]);
  });
});

describe("rowsToAppend", () => {
  it("drops an ask already held and a repeat within the offer, and keeps every pick", () => {
    const later = { ...ASKED, messageKey: "C1:2" };
    expect(rowsToAppend({ candidates: [ASKED, later, later, PICK, PICK], held: [ASKED] })).toEqual([later, PICK, PICK]);
  });
});

describe("parseReviewerLine", () => {
  it("refuses a decline that carries no reason", () => {
    const line = JSON.stringify({ ...PICK, verdict: "decline" });
    expect(unwrapErr(parseReviewerLine({ line, lineNumber: 4 }))).toEqual(
      ReviewerRegisterErrors.corruptRow({ lineNumber: 4, why: "a decline carries the feedback that says why" }),
    );
  });

  it("refuses a user group named as the reviewer", () => {
    const line = JSON.stringify({ ...PICK, reviewer: "S0GROUP" });
    expect(unwrapErr(parseReviewerLine({ line, lineNumber: 2 })).code).toBe("CORRUPT_ROW");
  });

  it("refuses a line that is not JSON, naming its line", () => {
    expect(unwrapErr(parseReviewerLine({ line: "{", lineNumber: 9 }))).toEqual(
      ReviewerRegisterErrors.corruptRow({ lineNumber: 9, why: "it is not JSON" }),
    );
  });
});

describe("the register on disk", () => {
  it("reads an absent register as empty", () => {
    expect(unwrap(readReviewerRegister({ home: freshHome() }))).toEqual([]);
  });

  it("writes an ask once across two readings, and a decline with its reason", () => {
    const home = freshHome();
    const decline: ReviewerPickRow = { ...PICK, feedback: "the reviewer is on leave", verdict: "decline" };
    const first = unwrap(appendReviewerRows({ home, nowIso: NOW, rows: [ASKED] }));
    const second = unwrap(appendReviewerRows({ home, nowIso: NOW, rows: [ASKED, decline] }));
    expect([first.appended, second.appended]).toEqual([1, 1]);
    expect(unwrap(readReviewerRegister({ home }))).toEqual([ASKED, decline]);
  });

  it("writes nothing when one offered row is invalid", () => {
    const home = freshHome();
    const bad = { ...PICK, verdict: "decline" } as const;
    const result = appendReviewerRows({ home, nowIso: NOW, rows: [ASKED, bad] });
    expect(unwrapErr(result).code).toBe("CORRUPT_ROW");
    expect(unwrap(readReviewerRegister({ home }))).toEqual([]);
  });

  it("refuses the read over a malformed line, naming it", () => {
    const home = freshHome();
    mkdirSync(join(home, "ledgers"), { recursive: true });
    const path = join(home, "ledgers", "reviewers.jsonl");
    writeFileSync(path, `${JSON.stringify(ASKED)}\n{"schema":1}\n`);
    expect(unwrapErr(readReviewerRegister({ home })).code).toBe("CORRUPT_ROW");
    expect(readFileSync(path, "utf8").split("\n").length).toBe(3);
  });
});
