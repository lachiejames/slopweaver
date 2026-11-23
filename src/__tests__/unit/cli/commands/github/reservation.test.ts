/**
 * `resolvedReservation` — whether an already-taken create reservation is still live, decided against GitHub.
 *
 * A `mkdtempSync` home is the sanctioned exception in `.claude/rules/testing.md`: the thing under test IS the
 * on-disk reservation, so every case reads the ledger back afterwards rather than trusting what was returned.
 * The two API reads are plain functions that record what they were asked.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import { resolvedReservation } from "../../../../../cli/commands/github/reservation.js";
import type { GithubWriteApi, WrittenPr } from "../../../../../corpus/github/write.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import { bodyHash, confirmPr, locusOf, readPrRecord, reservePr } from "../../../../../outbound/github/prLedger.js";
import type { PrForm } from "../../../../../outbound/github/types.js";

const TARGET = { base: "main", head: "a-branch", owner: "octo-self", repo: "slopweaver" };
const FORM: PrForm = { ...EXAMPLE_PR_FORM, target: TARGET };
const LOCUS = locusOf({ target: TARGET });
const OLD_ISO = "2026-10-01T00:00:00.000Z";
const NOW_ISO = "2026-10-13T09:00:00.000Z";
const LIST_FAILURE: IngestError = { kind: "http", message: "other side closed", operation: "github.pulls.list" };
const GET_FAILURE: IngestError = { kind: "http", message: "bad gateway", operation: "github.pulls.get" };

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "reservation-home-"));
  fixtureDirs.push(home);
  return home;
}

function pr({ number, state }: { number: number; state: string }): WrittenPr {
  return {
    authorId: 1,
    baseRef: "main",
    baseRepoFullName: "octo-self/slopweaver",
    body: "the body github holds",
    commits: undefined,
    draft: false,
    head: {
      label: "octo-self:a-branch",
      ref: "a-branch",
      repoFullName: "octo-self/slopweaver",
      sha: "a".repeat(40),
    },
    htmlUrl: `https://github.com/octo-self/slopweaver/pull/${String(number)}`,
    mergedAtIso: undefined,
    nodeId: `PR_${String(number)}`,
    number,
    stack: undefined,
    state,
    title: "a title",
    updatedAtIso: "2026-10-12T00:00:00Z",
  };
}

/** The two reads, each recording what it was asked, and the lines the verb printed. */
function harness({
  getPr = () => errAsync(GET_FAILURE),
  listPrs = () => errAsync(LIST_FAILURE),
}: {
  getPr?: GithubWriteApi["getPr"];
  listPrs?: GithubWriteApi["listPrs"];
}): {
  api: Pick<GithubWriteApi, "getPr" | "listPrs">;
  getCalls: Parameters<GithubWriteApi["getPr"]>[0][];
  listCalls: Parameters<GithubWriteApi["listPrs"]>[0][];
  lines: string[];
  out: (args: { line: string }) => void;
} {
  const getCalls: Parameters<GithubWriteApi["getPr"]>[0][] = [];
  const listCalls: Parameters<GithubWriteApi["listPrs"]>[0][] = [];
  const lines: string[] = [];
  return {
    api: {
      getPr: (input) => {
        getCalls.push(input);
        return getPr(input);
      },
      listPrs: (input) => {
        listCalls.push(input);
        return listPrs(input);
      },
    },
    getCalls,
    lines,
    listCalls,
    out: ({ line }) => {
      lines.push(line);
    },
  };
}

/** A home whose locus was reserved at {@link OLD_ISO} and, when given a number, confirmed as that PR. */
function seededHome({ number }: { number: number | undefined }): string {
  const home = tempHome();
  reservePr({ home, locus: LOCUS, nowIso: OLD_ISO });
  if (number !== undefined) {
    confirmPr({
      form: FORM,
      home,
      locus: LOCUS,
      nodeId: `PR_${String(number)}`,
      nowIso: OLD_ISO,
      number,
      storedBody: "b",
    });
  }
  return home;
}

