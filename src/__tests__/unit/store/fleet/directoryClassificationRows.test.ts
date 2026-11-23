import { describe, expect, it } from "vitest";
import { AUTHORED_HOME_FILES, HOME_DIRECTORY_CLASSIFICATION } from "../../../../store/fleet/authoredDirectories.js";
import { AUTHORED_DIRECTORY_ROWS } from "../../../../store/fleet/authoredDirectoryRows.js";
import { exact } from "../../../../store/fleet/homeClassificationRow.js";
import { LIVE_CLASSIFICATION } from "../../../../store/fleet/liveClassification.js";
import {
  CREDENTIAL_DIRECTORY_ROWS,
  OTHER_CLASS_DIRECTORY_ROWS,
  SCRATCH_DIRECTORY_ROWS,
} from "../../../../store/fleet/unimportedDirectoryRows.js";

/*
 * The state-home classification is declared by section and composed in `authoredDirectories.ts`. These cases hold
 * what the split must keep: each section carries exactly its rows in table order, and the exported table is the
 * sections spread contiguously. `authoredFile.test.ts` holds the deepest-row behaviour over the composed table.
 */
describe("exact", () => {
  it("builds a non-prefix row carrying all three given fields", () => {
    expect(exact({ because: "why", directoryClass: "scratch", name: "a/b" })).toEqual({
      because: "why",
      directoryClass: "scratch",
      name: "a/b",
      prefix: false,
    });
  });
});

describe("AUTHORED_DIRECTORY_ROWS", () => {
  it("names the authored directories in table order, with the talk carve-out and the call journals after talk", () => {
    expect(AUTHORED_DIRECTORY_ROWS.length).toBeGreaterThan(0);
    expect(AUTHORED_DIRECTORY_ROWS.map((row) => row.name)).toEqual([
      "artifact-migration",
      "artifact-drafts",
      "artifacts",
      "briefing-shape-proof",
      "briefs",
      "claude-memory",
      "calendar",
      "cmux-relays",
      "design",
      "detective",
      "dogfood",
      "dotfile-backups",
      "drafts",
      "eval",
      "fixtures-pending",
      "footprint",
      "hand-steps",
      "handover-evidence",
      "handover-notes",
      "handovers",
      "handovers-backup-",
      "instruments",
      "judgement",
      "loop-state",
      "memory-deindexed-",
      "morning",
      "onboard-eval",
      "pr-forms",
      "probes",
      "profile",
      "prompts",
      "proposals",
      "queue",
      "registers",
      "rescued",
      "resume",
      "run-notes",
      "runs",
      "scratch-rescue",
      "sessions",
      "shots",
      "slices",
      "talk",
      "talk/attachments",
      "talk/threads",
      "teamready",
      "transcripts",
      "vanta",
      "vanta-group-snapshots",
      "visual-evidence",
      "worktree-bundles",
    ]);
  });

  it("keeps the two family-prefix rows and the two local-only talk carve-outs", () => {
    expect(AUTHORED_DIRECTORY_ROWS.filter((row) => row.prefix).map((row) => row.name)).toEqual([
      "handovers-backup-",
      "memory-deindexed-",
    ]);
    expect(AUTHORED_DIRECTORY_ROWS.filter((row) => row.directoryClass !== "authored").map((row) => row.name)).toEqual([
      "talk/attachments",
      "talk/threads",
    ]);
  });
});

describe("unimported sections", () => {
  it("scratch rows are the reproducible or dead directories, in table order", () => {
    expect(SCRATCH_DIRECTORY_ROWS.length).toBeGreaterThan(0);
    expect(SCRATCH_DIRECTORY_ROWS.map((row) => row.name)).toEqual([
      "agent-logs",
      "audit-scratch",
      "codex-plugin",
      "console",
      "desktop",
      "docs-site",
      "fanout",
      "logs",
      "machine",
      "notion-renders",
      "readings",
      "run-scratch",
      "scratch",
      "tmp",
    ]);
    expect(SCRATCH_DIRECTORY_ROWS.every((row) => row.directoryClass === "scratch")).toBe(true);
  });

  it("credential rows are the two token directories", () => {
    expect(CREDENTIAL_DIRECTORY_ROWS.length).toBeGreaterThan(0);
    expect(CREDENTIAL_DIRECTORY_ROWS.map((row) => row.name)).toEqual(["claude-accounts", "secrets"]);
    expect(CREDENTIAL_DIRECTORY_ROWS.every((row) => row.directoryClass === "credential")).toBe(true);
  });

  it("other-class rows are the directories a sibling migration owns, in table order", () => {
    expect(OTHER_CLASS_DIRECTORY_ROWS.length).toBeGreaterThan(0);
    expect(OTHER_CLASS_DIRECTORY_ROWS.map((row) => row.name)).toEqual([
      "atlas",
      "backups",
      "bakeoff",
      "codex-fallback",
      "corpus",
      "datadog",
      "datadog-shots",
      "evidence",
      "exec-store",
      "grants",
      "knowledge",
      "ledgers",
      "orchestration",
      "page-fragments",
      "page-sources",
      "page-src",
      "pages",
      "pages-src",
      "proof",
      "published-pages",
      "supervisor-scratch",
    ]);
    expect(OTHER_CLASS_DIRECTORY_ROWS.every((row) => row.directoryClass === "other-class")).toBe(true);
  });
});

describe("HOME_DIRECTORY_CLASSIFICATION", () => {
  it("is the top-level files then every section, spread contiguously and in order", () => {
    expect(AUTHORED_HOME_FILES.length).toBeGreaterThan(0);
    expect(LIVE_CLASSIFICATION.length).toBeGreaterThan(0);
    expect(HOME_DIRECTORY_CLASSIFICATION).toEqual([
      ...AUTHORED_HOME_FILES,
      ...AUTHORED_DIRECTORY_ROWS,
      ...SCRATCH_DIRECTORY_ROWS,
      ...CREDENTIAL_DIRECTORY_ROWS,
      ...OTHER_CLASS_DIRECTORY_ROWS,
      ...LIVE_CLASSIFICATION,
    ]);
  });
});
