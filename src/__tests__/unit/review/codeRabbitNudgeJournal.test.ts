/**
 * The nudge register: one head of one pull request is re-requested at most once, a claim is exclusive, and
 * an unreadable register never reads as empty.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  codeRabbitNudgeClaimName,
  codeRabbitNudgeJournalPath,
  codeRabbitNudgeKey,
  codeRabbitNudgeKeyOfClaim,
  readCodeRabbitNudgedHeads,
  reserveCodeRabbitNudge,
} from "../../../review/codeRabbitNudgeJournal.js";

const HEAD = "1111111111111111111111111111111111111111";

const RECORD = { attemptedAtIso: "2026-09-28T06:20:00.000Z", headOid: HEAD, number: 17653, repoSlug: "acme/widgets" };

const KEY = `acme/widgets#17653@${HEAD}`;

describe("codeRabbitNudgeKey", () => {
  it("files one head of one pull request as owner/name#number@head", () => {
    expect(codeRabbitNudgeKey({ headOid: HEAD, number: 17653, repoSlug: "acme/widgets" })).toBe(KEY);
  });
});

describe("the claim file name", () => {
  it("percent-encodes the key, so its slash never names a directory", () => {
    expect(codeRabbitNudgeClaimName({ key: KEY })).toBe(`acme%2Fwidgets%2317653%40${HEAD}.json`);
  });

  it("round-trips a claim name back to its key", () => {
    expect(codeRabbitNudgeKeyOfClaim({ name: codeRabbitNudgeClaimName({ key: KEY }) })).toBe(KEY);
  });

  it.each([
    ["a file without the claim suffix", "notes.txt"],
    ["a name that does not decode", "%E0%A4%A.json"],
  ])("reads %s as no claim", (_label, name) => {
    expect(codeRabbitNudgeKeyOfClaim({ name })).toBeUndefined();
  });
});

describe("the register on disk", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "nudge-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("lives at landing-coderabbit-nudges/ under the state home", () => {
    expect(codeRabbitNudgeJournalPath({ home })).toBe(join(home, "landing-coderabbit-nudges"));
  });

  it("reads a register that does not exist yet as nothing recorded", () => {
    expect([...unwrap(readCodeRabbitNudgedHeads({ home }))]).toEqual([]);
  });

  it("claims a head once and answers already-recorded the second time, writing the attempt", () => {
    expect(unwrap(reserveCodeRabbitNudge({ home, record: RECORD }))).toBe("reserved");
    expect(unwrap(reserveCodeRabbitNudge({ home, record: RECORD }))).toBe("already-recorded");
    const dir = codeRabbitNudgeJournalPath({ home });
    expect(readdirSync(dir)).toEqual([codeRabbitNudgeClaimName({ key: KEY })]);
    expect(readFileSync(join(dir, codeRabbitNudgeClaimName({ key: KEY })), "utf8")).toBe(`${JSON.stringify(RECORD)}\n`);
    expect([...unwrap(readCodeRabbitNudgedHeads({ home }))]).toEqual([KEY]);
  });

  it("claims another head of the same pull request as a new case", () => {
    unwrap(reserveCodeRabbitNudge({ home, record: RECORD }));
    const moved = { ...RECORD, headOid: "2222222222222222222222222222222222222222" };
    expect(unwrap(reserveCodeRabbitNudge({ home, record: moved }))).toBe("reserved");
  });

  it("refuses to read a register that exists but cannot be listed, rather than reading it as empty", () => {
    // A FILE where the directory should be: it exists, and it cannot be listed.
    writeFileSync(codeRabbitNudgeJournalPath({ home }), "");
    expect(unwrapErr(readCodeRabbitNudgedHeads({ home })).code).toBe("NUDGE_REGISTER_UNREADABLE");
  });

  it("refuses to claim when the claim cannot be created, rather than posting unclaimed", () => {
    writeFileSync(codeRabbitNudgeJournalPath({ home }), "");
    expect(unwrapErr(reserveCodeRabbitNudge({ home, record: RECORD })).code).toBe("NUDGE_REGISTER_UNWRITABLE");
  });
});
