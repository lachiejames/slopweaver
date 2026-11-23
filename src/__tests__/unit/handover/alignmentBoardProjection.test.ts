import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { alignmentBoardProjectionOf } from "../../../cli/commands/handover/alignmentBoardRows.js";
import { boardJsonRow } from "../../../cli/commands/handover/listJson.js";
import {
  ALIGNMENT_BOARD_PROJECTION_SCHEMA_VERSION,
  type AlignmentBoardProjection,
  alignmentBoardWriteRefusal,
  parseAlignmentBoardProjection,
  renderAlignmentBoardDocument,
  renderAlignmentBoardProjection,
} from "../../../handover/alignmentBoardProjection.js";
import {
  readAlignmentBoardProjection,
  writeAlignmentBoardProjection,
} from "../../../handover/alignmentBoardProjectionStore.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const BUILT = "2026-10-25T18:00:00.000Z";
const SCAN_STARTED = "2026-10-25T17:59:40.000Z";
const PR = "https://github.com/slopweaver/slopweaver/pull/4242";

function doc({
  slug,
  status = "ready",
  summary = `what ${slug} does`,
  workspace,
  workspaceUnread,
}: {
  slug: string;
  status?: HandoverDoc["status"];
  summary?: string;
  workspace?: HandoverDoc["workspace"];
  workspaceUnread?: string;
}): HandoverDoc {
  return {
    anchor: undefined,
    artifact: undefined,
    askedIso: undefined,
    baseBranch: undefined,
    blastRadius: undefined,
    blockedBy: [],
    branch: undefined,
    doneWhen: [],
    evidence: [],
    exampleGap: undefined,
    examples: [],
    hisWords: { kind: "absent" },
    hisWordsSteers: [],
    kind: "doc",
    lean: undefined,
    notDoneReason: undefined,
    observedBy: undefined,
    options: [],
    origin: undefined,
    outputs: [],
    path: `/h/${slug}.md`,
    pausedOn: undefined,
    pausedSince: undefined,
    priority: undefined,
    probeWaiver: undefined,
    problem: undefined,
    problems: [],
    registeredBy: undefined,
    registeredRun: undefined,
    repo: "/w/repo",
    risk: undefined,
    role: undefined,
    ruling: undefined,
    rulingAnchor: undefined,
    settlement: undefined,
    settlementReason: undefined,
    settlementWitness: undefined,
    slug,
    status,
    statusSummary: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    summary,
    supervisorState: undefined,
    ...(workspace === undefined ? {} : { workspace }),
    ...(workspaceUnread === undefined ? {} : { workspaceUnread }),
  };
}

function modelsFor({ docs }: { docs: readonly HandoverDoc[] }): readonly BoardModel[] {
  return composeBoardModels({ journals: new Map(), probeStates: new Map(), resolutionDocs: docs, roots: docs });
}

const DOCS = [
  doc({ slug: "open-one", summary: `lands ${PR} today`, workspace: "self" }),
  doc({ slug: "closed-one", status: "done", workspace: "team" }),
  doc({ slug: "misspelt", workspaceUnread: "everlb" }),
];

function projection(): AlignmentBoardProjection {
  return alignmentBoardProjectionOf({
    builtAtIso: BUILT,
    models: modelsFor({ docs: DOCS }),
    scanStartedIso: SCAN_STARTED,
  });
}

describe("alignmentBoardProjectionOf", () => {
  it("projects every composed row, a closed one included, in board order", () => {
    expect(projection().rows.map((row) => row.slug)).toEqual(["open-one", "closed-one", "misspelt"]);
  });

  it("publishes each placement field exactly as `handover list --json` publishes it for the same row", () => {
    const models = modelsFor({ docs: DOCS });
    const projected = alignmentBoardProjectionOf({ builtAtIso: BUILT, models, scanStartedIso: SCAN_STARTED });
    const published = models.map((model) =>
      boardJsonRow({ model, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() }),
    );
    expect(projected.rows.map((row) => JSON.stringify(row))).toEqual(
      published.map((row) =>
        JSON.stringify({
          action: row.action,
          actionUnreadable: row.actionUnreadable,
          mailPreview: row.mailPreview,
          prUrls: row.prUrls,
          run: row.run,
          section: row.section,
          slug: row.slug,
          tags: row.tags,
          tagsIncomplete: row.tagsIncomplete,
          unrecognisedTags: row.unrecognisedTags,
          workspace: row.workspace,
          workspaceUnread: row.workspaceUnread,
        }),
      ),
    );
  });

  it("carries the closed row's own section and workspace, which is what an historical act joins", () => {
    const closed = projection().rows.find((row) => row.slug === "closed-one")!;
    expect([closed.section, closed.workspace, closed.run]).toEqual(["DONE", "team", "never-started"]);
  });

  it("carries the pull-request link the summary names and a misspelt workspace line", () => {
    const rows = projection().rows;
    expect(rows[0]!.prUrls).toEqual([PR]);
    expect(rows[2]!.workspaceUnread).toBe("everlb");
  });

  it("carries no summary, reason, question or path", () => {
    const text = renderAlignmentBoardProjection({ projection: projection() });
    expect(text).not.toContain("today");
    expect(text).not.toContain("/h/open-one.md");
    expect(text).toContain(PR);
  });
});

