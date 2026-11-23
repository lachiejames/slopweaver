/**
 * `src/admit/profileFirstBoot.ts` — the surviving evidence that a machine was ever configured, read over real temp
 * homes: every trace closes the first boot, and a trace that cannot be read is an error, never an absence.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readFirstBootEvidence } from "../../../admit/profileFirstBoot.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One ledger row as the hook writes it, with the origin under test, and the owner-absent field when given. */
function ledgerRow({ origin, ownerAbsent = false }: { origin: string; ownerAbsent?: boolean }): string {
  return JSON.stringify({
    atIso: "2026-10-31T10:00:00.000Z",
    cwd: "/w",
    event: "SessionStart:startup",
    origin,
    reason: "",
    sessionId: "s-1",
    source: "hook",
    ...(ownerAbsent ? { ownerAbsent: true } : {}),
  });
}

describe("readFirstBootEvidence", () => {
  let home = "";
  let other = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "first-boot-"));
    other = mkdtempSync(join(tmpdir(), "first-boot-other-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
    rmSync(other, { force: true, recursive: true });
  });

  /** Write a file under the home, making its directories. */
  function put({ relative, body }: { relative: string; body: string }): void {
    const path = join(home, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  }

  it("finds nothing on two empty homes", () => {
    expect(unwrap(readFirstBootEvidence({ homes: [home, other] }))).toEqual({
      cacheExists: false,
      everLoaded: false,
      ownerWritten: false,
    });
  });

  it("reads the owner-written mark, a dangling one included, and never a selected store", () => {
    // Reading the store selection as configuration held `store push` behind a reload needing it.
    put({ body: "postgresql://x\n", relative: "secrets/store-url" });
    const selected = unwrap(readFirstBootEvidence({ homes: [home] })).ownerWritten;
    put({ body: "", relative: "profile/owner-written" });
    const written = unwrap(readFirstBootEvidence({ homes: [home] })).ownerWritten;
    rmSync(join(home, "profile", "owner-written"));
    symlinkSync(join(home, "nowhere"), join(home, "profile", "owner-written"));
    const dangling = unwrap(readFirstBootEvidence({ homes: [home] })).ownerWritten;
    expect([selected, written, dangling]).toEqual([false, true, true]);
  });

  it("reads either cache copy, the text one alone included", () => {
    put({ body: "## About the owner\n", relative: "profile/context.txt" });
    expect(unwrap(readFirstBootEvidence({ homes: [home] })).cacheExists).toBe(true);
  });

  it("counts a live or cached load and a delivery marker, and not a ledger of failed loads alone", () => {
    put({ body: `${ledgerRow({ origin: "none" })}\n`, relative: "profile/loads.jsonl" });
    const failedOnly = unwrap(readFirstBootEvidence({ homes: [home] })).everLoaded;
    put({
      body: `${ledgerRow({ origin: "none" })}\n${ledgerRow({ origin: "cache" })}\n`,
      relative: "profile/loads.jsonl",
    });
    const cached = unwrap(readFirstBootEvidence({ homes: [home] })).everLoaded;
    const marked = join(other, "profile", "delivered");
    mkdirSync(marked, { recursive: true });
    writeFileSync(join(marked, "s-1"), "profile-delivered v1\n");
    const markerElsewhere = unwrap(readFirstBootEvidence({ homes: [other] })).everLoaded;
    expect([failedOnly, cached, markerElsewhere]).toEqual([false, true, true]);
  });

  it("does not count a live read that found no owner row, so a failed profile set leaves a fresh machine fresh", () => {
    // A hook that ran while another session's profile set held its mark records this row; the write then failed.
    put({ body: `${ledgerRow({ origin: "live", ownerAbsent: true })}\n`, relative: "profile/loads.jsonl" });
    const absentOnly = unwrap(readFirstBootEvidence({ homes: [home] })).everLoaded;
    put({
      body: `${ledgerRow({ origin: "live", ownerAbsent: true })}\n${ledgerRow({ origin: "live" })}\n`,
      relative: "profile/loads.jsonl",
    });
    const thenLoaded = unwrap(readFirstBootEvidence({ homes: [home] })).everLoaded;
    expect([absentOnly, thenLoaded]).toEqual([false, true]);
  });

  it("ORs the homes, so a trace in the default home closes an empty resolved one", () => {
    mkdirSync(join(other, "profile"), { recursive: true });
    writeFileSync(join(other, "profile", "owner-written"), "");
    expect(unwrap(readFirstBootEvidence({ homes: [home, other] })).ownerWritten).toBe(true);
  });

  it("refuses a ledger line that is no row rather than reading absence", () => {
    put({ body: "not json\n", relative: "profile/loads.jsonl" });
    expect(unwrapErr(readFirstBootEvidence({ homes: [home] })).code).toBe("FIRST_BOOT_LEDGER_UNKNOWN");
  });

  it("reads a plain file where the profile directory belongs as absence, since nothing can sit below it", () => {
    // `ENOTDIR` read as unreadable held a fresh machine over a stray file.
    writeFileSync(join(home, "profile"), "");
    expect(unwrap(readFirstBootEvidence({ homes: [home] }))).toEqual({
      cacheExists: false,
      everLoaded: false,
      ownerWritten: false,
    });
  });

  it("reads a plain file where the delivery directory belongs as no delivery, a dangling link there as unreadable", () => {
    // The bash twin held a fresh machine over a stray `profile/delivered` file.
    put({ body: "", relative: "profile/delivered" });
    const stray = unwrap(readFirstBootEvidence({ homes: [home] })).everLoaded;
    mkdirSync(join(other, "profile"), { recursive: true });
    symlinkSync(join(other, "gone"), join(other, "profile", "delivered"));
    expect([stray, unwrapErr(readFirstBootEvidence({ homes: [other] })).code]).toEqual([
      false,
      "FIRST_BOOT_PATH_UNREADABLE",
    ]);
  });

  it("refuses a ledger that is a dangling link, which the ledger reader alone would read as empty", () => {
    mkdirSync(join(home, "profile"), { recursive: true });
    symlinkSync(join(home, "nowhere.jsonl"), join(home, "profile", "loads.jsonl"));
    expect(unwrapErr(readFirstBootEvidence({ homes: [home] })).code).toBe("FIRST_BOOT_PATH_UNREADABLE");
  });

  it("refuses a home whose profile directory is a dangling link, which hides every path under it", () => {
    symlinkSync(join(home, "missing-profile"), join(home, "profile"));
    expect(unwrapErr(readFirstBootEvidence({ homes: [home] })).code).toBe("FIRST_BOOT_PATH_UNREADABLE");
  });

  it("reads a home that does not exist yet under an existing directory as fresh", () => {
    expect(unwrap(readFirstBootEvidence({ homes: [join(home, "not-yet")] }))).toEqual({
      cacheExists: false,
      everLoaded: false,
      ownerWritten: false,
    });
  });
});
