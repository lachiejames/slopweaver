/**
 * A seat whose session does not open leaves NO seatable row carrying a token the ledger no longer holds.
 *
 * MEASURED on `bump-fix-slopweaver`: `cmux spawn` was
 * deferred by the spawn backoff (exit 4), the seat released its claim and left the row `ready`, a chair spawned it,
 * and `run-due` refused the seated session's token. These cases register a REAL row through `handover register` over
 * a throwaway home and a real `git init` checkout, inject only the spawn's exit, and read the row and the slot ledger
 * back off disk.
 */
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runRecipeSeat } from "../../../../../../cli/commands/automation/seat.js";
import { retireSeatRow } from "../../../../../../cli/commands/automation/seatRetirement.js";
import { SeatRetirementErrors } from "../../../../../../cli/commands/automation/seatRetirementErrors.js";
import { runHandoverRegister } from "../../../../../../cli/commands/handover/askRowRun.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../../../../handover/doc.js";
import { permanentRefusalOf } from "../../../../../../handover/permanentRefusal.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { readSlotAttempt } from "../../../../../../live/automation/slotLedger.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { gitInTemp } from "../../../../../tempGitRepo.js";
import { resyncRow } from "./fixtures.js";
import { homeWith, removeHomes, seatDeps } from "./harness.js";

const SLUG = "automations-seat-token-00";
const TOKEN = "token-0002-aaaa-bbbb-cccc-dddddddddddd";
const RECIPE = "resync-atlas-trelica";
const SLOT = "2026-09-15T23:00:00.000Z";

const checkouts: string[] = [];
afterEach(() => {
  removeHomes();
  checkouts.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A real git checkout `handover register --repo` accepts, removed after the case. */
function realCheckout(): string {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), "seat-checkout-")));
  checkouts.push(checkout);
  gitInTemp({ args: ["init", "--quiet"], cwd: checkout });
  return checkout;
}

/** Seat edges whose registrar is the REAL `handover register` and whose spawn answers `spawnExitCode`. */
function realRegisterDeps({ spawnExitCode }: { spawnExitCode: number }): ReturnType<typeof seatDeps> {
  const deps = seatDeps({ checkout: ok(realCheckout()), spawnExitCode });
  return {
    ...deps,
    register: ({ argv }) => {
      deps.registered.push(argv);
      return runHandoverRegister(["node", "slopweaver", "handover", "register", ...argv]);
    },
  };
}

/** The seat's row as the board reads it, and whether a spawn door refuses it. */
function rowOnDisk({ home }: { home: string }): { status: string; refusal: string | undefined; text: string } {
  const path = join(stateHomePaths({ home }).handovers, `${SLUG}.md`);
  const text = readFileSync(path, "utf8");
  const doc = parseHandoverDoc({ path, text });
  const refusal = permanentRefusalOf({ doc, events: [], rerunAllowed: false, unreadableLines: [] });
  return { refusal: refusal?.kind, status: doc.status, text };
}

const argvFor = ({ home }: { home: string }): readonly string[] => [
  "node",
  "slopweaver",
  "recipe",
  "seat",
  "--limit",
  "4",
  "--model",
  "sonnet",
  "--home",
  home,
];

