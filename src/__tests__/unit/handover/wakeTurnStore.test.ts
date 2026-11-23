/**
 * The wake turn snapshot: absent reads empty, a write reads back whole, and a file that will not read or decode is
 * named UNREADABLE — never a partial map — so the caller serves oldest first and its rewrite replaces it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrapErr } from "#lib/result.js";

import { readWakeTurns, wakeParkKey, writeWakeTurns } from "../../../handover/wakeTurnStore.js";
import { stateHomePaths } from "../../../stateHome.js";

const AT = "2026-11-05T05:00:00.000Z";

describe("wake turn store", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "wake-turns-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Put raw text where the snapshot lives. */
  function plant({ text }: { text: string }): void {
    const path = stateHomePaths({ home }).handoverWakeTurnsJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }

  it("keys a park by its run, its journal position and its own instant", () => {
    expect(wakeParkKey({ parkIndex: 2, parkedAtIso: AT, slug: "abc" })).toBe(`abc:2:${AT}`);
  });

  it("reads no turns on a fresh install", () => {
    expect(readWakeTurns({ home })).toEqual({ kind: "read", turns: new Map() });
  });

  it("reads back exactly what it wrote", () => {
    const turns = new Map([
      ["a:2:x", { readAtIso: AT }],
      ["b:2:y", { askedAtIso: AT, readAtIso: AT }],
    ]);
    expect(writeWakeTurns({ home, turns }).isOk()).toBe(true);
    expect(readWakeTurns({ home })).toEqual({ kind: "read", turns });
  });

  it("names a torn file unreadable rather than reading part of it", () => {
    plant({ text: '{"turns":{"a:2:x":{"readAtIso":"2026' });
    const read = readWakeTurns({ home });
    expect(read.kind).toBe("unreadable");
    expect(read).toMatchObject({ why: expect.stringContaining("are not JSON") });
  });

  it("names a file of another shape unreadable", () => {
    plant({ text: JSON.stringify({ turns: {}, version: 2 }) });
    expect(readWakeTurns({ home })).toMatchObject({
      kind: "unreadable",
      why: expect.stringContaining("did not decode"),
    });
  });

  it("names a turn that is not a UTC instant unreadable", () => {
    plant({ text: JSON.stringify({ turns: { "a:2:x": { readAtIso: "yesterday" } }, version: 1 }) });
    expect(readWakeTurns({ home })).toMatchObject({ kind: "unreadable", why: expect.stringContaining("UTC instant") });
  });

  it("fails a write it cannot land with its own code", () => {
    writeFileSync(join(home, "ledgers"), "a file where the directory goes");
    const failure = unwrapErr(writeWakeTurns({ home, turns: new Map() }));
    expect([failure.code, failure.path]).toEqual([
      "WAKE_TURNS_UNWRITABLE",
      stateHomePaths({ home }).handoverWakeTurnsJson,
    ]);
  });
});
