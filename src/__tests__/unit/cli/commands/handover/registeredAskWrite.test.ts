/**
 * The write half of a registered-ask edit, over a real row file in a throwaway directory: it re-judges the row and
 * its journal as they read at the write, so a run opened or a row swapped since the verb resolved it writes nothing.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { askRowText } from "../../../../../cli/commands/handover/askRowText.js";
import { writeRegisteredAskChange } from "../../../../../cli/commands/handover/registeredAskWrite.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { RegisteredAskChangeErrors } from "../../../../../handover/registeredAskChangeErrors.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";

const SLUG = "a-registered-ask";
const ASKED = "2026-10-10T17:01:55.569Z";
const CHANGE = { atIso: "2026-10-11T20:00:00.000Z", kind: "reconfirm", stillReal: "still eight" } as const;

/** The row exactly as `handover register` writes a whole-shaped ask. */
const REGISTERED = askRowText({
  anchor: undefined,
  ask: "Should more console sidebar entries carry a count?",
  askedIso: ASKED,
  branch: undefined,
  checkedIso: ASKED,
  dispatch: false,
  finding: undefined,
  priority: "p1",
  repo: "/w/repo",
  shape: {
    lean: "A",
    options: [
      { letter: "A", option: "count the automations page", tradeoff: "it reads 5 today" },
      { letter: "B", option: "count nothing else", tradeoff: "a failure stays invisible" },
    ],
    problem: "only Queue and Pull requests carry a count",
    stakes: { blastRadius: "the console sidebar", risk: "a count nobody acts on", stillReal: "eight entries" },
  },
  slug: SLUG,
});

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A directory holding the row file and an empty runs directory. */
function fixture(): { path: string; runsDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "registered-ask-write-"));
  dirs.push(dir);
  const runsDir = join(dir, "runs");
  mkdirSync(runsDir);
  const path = join(dir, `${SLUG}.md`);
  writeFileSync(path, REGISTERED);
  return { path, runsDir };
}

describe("writeRegisteredAskChange", () => {
  it("writes the edit into the row's own file and opens no journal", () => {
    const { path, runsDir } = fixture();

    const written = unwrap(writeRegisteredAskChange({ change: CHANGE, path, runsDir, slug: SLUG }));
    const doc = parseHandoverDoc({ path, text: readFileSync(path, "utf8") });

    expect(written.endsWith(`${SLUG}.md`)).toBe(true);
    expect(doc.stillReal).toBe("still eight");
    expect(doc.stillRealIso).toBe("2026-10-11T20:00:00.000Z");
    expect(doc.askedIso).toBe(ASKED);
  });

  it("refuses, writing nothing, once a run has opened on the row", () => {
    const { path, runsDir } = fixture();
    unwrap(
      appendRunEvent({
        event: { atIso: "2026-10-11T00:00:00.000Z", branch: "b", docHash: "abc", kind: "started" },
        runsDir,
        slug: SLUG,
      }),
    );

    const result = writeRegisteredAskChange({ change: CHANGE, path, runsDir, slug: SLUG });

    expect(unwrapErr(result)).toEqual(RegisteredAskChangeErrors.notEligible({ slug: SLUG }));
    expect(readFileSync(path, "utf8")).toBe(REGISTERED);
  });

  it("refuses, writing nothing, a row that is not valid UTF-8", () => {
    const { path, runsDir } = fixture();
    const invalid = Buffer.concat([Buffer.from(REGISTERED, "utf8"), Buffer.from([0x80, 0x0a])]);
    writeFileSync(path, invalid);

    const result = writeRegisteredAskChange({ change: CHANGE, path, runsDir, slug: SLUG });

    expect(unwrapErr(result).message).toContain("is not valid UTF-8");
    expect(readFileSync(path).equals(invalid)).toBe(true);
  });

  it("refuses, writing nothing, when the file now holds a different row", () => {
    const { path, runsDir } = fixture();

    const result = writeRegisteredAskChange({ change: CHANGE, path, runsDir, slug: "another-row" });

    expect(unwrapErr(result).code).toBe("ROW_FILE");
    expect(unwrapErr(result).message).toContain(`now holds the row "${SLUG}", not "another-row"`);
    expect(readFileSync(path, "utf8")).toBe(REGISTERED);
  });

  it("repairs a row whose own still-real line breaks the cap, so the board reads it well-formed", () => {
    const { path, runsDir } = fixture();
    writeFileSync(path, REGISTERED.replace('stillReal: "eight entries"', `stillReal: "${OVER_CAP}"`));

    unwrap(writeRegisteredAskChange({ change: CHANGE, path, runsDir, slug: SLUG }));
    const doc = parseHandoverDoc({ path, text: readFileSync(path, "utf8") });

    expect(doc.stillReal).toBe("still eight");
    expect(doc.problems).toEqual([]);
  });

  it("refuses, writing nothing, a reconfirm whose own line would break the cap", () => {
    const { path, runsDir } = fixture();
    const change = { ...CHANGE, stillReal: OVER_CAP };

    const result = writeRegisteredAskChange({ change, path, runsDir, slug: SLUG });

    expect(unwrapErr(result)).toEqual(
      RegisteredAskChangeErrors.leavesMalformed({
        problems: ["still-real check runs 31 words against a cap of 30 — say it shorter, the fold is for the detail"],
      }),
    );
    expect(readFileSync(path, "utf8")).toBe(REGISTERED);
  });
});

/** One line past the still-real cap of 30 words, in one sentence, so the word cap is the only one it breaks. */
const OVER_CAP = Array.from({ length: 31 }, (_, index) => `word${String(index)}`).join(" ");