describe("automation seat retires the row its refused spawn would have run", () => {
  it("cancels the row and releases the claim when the spawn backoff defers the spawn (exit 4)", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = realRegisterDeps({ spawnExitCode: EXIT_DEFERRED });
    const code = await runRecipeSeat({ argv: argvFor({ home }), deps });
    expect(code).toBe(EXIT_DEFERRED);
    const row = rowOnDisk({ home });
    expect(row.text).toContain(`--claim-id ${TOKEN}`);
    expect([row.status, row.refusal]).toEqual(["cancelled", "terminal-status"]);
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))).toBe(null);
    expect(deps.out).toContain(`automation seat · ${SLUG} cancelled — no session opened on it, so it is not seatable`);
  });

  it("cancels the row on any failed spawn, not only a deferred one, and exits 1", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = realRegisterDeps({ spawnExitCode: EXIT_ERROR });
    const code = await runRecipeSeat({ argv: argvFor({ home }), deps });
    expect(code).toBe(EXIT_ERROR);
    expect(rowOnDisk({ home }).status).toBe("cancelled");
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))).toBe(null);
  });

  it("leaves an opened seat's row ready and its claim held", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = realRegisterDeps({ spawnExitCode: EXIT_OK });
    const code = await runRecipeSeat({ argv: argvFor({ home }), deps });
    expect(code).toBe(EXIT_OK);
    expect([rowOnDisk({ home }).status, rowOnDisk({ home }).refusal]).toEqual(["ready", undefined]);
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.holderToken).toBe(TOKEN);
  });

  it("retires the row BEFORE it releases the claim, so a failed retirement never leaves a dead token", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const base = realRegisterDeps({ spawnExitCode: EXIT_DEFERRED });
    const heldAtRetirement: string[] = [];
    const deps: typeof base = {
      ...base,
      retireRow: (args) => {
        heldAtRetirement.push(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.holderToken);
        return retireSeatRow(args);
      },
    };
    await runRecipeSeat({ argv: argvFor({ home }), deps });
    expect(heldAtRetirement).toEqual([TOKEN]);
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))).toBe(null);
  });

  it("keeps the claim live and exits 1, not 4, when the row cannot be retired", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const base = realRegisterDeps({ spawnExitCode: EXIT_DEFERRED });
    const deps: typeof base = {
      ...base,
      retireRow: ({ slug }) => Promise.resolve(err(SeatRetirementErrors.io({ detail: "disk full", slug }))),
    };
    const code = await runRecipeSeat({ argv: argvFor({ home }), deps });
    expect(code).toBe(EXIT_ERROR);
    expect(rowOnDisk({ home }).status).toBe("ready");
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.holderToken).toBe(TOKEN);
    expect(deps.out.filter((line) => line.includes("claim released"))).toEqual([]);
    expect(deps.diag).toContain(`automation seat · could not retire ${SLUG}: disk full`);
  });

  it("releases the claim when the registrar failed and wrote no row, finding the slug absent", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = seatDeps({ registerExitCode: EXIT_ERROR });
    const code = await runRecipeSeat({ argv: argvFor({ home }), deps });
    expect(code).toBe(EXIT_ERROR);
    expect(deps.opened).toEqual([]);
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))).toBe(null);
  });
});