describe("resolvedReservation — a fresh locus", () => {
  it("claims it at the given instant and calls neither read", async () => {
    const home = tempHome();
    const h = harness({});
    const result = await resolvedReservation({
      api: h.api,
      form: FORM,
      home,
      locus: LOCUS,
      nowIso: NOW_ISO,
      out: h.out,
    });
    expect(result).toEqual({ kind: "fresh" });
    expect(readPrRecord({ home, locus: LOCUS })).toEqual({ locus: LOCUS, reservedIso: NOW_ISO });
    expect({ get: h.getCalls.length, list: h.listCalls.length, lines: h.lines }).toEqual({
      get: 0,
      lines: [],
      list: 0,
    });
  });
});

describe("resolvedReservation — a record carrying a number", () => {
  it("holds a still-open pull request without printing, reading only that number", async () => {
    const home = seededHome({ number: 7 });
    const before = readPrRecord({ home, locus: LOCUS });
    const h = harness({ getPr: () => okAsync(pr({ number: 7, state: "open" })) });
    const result = await resolvedReservation({
      api: h.api,
      form: FORM,
      home,
      locus: LOCUS,
      nowIso: NOW_ISO,
      out: h.out,
    });
    expect(result).toEqual({ kind: "taken", record: before });
    expect(before!.number).toBe(7);
    expect(h.getCalls).toEqual([{ number: 7, owner: "octo-self", repo: "slopweaver" }]);
    expect({ list: h.listCalls.length, lines: h.lines }).toEqual({ lines: [], list: 0 });
    expect(readPrRecord({ home, locus: LOCUS })).toEqual(before);
  });

  it("returns taken with no line when the read of the recorded number fails", async () => {
    const home = seededHome({ number: 7 });
    const before = readPrRecord({ home, locus: LOCUS });
    const h = harness({});
    const result = await resolvedReservation({
      api: h.api,
      form: FORM,
      home,
      locus: LOCUS,
      nowIso: NOW_ISO,
      out: h.out,
    });
    expect(result).toEqual({ kind: "taken", record: before });
    expect({ get: h.getCalls.length, list: h.listCalls.length, lines: h.lines }).toEqual({
      get: 1,
      lines: [],
      list: 0,
    });
    expect(readPrRecord({ home, locus: LOCUS })).toEqual(before);
  });

  it("releases a closed pull request, says so, and reclaims the locus at the new instant", async () => {
    const home = seededHome({ number: 7 });
    const h = harness({ getPr: () => okAsync(pr({ number: 7, state: "closed" })) });
    const result = await resolvedReservation({
      api: h.api,
      form: FORM,
      home,
      locus: LOCUS,
      nowIso: NOW_ISO,
      out: h.out,
    });
    expect(result).toEqual({ kind: "fresh" });
    expect(h.lines).toEqual([
      "releasing the reservation for octo-self/slopweaver#main...a-branch: #7 is closed there and no longer blocks a " +
        "fresh create for these branches.",
    ]);
    expect(readPrRecord({ home, locus: LOCUS })).toEqual({ locus: LOCUS, reservedIso: NOW_ISO });
  });
});

