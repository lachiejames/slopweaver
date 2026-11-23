/**
 * The `store` projection verbs' manifest rows, against the parsers whose flags they advertise.
 *
 * A manifest row is help text and a catalogue entry, so nothing at runtime notices it drifting from the
 * verb it describes. What can be asserted is the join: every flag the usage line names is one the verb's
 * REAL parser accepts, and neither row claims to be diagnostic or doored when it writes to a local store.
 */
import { describe, expect, it } from "vitest";

import { parseImportAtlasArgs } from "../../../../cli/commands/store/importAtlasCore.js";
import { parseImportFleetArgs } from "../../../../cli/commands/store/importFleetArgs.js";
import { FLEET_LEGS } from "../../../../cli/commands/store/importFleetUsage.js";
import { parseImportOwnerTurnDumpArgs } from "../../../../cli/commands/store/importOwnerTurnDumpArgs.js";
import { IMPORT_OWNER_TURN_DUMP_USAGE } from "../../../../cli/commands/store/importOwnerTurnDumpUsage.js";
import { parsePagesImportArgs } from "../../../../cli/commands/store/pagesImportCore.js";
import { PAGES_IMPORT_USAGE } from "../../../../cli/commands/store/pagesImportUsage.js";
import {
  importAtlasMeta,
  importFleetMeta,
  importOwnerTurnDumpMeta,
  pagesImportMeta,
} from "../../../../cli/manifests/storeProjectionMeta.js";
import { unwrap } from "../../../../lib/result.js";

/** Every `--flag` the usage block names, deduped, in first-seen order. */
function flagsNamedIn({ usage }: { usage: string }): readonly string[] {
  const found = usage.match(/--[a-z][a-z-]*/g);
  // A usage block naming no flag at all is a defect in the row, not a case to substitute an empty list
  // for silently — so the absent case is a line of code rather than an operator.
  if (found === null) {
    return [];
  }
  return [...new Set(found)];
}

describe("importAtlasMeta", () => {
  it("names the verb's own flags and nothing the parser would refuse", () => {
    expect(flagsNamedIn({ usage: importAtlasMeta.usage }).toSorted()).toEqual([
      "--dry-run",
      "--force",
      "--home",
      "--json",
      "--platform",
    ]);
  });

  it("advertises a usage its own parser accepts", () => {
    const parsed = parseImportAtlasArgs({ argv: ["--platform", "vanta", "--force", "--dry-run", "--json"] });
    expect(parsed.isOk()).toBe(true);
  });

  it("is local-state and undoored, because it writes to this machine's own store", () => {
    expect(importAtlasMeta.effect).toBe("local-state");
    expect(importAtlasMeta.doorRouted).toBe(false);
    expect(importAtlasMeta.createsWorkItem).toBe(false);
  });

  it("says a re-run converges, which is the property an operator needs before running it twice", () => {
    expect(importAtlasMeta.usage).toContain("Re-runnable");
    expect(importAtlasMeta.example).toBe("slopweaver store import-atlas --dry-run");
  });
});

describe("importOwnerTurnDumpMeta", () => {
  it("quotes the verb's own usage, naming only flags its parser accepts", () => {
    expect(importOwnerTurnDumpMeta.usage).toBe(IMPORT_OWNER_TURN_DUMP_USAGE);
    expect(flagsNamedIn({ usage: IMPORT_OWNER_TURN_DUMP_USAGE }).toSorted()).toEqual([
      "--dry-run",
      "--from",
      "--home",
      "--json",
    ]);
    expect(unwrap(parseImportOwnerTurnDumpArgs({ argv: ["--from", "/k/owner-tables.sql", "--dry-run"] })).dryRun).toBe(
      true,
    );
  });

  it("is local-state and undoored, because it writes to this machine's own store", () => {
    expect(importOwnerTurnDumpMeta.effect).toBe("local-state");
    expect(importOwnerTurnDumpMeta.doorRouted).toBe(false);
  });
});

describe("importFleetMeta", () => {
  it("names the verb's own flags and nothing the parser would refuse", () => {
    expect(flagsNamedIn({ usage: importFleetMeta.usage }).toSorted()).toEqual([
      "--adopt-unmatched-door-lines",
      "--codex-home",
      "--dictations",
      "--dry-run",
      "--home",
      "--json",
      "--only",
    ]);
  });

  it("advertises a usage its own parser accepts", () => {
    const parsed = parseImportFleetArgs({ argv: ["--only", "board", "--dry-run", "--json"] });
    expect(parsed.isOk()).toBe(true);
    const capturing = parseImportFleetArgs({
      argv: ["--only", "dictations", "--dictations", "/r", "--only", "codex-messages", "--codex-home", "/c"],
    });
    expect(unwrap(capturing).codexHome).toBe("/c");
    const adopting = parseImportFleetArgs({ argv: ["--only", "door", "--adopt-unmatched-door-lines", "--json"] });
    expect(unwrap(adopting).adoptUnmatchedDoorLines).toBe(true);
  });

  it("advertises every leg the parser accepts under --only, owner-turns included", () => {
    expect(importFleetMeta.usage).toContain(`[--only ${FLEET_LEGS.join("|")}]`);
    expect(FLEET_LEGS).toContain("owner-turns");
  });

  it("is local-state and undoored, the same posture as its sibling", () => {
    expect(importFleetMeta.effect).toBe("local-state");
    expect(importFleetMeta.doorRouted).toBe(false);
  });
});

describe("pagesImportMeta", () => {
  it("quotes the verb's own usage, naming only flags its parser accepts", () => {
    expect(pagesImportMeta.usage).toBe(PAGES_IMPORT_USAGE);
    expect(flagsNamedIn({ usage: PAGES_IMPORT_USAGE }).toSorted()).toEqual(["--dry-run", "--home", "--json"]);
    expect(unwrap(parsePagesImportArgs({ argv: ["--dry-run", "--home", "/h", "--json"] }))).toEqual({
      dryRun: true,
      home: "/h",
      json: true,
    });
  });

  it("is local-state and undoored, because it writes to this machine's own store and its own bucket", () => {
    expect(pagesImportMeta.effect).toBe("local-state");
    expect(pagesImportMeta.doorRouted).toBe(false);
    expect(pagesImportMeta.example).toBe("slopweaver store pages-import --dry-run");
  });
});

describe("the import rows sit together because they are one idea", () => {
  it("each opens no connection under --dry-run, and says so", () => {
    expect(importAtlasMeta.usage).toContain("without opening a connection");
    expect(importFleetMeta.usage).toContain("without opening a connection");
    expect(pagesImportMeta.usage).toContain("without opening a connection");
  });

  it("each refuses a parse without I/O, which is what lets --help be trusted", () => {
    expect(importAtlasMeta.parseRejectIsIoFree).toBe(true);
    expect(importFleetMeta.parseRejectIsIoFree).toBe(true);
    expect(pagesImportMeta.parseRejectIsIoFree).toBe(true);
  });
});
