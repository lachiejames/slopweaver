/**
 * The staged list a close binds by digest: a resumed close renders `tick-<n>/run.json` only while it still holds
 * the bytes its committed stages were decided against, never whatever regular file now sits there — a rewrite or
 * a hard link to another file is refused at the resume and before every commit stage, and the render reads a private
 * copy of the bound bytes, never the tick's path.
 */
import { chmodSync, existsSync, linkSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { commitClose } from "../../../../../../cli/commands/supervisor/tickCloseCommit.js";
import { renderBoundPage } from "../../../../../../cli/commands/supervisor/tickClosePage.js";
import { prepareClose } from "../../../../../../cli/commands/supervisor/tickClosePrepare.js";
import { readClose } from "../../../../../../cli/commands/supervisor/tickCloseRead.js";
import { preparedUnchanged } from "../../../../../../cli/commands/supervisor/tickCloseRecheck.js";
import {
  boundListBytes,
  listReplacedLine,
  refreshList,
} from "../../../../../../cli/commands/supervisor/tickCloseRefresh.js";
import type { ProposedForm } from "../../../../../../cli/commands/supervisor/tickCloseRender.js";
import type { TickCloseArgs } from "../../../../../../cli/commands/supervisor/tickCore.js";
import { runSupervisorTick } from "../../../../../../cli/commands/supervisor/tickRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { sha256Hex } from "../../../../../../lib/hash.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { TickWorkflowErrors } from "../../../../../../supervisor/tickWorkflowErrors.js";
import { FORM, HANDED_TEXT, NOT_READ, REFRESHED_TEXT } from "../tickFixtures.js";
import { dir, fake, root, seatAndOpen, useWorkdir } from "./harness.js";

useWorkdir();

/** What the fake refresh child stages: the smallest document a refresh accepts as a session-start run. */
const STAGED = REFRESHED_TEXT;

/** A list that is not the one the close staged. */
const REPLACEMENT = '{"nowIso":"2026-09-23T15:00:00.000Z","replaced":true}';

/** A swept form a stranded close never reads: its form stage is already done, so it renders the seat's own. */
const PROPOSAL: ProposedForm = { countArchive: { earlierNotes: [], form: FORM, historySections: [] }, swept: FORM };

/**
 * A `tick close` invocation of the seat under test.
 *
 * @returns the parsed arguments
 */
function closeArgs({ yourList }: { yourList?: string } = {}): TickCloseArgs {
  return { bin: undefined, dir, home: undefined, subaction: "close", tick: undefined, yourList };
}

/**
 * The tick's staged list path.
 *
 * @returns the path
 */
function stagedPath(): string {
  return join(dir, "tick-1", "run.json");
}

/**
 * The tick's parsed close state.
 *
 * @returns the state document
 */
function closeState(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "tick-1", "close-state.json"), "utf8")) as Record<string, unknown>;
}

/**
 * Seat, open, and run a first close that commits its form and snapshots, then fails to publish.
 *
 * @param refreshFails whether the refresh child fails, so the close commits on the seat's own list
 * @returns nothing
 */
