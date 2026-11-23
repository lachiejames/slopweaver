/**
 * The running list's file: an append lands, survives a fresh read, is the owner's alone, and a broken file is an error.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { appendRunningList, readRunningList } from "../../../talk/runningListStore.js";

const AT = "2026-10-12T09:30:00.000Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "running-list-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("running list store", () => {
  it("reads a home that never held an item as the empty list", () => {
    expect(unwrap(readRunningList({ home }))).toEqual({ items: [], nextSeq: 1, version: 1 });
  });

  it("writes an append that a fresh read returns, at mode 0600", () => {
    const added = unwrap(
      appendRunningList({ draft: { id: "a", origin: "owner", text: "C0SYN000021\n" }, home, nowIso: () => AT }),
    );
    expect(added).toEqual({
      appended: true,
      item: { atIso: AT, id: "a", origin: "owner", seq: 1, text: "C0SYN000021\n" },
    });
    expect(unwrap(readRunningList({ home })).items).toEqual([added.item]);
    expect(statSync(stateHomePaths({ home }).talkRunningListJson).mode & 0o777).toBe(0o600);
  });

  it("answers a retry with the stored item and does not number it again", () => {
    appendRunningList({ draft: { id: "a", origin: "voice", text: "first" }, home, nowIso: () => AT });
    const again = unwrap(
      appendRunningList({ draft: { id: "a", origin: "voice", text: "first" }, home, nowIso: () => AT }),
    );
    expect(again.appended).toBe(false);
    expect(unwrap(readRunningList({ home })).nextSeq).toBe(2);
  });

  it("reports a file that is not a running list, and refuses to add on top of it", () => {
    const path = stateHomePaths({ home }).talkRunningListJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");
    expect(unwrapErr(readRunningList({ home })).code).toBe("STORE_UNREADABLE");
    expect(
      unwrapErr(appendRunningList({ draft: { id: "a", origin: "owner", text: "t" }, home, nowIso: () => AT })).code,
    ).toBe("STORE_UNREADABLE");
  });

  it("reads an item stored under the owner's origin, and keeps it on the next append", () => {
    const path = stateHomePaths({ home }).talkRunningListJson;
    mkdirSync(dirname(path), { recursive: true });
    const stored = { atIso: AT, id: "a", origin: "owner", seq: 1, text: "t" };
    writeFileSync(path, JSON.stringify({ items: [stored], nextSeq: 2, version: 1 }));
    expect(unwrap(readRunningList({ home })).items).toEqual([stored]);
    appendRunningList({ draft: { id: "b", origin: "voice", text: "u" }, home, nowIso: () => AT });
    const written = [...readFileSync(path, "utf8").matchAll(/"origin":\s*"(\w+)"/gu)].map((match) => match[1]);
    expect(written).toEqual(["voice", "owner"]);
  });
});