describe("parseAlignmentBoardProjection", () => {
  it("round-trips a rendered projection exactly", () => {
    const written = projection();
    const parsed = unwrap(
      parseAlignmentBoardProjection({ path: "/x", text: renderAlignmentBoardProjection({ projection: written }) }),
    );
    expect(renderAlignmentBoardProjection({ projection: parsed })).toBe(
      renderAlignmentBoardProjection({ projection: written }),
    );
    expect(parsed.rows.length).toBe(3);
    expect(parsed.schemaVersion).toBe(ALIGNMENT_BOARD_PROJECTION_SCHEMA_VERSION);
  });

  function rendered({ edit }: { edit: (value: Record<string, unknown>) => Record<string, unknown> }): string {
    const value = JSON.parse(renderAlignmentBoardProjection({ projection: projection() })) as Record<string, unknown>;
    return JSON.stringify(edit(value));
  }

  it("refuses a schema version it does not know", () => {
    const refused = unwrapErr(
      parseAlignmentBoardProjection({
        path: "/x",
        text: rendered({ edit: (value) => ({ ...value, schemaVersion: 3 }) }),
      }),
    );
    expect(refused.code).toBe("ALIGNMENT_BOARD_INVALID");
    expect(refused.message).toContain("schemaVersion");
  });

  /** The projection as a build from before the rename writes it: version 1, its workspaces in the old words. */
  function preRole({ rows }: { rows: readonly Record<string, unknown>[] }): string {
    return rendered({
      edit: (value) => {
        const written = value["rows"] as readonly Record<string, unknown>[];
        return { ...value, rows: written.map((row, index) => ({ ...row, ...rows[index] })), schemaVersion: 1 };
      },
    });
  }

  it("reads a version-1 file a stale seat wrote, its old words as the version 2 roles", () => {
    const text = preRole({ rows: [{ workspace: "slopweaver" }, { workspace: "acme" }, {}] });
    const parsed = unwrap(parseAlignmentBoardProjection({ path: "/x", text }));

    expect(parsed.schemaVersion).toBe(ALIGNMENT_BOARD_PROJECTION_SCHEMA_VERSION);
    expect(parsed.rows.map((row) => [row.slug, row.workspace, row.workspaceUnread])).toEqual([
      ["open-one", "self", undefined],
      ["closed-one", "team", undefined],
      ["misspelt", undefined, "everlb"],
    ]);
    expect(parsed.rows.map((row) => row.section)).toEqual(projection().rows.map((row) => row.section));
  });

  it("refuses a version-1 file holding a role as unread, since that build placed the row as a problem", () => {
    const text = preRole({
      rows: [{ workspace: "slopweaver" }, { workspace: undefined, workspaceUnread: "team" }, {}],
    });
    const refused = unwrapErr(parseAlignmentBoardProjection({ path: "/x", text }));

    expect(refused.code).toBe("ALIGNMENT_BOARD_INVALID");
    expect(refused.message).toContain("rows.1.workspaceUnread names a role a version-1 build placed as a problem");
  });

  it("refuses a version-1 file whose stated workspace is a role, which that build never wrote", () => {
    const refused = unwrapErr(parseAlignmentBoardProjection({ path: "/x", text: preRole({ rows: [{}] }) }));

    expect(refused.code).toBe("ALIGNMENT_BOARD_INVALID");
    expect(refused.message).toContain("rows.0.workspace");
  });

  it("refuses a builtAtIso that is not a canonical instant", () => {
    const parsed = parseAlignmentBoardProjection({
      path: "/x",
      text: rendered({ edit: (value) => ({ ...value, builtAtIso: "yesterday" }) }),
    });
    expect(unwrapErr(parsed).message).toContain("builtAtIso is not a canonical toISOString() instant");
  });

  it("refuses the whole file for one malformed row rather than dropping it", () => {
    const parsed = parseAlignmentBoardProjection({
      path: "/x",
      text: rendered({
        edit: (value) => {
          const rows = value["rows"] as Record<string, unknown>[];
          return { ...value, rows: [rows[0], { ...rows[1], tags: "context=acme" }, rows[2]] };
        },
      }),
    });
    expect(unwrapErr(parsed).code).toBe("ALIGNMENT_BOARD_INVALID");
    expect(unwrapErr(parsed).message).toContain("rows.1.tags");
  });

  it("refuses a mail preview missing its digest", () => {
    const parsed = parseAlignmentBoardProjection({
      path: "/x",
      text: rendered({
        edit: (value) => {
          const rows = value["rows"] as Record<string, unknown>[];
          return { ...value, rows: [{ ...rows[0], mailPreview: { url: "http://x" } }] };
        },
      }),
    });
    expect(unwrapErr(parsed).message).toContain("rows.0.mailPreview.digest");
  });

  it("refuses text that is not JSON, naming the file", () => {
    const parsed = parseAlignmentBoardProjection({ path: "/h/alignment-board.json", text: "{" });
    expect(unwrapErr(parsed).message).toBe(
      "the Alignment board projection at /h/alignment-board.json will not read (invalid JSON)",
    );
  });
});

