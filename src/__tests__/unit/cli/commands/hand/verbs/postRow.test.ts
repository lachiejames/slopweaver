/**
 * `hand post --row` and `--supersedes`: a card names exactly one posting form, leaves the owner's queue when its board row
 * closes, and a re-cut replaces the card it supersedes, whole or not at all.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandList } from "../../../../../../cli/commands/hand/list.js";
import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
import { readOpenHandSteps } from "../../../../../../hand/store.js";
import { unwrap } from "../../../../../../lib/result.js";
import { freshHand, handHarness } from "./harness.js";

let home = "";
let out: string[] = [];
let diagnostics: string[] = [];
let commands: NoteCommand[] = [];
let looked: string[] = [];

const { deps, post, postAs } = handHarness({ state: () => ({ commands, diagnostics, home, looked, out }) });

beforeEach(() => {
  ({ commands, diagnostics, home, looked, out } = freshHand());
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("hand post — a card names its board row, and a re-cut replaces the card it supersedes", () => {
  const ROW = "store-backup-daily-stopped-firing-the-pass-643";

  /** A board doc for `slug` under the case's home, closed by its journal when `closed`. */
  function boardRow({ slug, closed }: { slug: string; closed: boolean }): void {
    mkdirSync(join(home, "handovers"), { recursive: true });
    mkdirSync(join(home, "runs"), { recursive: true });
    writeFileSync(join(home, "handovers", `${slug}.md`), `---\nslug: ${slug}\nstatus: ready\n---\n# doc\n`);
    if (closed) {
      writeFileSync(
        join(home, "runs", `${slug}.jsonl`),
        `${JSON.stringify({ atIso: "2026-09-27T05:04:35.000Z", kind: "closed", residue: [], summary: "merged" })}\n`,
      );
    }
  }

  /** A post with no posting form at all — neither --row nor --standalone. */
  function unclassified(): string[] {
    return [...post({ tail: ["--quiet", "--row", ROW] })].filter((arg) => arg !== "--row" && arg !== ROW);
  }

  it("refuses a post that names neither form, naming both flags, and writes nothing", async () => {
    expect(await runHandPost({ deps: deps(), rest: unclassified() })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain("with --row <slug>");
    expect(diagnostics[0]).toContain("or --standalone when no board row owns it");
    expect(existsSync(join(home, "hand-steps", "steps.jsonl"))).toBe(false);
  });

  it("refuses a post that names both forms", async () => {
    boardRow({ closed: false, slug: ROW });
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet", "--row", ROW, "--standalone"] }) })).toBe(
      EXIT_USAGE,
    );
    expect(diagnostics[0]).toBe(
      "hand post: --row and --standalone are the two posting forms — pass exactly one, never both",
    );
  });

  it("carries --row into what `hand list --json` publishes", async () => {
    boardRow({ closed: false, slug: ROW });
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet", "--row", ROW] }) })).toBe(EXIT_OK);
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!).row).toBe(ROW);
  });

  it("refuses a row that is not on the board, so a typo can never pin a card to the owner's queue", async () => {
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet", "--row", "store-backup-daliy"] }) })).toBe(
      EXIT_ERROR,
    );
    expect(diagnostics[0]).toContain(
      "hand post: --row store-backup-daliy: no doc carries the board row store-backup-daliy",
    );
  });

  it("refuses a row that is already finished", async () => {
    boardRow({ closed: true, slug: ROW });
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet", "--row", ROW] }) })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toBe(
      `hand post: --row ${ROW}: that row is already done, so there is nothing left for this step to unblock`,
    );
  });

  it("takes the card off `hand list` the moment its row closes, and says so on stderr", async () => {
    boardRow({ closed: false, slug: ROW });
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet", "--row", ROW] }) })).toBe(EXIT_OK);
    boardRow({ closed: true, slug: ROW });
    out = [];
    diagnostics = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(out).toEqual([]);
    expect(diagnostics).toEqual([
      "hand list: gcloud-signin left the owner's queue — the board row it named is finished",
    ]);
  });

  it("carries why a card has not left on the card itself when its row stops reading", async () => {
    boardRow({ closed: false, slug: ROW });
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet", "--row", ROW] }) })).toBe(EXIT_OK);
    rmSync(join(home, "handovers", `${ROW}.md`));
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!).rowProblem).toBe(`no doc carries the board row ${ROW}, live or archived`);
  });

  it("replaces a card with --supersedes and closes the old card's note", async () => {
    expect(await runHandPost({ deps: deps(), rest: postAs({ id: "iso-drafts", tail: ["--quiet"] }) })).toBe(EXIT_OK);
    out = [];
    expect(
      await runHandPost({
        deps: deps(),
        rest: postAs({ id: "iso-reply", tail: ["--quiet", "--supersedes", "iso-drafts"] }),
      }),
    ).toBe(EXIT_OK);
    expect(out[2]).toBe("  supersedes iso-drafts, settled on the same register line");
    expect(existsSync(join(home, "hand-steps", "dismiss", "iso-drafts.later"))).toBe(true);
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(out.map((line) => JSON.parse(line).id)).toEqual(["iso-reply"]);
  });

  it("retries a re-cut a crash cut short while its row is live, dropping the fragment and writing it whole", async () => {
    boardRow({ closed: false, slug: ROW });
    const recut = postAs({ id: "iso-reply", tail: ["--quiet", "--row", ROW, "--supersedes", "iso-drafts"] });
    expect(
      await runHandPost({ deps: deps(), rest: postAs({ id: "iso-drafts", tail: ["--quiet", "--row", ROW] }) }),
    ).toBe(EXIT_OK);
    expect(await runHandPost({ deps: deps(), rest: recut })).toBe(EXIT_OK);
    const register = join(home, "hand-steps", "steps.jsonl");
    // Past the trailing plain settling, into the re-cut line itself.
    const settling = readFileSync(register, "utf8").trim().split("\n").at(-1)!;
    truncateSync(register, statSync(register).size - settling.length - 1 - 12);
    expect(unwrap(readOpenHandSteps({ home })).steps.map((step) => step.id)).toEqual(["iso-drafts"]);
    out = [];
    expect(await runHandPost({ deps: deps(), rest: recut })).toBe(EXIT_OK);
    expect(out.filter((line) => line.startsWith("  dropped a cut-short"))).toHaveLength(1);
    expect(unwrap(readOpenHandSteps({ home })).steps.map((step) => step.id)).toEqual(["iso-reply"]);
  });

  it.each([
    ["finished", (): void => boardRow({ closed: true, slug: ROW })],
    ["gone from the board", (): void => rmSync(join(home, "handovers", `${ROW}.md`))],
  ])("refuses a cut-short re-cut's retry once its row is %s, leaving only the old card", async (_state, change) => {
    boardRow({ closed: false, slug: ROW });
    const recut = postAs({ id: "iso-reply", tail: ["--quiet", "--row", ROW, "--supersedes", "iso-drafts"] });
    expect(
      await runHandPost({ deps: deps(), rest: postAs({ id: "iso-drafts", tail: ["--quiet", "--row", ROW] }) }),
    ).toBe(EXIT_OK);
    expect(await runHandPost({ deps: deps(), rest: recut })).toBe(EXIT_OK);
    const register = join(home, "hand-steps", "steps.jsonl");
    // Past the trailing plain settling, into the re-cut line itself.
    const settling = readFileSync(register, "utf8").trim().split("\n").at(-1)!;
    truncateSync(register, statSync(register).size - settling.length - 1 - 12);
    const before = statSync(register).size;
    change();
    diagnostics = [];
    expect(await runHandPost({ deps: deps(), rest: recut })).toBe(EXIT_ERROR);
    expect(diagnostics[0]!.startsWith(`hand post: --row ${ROW}: `)).toBe(true);
    expect(statSync(register).size).toBe(before);
    expect(unwrap(readOpenHandSteps({ home })).steps.map((step) => step.id)).toEqual(["iso-drafts"]);
  });

  it("refuses --supersedes naming no open step, and posts nothing", async () => {
    expect(
      await runHandPost({
        deps: deps(),
        rest: postAs({ id: "iso-reply", tail: ["--quiet", "--supersedes", "iso-drafts"] }),
      }),
    ).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("no open hand step carries the id iso-drafts");
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(out).toEqual([]);
  });
});