describe("retireSeatRow cancels only the untouched row the seat wrote", () => {
  /** A one-line seat-shaped ask carrying `--claim-id <token>`. */
  const askFor = ({ token }: { token: string }): string =>
    `Run 1 automation(s): slopweaver automation run-due --recipe ${RECIPE} --claim-id ${token}`;
  const OUR_ASK = askFor({ token: TOKEN });

  /** Register one seat-shaped row under {@link SLUG} with `ask`, through the real register. */
  async function registeredRow({ ask }: { ask: string }): Promise<string> {
    const home = homeWith({ rows: [] });
    mkdirSync(stateHomePaths({ home }).handovers, { recursive: true });
    const argv = ["node", "slopweaver", "handover", "register", "--ask", ask, "--dispatch", "--slug", SLUG];
    argv.push("--asked-iso", "2026-09-15T23:05:00.000Z", "--repo", realCheckout(), "--home", home);
    const code = await runHandoverRegister(argv);
    expect(code).toBe(EXIT_OK);
    return home;
  }

  it("refuses a row a chair has already dispatched, and leaves it ready", async () => {
    const home = await registeredRow({ ask: OUR_ASK });
    const runs = stateHomePaths({ home }).runs;
    mkdirSync(runs, { recursive: true });
    appendFileSync(
      join(runs, `${SLUG}.jsonl`),
      `${JSON.stringify({ atIso: "2026-09-15T23:06:00.000Z", by: "a-chair", kind: "dispatched", target: "workspace:1" })}\n`,
    );
    const retired = await retireSeatRow({ ask: OUR_ASK, home, slug: SLUG, why: "cmux spawn exited 4" });
    expect(unwrapErr(retired).message).toBe(
      `automation seat · ${SLUG} is no longer the untouched row this seat registered (a journal entry stands at ` +
        `${join(runs, `${SLUG}.jsonl`)}), so it is left as it is`,
    );
    expect(rowOnDisk({ home }).status).toBe("ready");
  });

  it("refuses a row whose journal is a dangling symlink, which the shared reader would read as empty", async () => {
    const home = await registeredRow({ ask: OUR_ASK });
    const runs = stateHomePaths({ home }).runs;
    mkdirSync(runs, { recursive: true });
    symlinkSync(join(home, "nowhere.jsonl"), join(runs, `${SLUG}.jsonl`));
    const retired = await retireSeatRow({ ask: OUR_ASK, home, slug: SLUG, why: "cmux spawn exited 4" });
    expect(unwrapErr(retired).code).toBe("SEAT_ROW_NOT_OURS");
    expect(rowOnDisk({ home }).status).toBe("ready");
  });

  it("refuses a row whose ask carries another seat's token", async () => {
    const home = await registeredRow({ ask: askFor({ token: "another-seats-token" }) });
    const retired = await retireSeatRow({ ask: OUR_ASK, home, slug: SLUG, why: "cmux spawn exited 4" });
    expect(unwrapErr(retired).code).toBe("SEAT_ROW_NOT_OURS");
    expect(rowOnDisk({ home }).status).toBe("ready");
  });

  it("refuses a row whose token sits only in its body, not in its ask", async () => {
    const home = await registeredRow({ ask: askFor({ token: "another-seats-token" }) });
    appendFileSync(join(stateHomePaths({ home }).handovers, `${SLUG}.md`), `\n<!-- --claim-id ${TOKEN} -->\n`);
    const retired = await retireSeatRow({ ask: OUR_ASK, home, slug: SLUG, why: "cmux spawn exited 4" });
    expect(unwrapErr(retired).code).toBe("SEAT_ROW_NOT_OURS");
    expect(rowOnDisk({ home }).status).toBe("ready");
  });

  // Each ask below carries the seat's own token and was accepted by one of the token parsers this check replaced:
  // a longer prefixed token, the token twice, the flag as a word's suffix,
  // and a shell-quoted second flag naming somebody else's token.
  it.each([
    askFor({ token: `${TOKEN}-extra` }),
    askFor({ token: `${TOKEN} --claim-id ${TOKEN}` }),
    `Run fake--claim-id ${TOKEN}`,
    `${OUR_ASK} "--claim-id" token-other`,
  ])("refuses a row whose ask is not byte for byte the seat's: %s", async (ask) => {
    const home = await registeredRow({ ask });
    const retired = await retireSeatRow({ ask: OUR_ASK, home, slug: SLUG, why: "cmux spawn exited 4" });
    expect(unwrapErr(retired).message).toBe(
      `automation seat · ${SLUG} is no longer the untouched row this seat registered (its ask is not the one this ` +
        `seat registered), so it is left as it is`,
    );
    expect(rowOnDisk({ home }).status).toBe("ready");
  });

  it("refuses a multi-line reason rather than writing it into the row", async () => {
    const home = await registeredRow({ ask: OUR_ASK });
    const retired = await retireSeatRow({ ask: OUR_ASK, home, slug: SLUG, why: "one\ntwo" });
    expect(unwrapErr(retired).code).toBe("SEAT_ROW_NOT_OURS");
    expect(rowOnDisk({ home }).status).toBe("ready");
  });

  it("records why on the cancelled row and introduces no settlement in the owner's name", async () => {
    const home = await registeredRow({ ask: OUR_ASK });
    expect(unwrap(await retireSeatRow({ ask: OUR_ASK, home, slug: SLUG, why: "cmux spawn exited 4" }))).toBe("retired");
    const text = rowOnDisk({ home }).text;
    expect(text).toContain('statusSummary: "Retired by its automation seat, no session opened: cmux spawn exited 4"');
    expect(text.includes("settlement")).toBe(false);
  });

  it("never reads an unsearchable board as an absent row", async () => {
    const home = await registeredRow({ ask: OUR_ASK });
    const board = stateHomePaths({ home }).handovers;
    chmodSync(board, 0o000);
    try {
      const retired = await retireSeatRow({ ask: OUR_ASK, home, slug: SLUG, why: "cmux spawn exited 4" });
      expect(unwrapErr(retired).code).toBe("SEAT_ROW_IO");
    } finally {
      chmodSync(board, 0o700);
    }
    expect(rowOnDisk({ home }).status).toBe("ready");
  });

  it("answers absent when no row stands under the slug", async () => {
    const home = homeWith({ rows: [] });
    expect(unwrap(await retireSeatRow({ ask: OUR_ASK, home, slug: SLUG, why: "cmux spawn exited 4" }))).toBe("absent");
  });
});