describe("renderAlignmentBoardDocument", () => {
  it("prints the projection with where it was served from", () => {
    const printed = JSON.parse(renderAlignmentBoardDocument({ projection: projection(), servedFrom: "cache" })) as {
      servedFrom: string;
      builtAtIso: string;
      observedAtIso: string;
      rows: unknown[];
    };
    expect([printed.servedFrom, printed.builtAtIso, printed.observedAtIso, printed.rows.length]).toEqual([
      "cache",
      BUILT,
      BUILT,
      3,
    ]);
  });
});

describe("alignmentBoardWriteRefusal", () => {
  const whole = {
    base: undefined,
    defaultHandoverDir: "/home/handovers",
    handoverDir: "/home/handovers",
    runCommands: false,
    tagTerms: 0,
    unreadJournals: 0,
    unreadable: 0,
    unresolved: 0,
  };

  it("lets the whole default board write", () => {
    expect(alignmentBoardWriteRefusal(whole)).toBe(undefined);
  });

  it("refuses a custom directory, a tag filter, a base override and --probe", () => {
    expect([
      alignmentBoardWriteRefusal({ ...whole, handoverDir: "/elsewhere" }),
      alignmentBoardWriteRefusal({ ...whole, tagTerms: 1 }),
      alignmentBoardWriteRefusal({ ...whole, base: "develop" }),
      alignmentBoardWriteRefusal({ ...whole, runCommands: true }),
    ]).toEqual([
      "it scanned /elsewhere, not the home's own /home/handovers",
      "--tag narrowed it to a subset of the board",
      "--base develop counted commits against a branch the console's read does not",
      "--probe ran command: probes the console's read does not",
    ]);
  });

  it("refuses a cut sweep, an unreadable doc and an unread journal", () => {
    expect([
      alignmentBoardWriteRefusal({ ...whole, unresolved: 3 }),
      alignmentBoardWriteRefusal({ ...whole, unreadable: 1 }),
      alignmentBoardWriteRefusal({ ...whole, unreadJournals: 2 }),
    ]).toEqual([
      "the probe sweep left 3 doc(s) unresolved",
      "1 doc file(s) would not read",
      "2 journal(s) no doc claims would not read whole",
    ]);
  });
});

describe("the projection store", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  function home(): string {
    const dir = mkdtempSync(join(tmpdir(), "sw-align-"));
    dirs.push(dir);
    return dir;
  }

  it("names a missing file as missing, never as an empty board", () => {
    const path = join(home(), "alignment-board.json");
    expect(unwrapErr(readAlignmentBoardProjection({ path })).code).toBe("ALIGNMENT_BOARD_MISSING");
  });

  it("writes atomically and reads the same projection back", () => {
    const path = join(home(), "nested", "alignment-board.json");
    expect(unwrap(writeAlignmentBoardProjection({ path, projection: projection() }))).toBe(path);
    expect(unwrap(readAlignmentBoardProjection({ path })).rows.map((row) => row.slug)).toEqual([
      "open-one",
      "closed-one",
      "misspelt",
    ]);
  });

  it("names a corrupt file as invalid", () => {
    const path = join(home(), "alignment-board.json");
    writeFileSync(path, "not json");
    expect(unwrapErr(readAlignmentBoardProjection({ path })).code).toBe("ALIGNMENT_BOARD_INVALID");
  });
});