async function strandedClose({ refreshFails = false }: { refreshFails?: boolean } = {}): Promise<void> {
  await seatAndOpen();
  const first = fake({ publishFails: true, refreshFails });
  expect(await runSupervisorTick({ deps: first.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
}

describe("a close binds the list it staged by digest", () => {
  it("records the staged list's digest with the first stage", async () => {
    await strandedClose();

    expect(closeState()["schemaVersion"]).toBe(2);
    expect(closeState()["listSha256"]).toBe(sha256Hex({ bytes: STAGED }));
  });

  it("records null when the close rendered the seat's own list", async () => {
    await strandedClose({ refreshFails: true });

    expect(closeState()["listSha256"]).toBe(null);
  });

  it("refuses to resume over a staged list rewritten since the close committed, publishing nothing", async () => {
    await strandedClose();
    writeFileSync(stagedPath(), REPLACEMENT);
    const run = fake();

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(run.diagnostics.join("\n")).toContain(
      `${stagedPath()}: this close already committed a stage against the list with sha256 ` +
        `${sha256Hex({ bytes: STAGED }).slice(0, 12)}, and the list staged now is ` +
        sha256Hex({ bytes: REPLACEMENT }).slice(0, 12),
    );
    expect(run.renders).toEqual([]);
    expect(run.published).toEqual([]);
    expect(run.appended).toEqual([]);
  });

  it("refuses to resume over a hard link put in the staged list's place", async () => {
    await strandedClose();
    const elsewhere = join(root, "another-list.json");
    writeFileSync(elsewhere, REPLACEMENT);
    rmSync(stagedPath());
    linkSync(elsewhere, stagedPath());
    const run = fake();
    const read = unwrap(readClose({ args: closeArgs(), deps: run.deps }));
    const refused = unwrapErr(await refreshList({ args: closeArgs(), deps: run.deps, read }));

    expect(refused.code).toBe("PREFLIGHT_REFUSED");
    expect(JSON.stringify(refused)).toContain(sha256Hex({ bytes: REPLACEMENT }).slice(0, 12));
    expect(run.launched).toEqual([]);
  });

  it("refreshes a close that committed on the seat's own list, and binds the fresh list from then on", async () => {
    await strandedClose({ refreshFails: true });
    const run = fake({ publishFails: true });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(run.launched).toContain("session-start");
    expect(closeState()["listSha256"]).toBe(sha256Hex({ bytes: STAGED }));
    writeFileSync(stagedPath(), REPLACEMENT);
    const third = fake();

    expect(await runSupervisorTick({ deps: third.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(third.published).toEqual([]);
  });

  it("closes on the list the overrun route hands back after a close committed on the seat's own list", async () => {
    await strandedClose({ refreshFails: true });
    const handed = join(root, "handed.json");
    writeFileSync(handed, HANDED_TEXT);
    const run = fake();

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir, "--your-list", handed] })).toBe(
      EXIT_OK,
    );
    expect(run.renderedLists).toEqual([HANDED_TEXT]);
    expect(run.published).toEqual(["<p>the page</p>"]);
    expect(closeState()["listSha256"]).toBe(sha256Hex({ bytes: HANDED_TEXT }));
    // The stated residue: `snapshots-resolved` was done on the seat's list, so the fresh one is never promoted.
    expect(existsSync(join(dir, "run.json"))).toBe(false);
  });

  it("keeps a seat-list close's null record once its page is published, never naming a list no page showed", async () => {
    await strandedClose({ refreshFails: true });
    const statePath = join(dir, "tick-1", "close-state.json");
    const published = { ...closeState(), done: ["form-committed", "snapshots-resolved", "page-published"] };
    writeFileSync(statePath, JSON.stringify({ ...published, pageUrl: "http://localhost/fleet-briefing" }));
    const handed = join(root, "handed.json");
    writeFileSync(handed, HANDED_TEXT);
    const run = fake();

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir, "--your-list", handed] })).toBe(
      EXIT_OK,
    );
    expect(run.published).toEqual([]);
    expect(closeState()["done"]).toEqual(["form-committed", "snapshots-resolved", "page-published", "tick-recorded"]);
    expect(closeState()["listSha256"]).toBe(null);
  });

  it("renders the bound bytes even when a list is swapped in before the render opens it and restored after", async () => {
    await strandedClose();
    const seen: string[] = [];
    const run = fake({
      render: ({ argv }) => {
        writeFileSync(stagedPath(), REPLACEMENT);
        seen.push(readFileSync(argv[argv.indexOf("--your-list") + 1]!, "utf8"));
        writeFileSync(stagedPath(), STAGED);
        const outPath = argv[argv.indexOf("--out") + 1]!;
        return Promise.resolve({
          diagnostics: [],
          exitCode: EXIT_OK,
          pages: new Map([[outPath, "<p>the page</p>"]]),
          refusalCode: undefined,
        });
      },
    });
    const read = unwrap(readClose({ args: closeArgs(), deps: run.deps }));
    const home = run.deps.defaultHome();
    const page = unwrap(await renderBoundPage({ args: closeArgs(), deps: run.deps, home, proposal: PROPOSAL, read }));

    const handed = run.renders[0]![run.renders[0]!.indexOf("--your-list") + 1]!;
    expect(seen).toEqual([STAGED]);
    expect(run.renders[0]!.includes(stagedPath())).toBe(false);
    // A private directory inside tick-1/, the one place a resume already writes, removed once the render returned.
    expect(dirname(dirname(handed))).toBe(join(dir, "tick-1"));
    expect(existsSync(dirname(handed))).toBe(false);
    expect(page).toEqual({
      archive: undefined,
      formAfter: readFileSync(join(dir, "form.json"), "utf8"),
      html: "<p>the page</p>",
      listSha256: sha256Hex({ bytes: STAGED }),
      refreshed: true,
    });
  });

  it("renders a bound list under a read-only seat directory, writing only inside the tick's own", async () => {
    await strandedClose();
    const run = fake();
    const read = unwrap(readClose({ args: closeArgs(), deps: run.deps }));
    chmodSync(dir, 0o500);
    try {
      const page = unwrap(
        await renderBoundPage({
          args: closeArgs(),
          deps: run.deps,
          home: run.deps.defaultHome(),
          proposal: PROPOSAL,
          read,
        }),
      );

      expect(page.html).toBe("<p>the page</p>");
      expect(run.renderedLists).toEqual([STAGED]);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it("refuses, rather than throwing, when the tick's directory cannot hold the private copy", async () => {
    await strandedClose();
    const run = fake();
    const read = unwrap(readClose({ args: closeArgs(), deps: run.deps }));
    const tickDir = join(dir, "tick-1");
    chmodSync(tickDir, 0o500);
    try {
      const refused = unwrapErr(
        await renderBoundPage({
          args: closeArgs(),
          deps: run.deps,
          home: run.deps.defaultHome(),
          proposal: PROPOSAL,
          read,
        }),
      );

      expect(refused.code).toBe("PREFLIGHT_REFUSED");
      expect(JSON.stringify(refused)).toContain(`${tickDir}: could not make a private copy of the bound list (EACCES`);
      expect(run.renders).toEqual([]);
    } finally {
      chmodSync(tickDir, 0o700);
    }
  });

  it("refuses to commit a staged list replaced after the close prepared, writing no state", async () => {
    await seatAndOpen();
    const run = fake();
    const prepared = unwrap(await prepareClose({ args: closeArgs(), deps: run.deps }));
    expect(prepared.listSha256).toBe(sha256Hex({ bytes: STAGED }));
    writeFileSync(stagedPath(), REPLACEMENT);

    expect(await commitClose({ deps: run.deps, evidence: NOT_READ, prepared })).toBe(EXIT_ERROR);
    expect(run.diagnostics.join("\n")).toContain(`${stagedPath()} is no longer the list this close bound`);
    expect(existsSync(join(dir, "tick-1", "close-state.json"))).toBe(false);
    expect(existsSync(join(dir, "run.json"))).toBe(false);
    expect(run.published).toEqual([]);
  });
});

describe("the two checks that hold the bound list", () => {
  it("boundListBytes hands back the bound bytes, and names a replaced list with both digests", async () => {
    await seatAndOpen();
    writeFileSync(stagedPath(), HANDED_TEXT);
    const bound = sha256Hex({ bytes: HANDED_TEXT });

    expect(unwrap(boundListBytes({ listSha256: bound, path: stagedPath() })).toString("utf8")).toBe(HANDED_TEXT);
    writeFileSync(stagedPath(), REPLACEMENT);
    expect(unwrapErr(boundListBytes({ listSha256: bound, path: stagedPath() }))).toBe(
      listReplacedLine({ bound, now: sha256Hex({ bytes: REPLACEMENT }), path: stagedPath() }),
    );
  });

  it("preparedUnchanged passes a just-prepared close, and names the staged list once it is replaced", async () => {
    await seatAndOpen();
    const prepared = unwrap(await prepareClose({ args: closeArgs(), deps: fake().deps }));
    const bound = sha256Hex({ bytes: STAGED });

    expect(preparedUnchanged({ prepared }).isOk()).toBe(true);
    writeFileSync(stagedPath(), REPLACEMENT);
    expect(unwrapErr(preparedUnchanged({ prepared }))).toEqual(
      TickWorkflowErrors.preflightRefused({
        reasons: [listReplacedLine({ bound, now: sha256Hex({ bytes: REPLACEMENT }), path: stagedPath() })],
        stage: "the staged list",
      }),
    );
  });
});
