/**
 * Unit: `fathom clear-inbox` — which Fathom inbox mail is archived, which is kept and why, and that a failed ingest
 * archives nothing. The mails are literals, the edges plain fakes over a throwaway home, the archive a recorder.
 *
 * The owner's rule is to archive these mails, but only once the transcripts are actually ingested — so what is
 * pinned is the ORDER: proven held, then archived.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearInboxLines, fathomInboxPlan } from "../../../../../cli/commands/fathom/clearInboxCore.js";
import { type FathomArchiveEdge, runFathomClearInbox } from "../../../../../cli/commands/fathom/clearInboxRun.js";
import type { FathomMail } from "../../../../../cli/commands/fathom/discoverCore.js";
import type { FathomShareDeps } from "../../../../../cli/commands/fathom/shareCore.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";

const A = "ePiRerJ33vCHFeZ1c5dDfMcAniBsMiYm";
const B = "3PMAimxXNiHo_28zAZ33f7ygsVkJCzsx";

/** One synthetic Fathom mail carrying the given share tokens. */
function mail({
  id,
  tokens,
  inInbox = true,
}: {
  id: string;
  tokens: readonly string[];
  inInbox?: boolean;
}): FathomMail {
  return {
    id,
    inInbox,
    sentAtIso: "2026-09-23T01:49:01.000Z",
    subject: "a recap",
    texts: ["View recap", ...tokens.map((token) => `https://fathom.video/share/${token}?utm_source=email`)],
  };
}

describe("fathomInboxPlan", () => {
  it("archives an inbox mail only when every share link it carries is held", () => {
    const plan = fathomInboxPlan({
      held: new Set([A]),
      mails: [mail({ id: "held", tokens: [A] }), mail({ id: "half", tokens: [A, B] })],
    });
    expect(plan).toEqual({
      archive: ["held"],
      kept: [{ id: "half", reason: `share link(s) not held yet: ${B}` }],
    });
  });

  it("keeps a mail carrying no share link, because no meeting can be proven held for it", () => {
    expect(fathomInboxPlan({ held: new Set([A]), mails: [mail({ id: "bare", tokens: [] })] })).toEqual({
      archive: [],
      kept: [
        { id: "bare", reason: "carries no share link, so the Fathom integration cannot prove it holds this meeting" },
      ],
    });
  });

  it("does nothing with mail already out of the inbox", () => {
    expect(
      fathomInboxPlan({ held: new Set([A]), mails: [mail({ id: "archived", inInbox: false, tokens: [A] })] }),
    ).toEqual({ archive: [], kept: [] });
  });
});

describe("clearInboxLines", () => {
  const plan = { archive: ["m1", "m2"], kept: [{ id: "m3", reason: "carries no share link" }] };

  it("says what it archives and what it keeps", () => {
    expect(clearInboxLines({ dryRun: false, plan, withheld: undefined })).toEqual([
      "fathom clear-inbox — 3 Fathom mail(s) in the inbox",
      "  archiving 2, every share link held: m1 m2",
      "  kept m3: carries no share link",
    ]);
  });

  it("says it archived nothing, and why, when the ingest failed", () => {
    expect(clearInboxLines({ dryRun: false, plan, withheld: "the ingest pass failed" })[1]).toBe(
      "  archived NOTHING: the ingest pass failed",
    );
  });
});

describe("runFathomClearInbox", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "fathom-clear-inbox-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Run the verb over literal mail, a fixed held set, a page reader and a recording archive edge. */
  async function run({
    mails,
    held,
    readPage,
    rest = [],
  }: {
    mails: readonly FathomMail[];
    held: ReadonlySet<string>;
    readPage: FathomShareDeps["readPage"];
    rest?: readonly string[];
  }): Promise<{ code: number; archived: (readonly string[])[]; dryRuns: boolean[] }> {
    const archived: (readonly string[])[] = [];
    const dryRuns: boolean[] = [];
    const archive: FathomArchiveEdge = async ({ ids, dryRun }) => {
      archived.push(ids);
      dryRuns.push(dryRun);
      return EXIT_OK;
    };
    const code = await runFathomClearInbox({
      archive,
      deps: {
        fathomMail: async () =>
          ok({ coverage: { matchingEstimate: mails.length, more: false, read: mails.length }, mails }),
        heldTokens: () => ok(held),
      },
      rest: ["--home", home, ...rest],
      shareDeps: { readPage, storeLeg: async () => ok({ retired: 0, stored: 0 }) },
    });
    return { archived, code, dryRuns };
  }

  const unreadable: FathomShareDeps["readPage"] = async () => err(["the page did not load"]);

  it("archives exactly the inbox mail whose share links are all held", async () => {
    const result = await run({
      held: new Set([A]),
      mails: [mail({ id: "held", tokens: [A] }), mail({ id: "bare", tokens: [] })],
      readPage: unreadable,
    });
    expect(result).toEqual({ archived: [["held"]], code: EXIT_OK, dryRuns: [false] });
  });

  it("archives NOTHING when a share link could not be ingested, even mail whose link was already held", async () => {
    const result = await run({
      held: new Set([A]),
      mails: [mail({ id: "held", tokens: [A] }), mail({ id: "new", tokens: [B] })],
      readPage: unreadable,
    });
    expect(result).toEqual({ archived: [], code: EXIT_ERROR, dryRuns: [] });
  });

  it("ingests nothing on --dry-run and hands the archive edge the dry-run flag", async () => {
    const result = await run({
      held: new Set([A]),
      mails: [mail({ id: "held", tokens: [A] }), mail({ id: "new", tokens: [B] })],
      readPage: unreadable,
      rest: ["--dry-run"],
    });
    expect(result).toEqual({ archived: [["held"]], code: EXIT_OK, dryRuns: [true] });
  });

  it("exits 3 when no Fathom mail is in the inbox", async () => {
    const result = await run({
      held: new Set([A]),
      mails: [mail({ id: "archived", inInbox: false, tokens: [A] })],
      readPage: unreadable,
    });
    expect(result).toEqual({ archived: [], code: EXIT_EXPECTED_EMPTY, dryRuns: [] });
  });
});