describe("resolvedReservation — a numberless record", () => {
  it("lists the owner-qualified branch pair and releases when GitHub reports none", async () => {
    const home = seededHome({ number: undefined });
    const h = harness({ listPrs: () => okAsync([]) });
    const result = await resolvedReservation({
      api: h.api,
      form: FORM,
      home,
      locus: LOCUS,
      nowIso: NOW_ISO,
      out: h.out,
    });
    expect(result).toEqual({ kind: "fresh" });
    expect(h.listCalls).toEqual([{ base: "main", head: "octo-self:a-branch", owner: "octo-self", repo: "slopweaver" }]);
    expect(h.getCalls.length).toBe(0);
    expect(h.lines).toEqual([
      "releasing the reservation for octo-self/slopweaver#main...a-branch: GitHub reports no pull request on these " +
        "branches in any state, so the create that claimed it never landed.",
    ]);
    expect(readPrRecord({ home, locus: LOCUS })).toEqual({ locus: LOCUS, reservedIso: NOW_ISO });
  });

  it("backfills one open pull request onto the record and holds it", async () => {
    const home = seededHome({ number: undefined });
    const h = harness({ listPrs: () => okAsync([pr({ number: 12, state: "open" })]) });
    const result = await resolvedReservation({
      api: h.api,
      form: FORM,
      home,
      locus: LOCUS,
      nowIso: NOW_ISO,
      out: h.out,
    });
    expect(result).toEqual({
      kind: "taken",
      record: { locus: LOCUS, nodeId: "PR_12", number: 12, reservedIso: OLD_ISO },
    });
    expect(h.lines).toEqual([
      "recovered #12 onto the reservation for octo-self/slopweaver#main...a-branch: the create landed and only its " +
        "response was lost.",
    ]);
    expect(readPrRecord({ home, locus: LOCUS })).toEqual({
      bodyHash: bodyHash({ body: "the body github holds" }),
      confirmedIso: NOW_ISO,
      locus: LOCUS,
      nodeId: "PR_12",
      number: 12,
      reservedIso: OLD_ISO,
    });
  });

  it("backfills one closed pull request, then releases and reclaims the locus", async () => {
    const home = seededHome({ number: undefined });
    const h = harness({ listPrs: () => okAsync([pr({ number: 12, state: "closed" })]) });
    const result = await resolvedReservation({
      api: h.api,
      form: FORM,
      home,
      locus: LOCUS,
      nowIso: NOW_ISO,
      out: h.out,
    });
    expect(result).toEqual({ kind: "fresh" });
    expect(h.lines).toEqual([
      "recovered #12 onto the reservation for octo-self/slopweaver#main...a-branch: the create landed and only its " +
        "response was lost.",
      "releasing the reservation for octo-self/slopweaver#main...a-branch: #12 is closed there and no longer blocks a " +
        "fresh create for these branches.",
    ]);
    expect(readPrRecord({ home, locus: LOCUS })).toEqual({ locus: LOCUS, reservedIso: NOW_ISO });
  });

  it("holds an ambiguous pair, says so, and leaves the record untouched", async () => {
    const home = seededHome({ number: undefined });
    const h = harness({
      listPrs: () => okAsync([pr({ number: 12, state: "open" }), pr({ number: 13, state: "closed" })]),
    });
    const result = await resolvedReservation({
      api: h.api,
      form: FORM,
      home,
      locus: LOCUS,
      nowIso: NOW_ISO,
      out: h.out,
    });
    expect(result).toEqual({ kind: "taken", record: { locus: LOCUS, reservedIso: OLD_ISO } });
    expect(h.lines).toEqual([
      "leaving the reservation for octo-self/slopweaver#main...a-branch standing: GitHub reports at least 2 pull " +
        "requests on these branches — the listing stops at two — so which one it named cannot be decided here. Read " +
        "them back and use `github pr release-reservation`.",
    ]);
    expect(readPrRecord({ home, locus: LOCUS })).toEqual({ locus: LOCUS, reservedIso: OLD_ISO });
  });

  it("holds when the listing fails, naming the provider's message, and leaves the record untouched", async () => {
    const home = seededHome({ number: undefined });
    const h = harness({});
    const result = await resolvedReservation({
      api: h.api,
      form: FORM,
      home,
      locus: LOCUS,
      nowIso: NOW_ISO,
      out: h.out,
    });
    expect(result).toEqual({ kind: "taken", record: { locus: LOCUS, reservedIso: OLD_ISO } });
    expect(h.lines).toEqual([
      "leaving the reservation for octo-self/slopweaver#main...a-branch standing: could not read the pull requests " +
        "on these branches (other side closed), so nothing here proves the create did not land.",
    ]);
    expect(readPrRecord({ home, locus: LOCUS })).toEqual({ locus: LOCUS, reservedIso: OLD_ISO });
  });
});
