/**
 * The walk over a real runs directory: absent is unruled, a permitting line opens the door, an undecodable line in a
 * journal naming the half closes it, and a journal that never names the half is never parsed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readAttachUploadStanding } from "../../../handover/attachUploadRulingStore.js";

const AT = "2026-11-22T01:00:00.000Z";
const PERMIT = JSON.stringify({
  anchor: "talk:p1",
  atIso: AT,
  attachUpload: { verdict: "permitted" },
  decidedIso: AT,
  kind: "ruling",
  ruling: "pictures may go up",
});

const dirs: string[] = [];

/** A fresh runs directory holding the given journals. */
function runsWith({ journals }: { journals: Readonly<Record<string, string>> }): string {
  const root = mkdtempSync(join(tmpdir(), "attach-door-"));
  dirs.push(root);
  const runs = join(root, "runs");
  mkdirSync(runs);
  for (const [name, text] of Object.entries(journals)) {
    writeFileSync(join(runs, name), text);
  }
  return runs;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("readAttachUploadStanding", () => {
  it("reads an absent runs directory as unruled, so refused", () => {
    const root = mkdtempSync(join(tmpdir(), "attach-door-"));
    dirs.push(root);
    expect(readAttachUploadStanding({ runsDir: join(root, "runs") })).toEqual({ because: "unruled", kind: "refused" });
  });

  it("opens on a permitting live ruling and names its row", () => {
    const runsDir = runsWith({ journals: { "a-row.jsonl": `${PERMIT}\n` } });
    expect(readAttachUploadStanding({ runsDir })).toMatchObject({ by: { slug: "a-row" }, kind: "permitted" });
  });

  it("closes on an undecodable line in a journal naming the half, over the permit beside it", () => {
    const runsDir = runsWith({ journals: { "a-row.jsonl": `${PERMIT}\n{"attachUpload": "not json\n` } });
    expect(readAttachUploadStanding({ runsDir })).toMatchObject({ because: "unreadable", kind: "refused" });
  });

  it("closes on a later refusing ruling in another journal", () => {
    const refuse = PERMIT.replace("permitted", "refused").replace(AT, "2026-11-22T02:00:00.000Z");
    const runsDir = runsWith({ journals: { "a-row.jsonl": `${PERMIT}\n`, "b-row.jsonl": `${refuse}\n` } });
    expect(readAttachUploadStanding({ runsDir })).toMatchObject({
      because: "ruled",
      by: { slug: "b-row" },
      kind: "refused",
    });
  });

  it("reads a later refusal whose key is spelled with a JSON unicode escape", () => {
    const refuse = PERMIT.replace("permitted", "refused")
      .replace(AT, "2026-11-22T02:00:00.000Z")
      .replace('"attachUpload"', '"attach\\u0055pload"');
    const runsDir = runsWith({ journals: { "a-row.jsonl": `${PERMIT}\n`, "b-row.jsonl": `${refuse}\n` } });
    expect(readAttachUploadStanding({ runsDir })).toMatchObject({
      because: "ruled",
      by: { slug: "b-row" },
      kind: "refused",
    });
  });

  it("closes on an undecodable line in a journal carrying a unicode escape, which may hide the key", () => {
    const runsDir = runsWith({
      journals: { "a-row.jsonl": `${PERMIT}\n`, "b-row.jsonl": '{"x":"\\u0041"}\n{not json\n' },
    });
    expect(readAttachUploadStanding({ runsDir })).toMatchObject({ because: "unreadable", kind: "refused" });
  });

  it("names a journal that would not open as a gap, which refuses", () => {
    const runsDir = runsWith({ journals: { "a-row.jsonl": `${PERMIT}\n` } });
    mkdirSync(join(runsDir, "b-row.jsonl"));
    expect(readAttachUploadStanding({ runsDir })).toMatchObject({
      because: "unreadable",
      gaps: [expect.stringContaining("b-row.jsonl: ")],
      kind: "refused",
    });
  });

  it("ignores an undecodable journal that never names the half", () => {
    const runsDir = runsWith({ journals: { "a-row.jsonl": `${PERMIT}\n`, "b-row.jsonl": "{not json\n" } });
    expect(readAttachUploadStanding({ runsDir }).kind).toBe("permitted");
  });
});
