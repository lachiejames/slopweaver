/**
 * `retiredSeatRowText` — the pure judgement of whether a board row is still the untouched one a seat registered,
 * and the bytes it reads once cancelled. The row's text is cut ONCE by the real `handover register` into a throwaway
 * home, then every case below runs on strings alone.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { retiredSeatRowText } from "../../../../../../cli/commands/automation/seatRetirementText.js";
import { runHandoverRegister } from "../../../../../../cli/commands/handover/askRowRun.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../../../../handover/doc.js";
import { parseLedger } from "../../../../../../handover/ledger.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { gitInTemp } from "../../../../../tempGitRepo.js";

const SLUG = "automations-seat-text-000";
const ASK = "Run 1 automation(s): slopweaver automation run-due --recipe resync-atlas-trelica --claim-id token-0003";
const WHY = "cmux spawn exited 4";
const EMPTY_JOURNAL = parseLedger({ text: "" });

let root = "";
let path = "";
let text = "";
let registerExit = -1;

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "seat-text-")));
  const checkout = join(root, "checkout");
  const home = join(root, "home");
  mkdirSync(checkout);
  mkdirSync(stateHomePaths({ home }).handovers, { recursive: true });
  gitInTemp({ args: ["init", "--quiet"], cwd: checkout });
  const argv = ["node", "slopweaver", "handover", "register", "--ask", ASK, "--dispatch", "--slug", SLUG];
  argv.push("--asked-iso", "2026-09-15T23:05:00.000Z", "--repo", checkout, "--home", home);
  registerExit = await runHandoverRegister(argv);
  path = join(stateHomePaths({ home }).handovers, `${SLUG}.md`);
  text = readFileSync(path, "utf8");
});

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

/** The refusal message `SeatRetirementErrors.notOurs` renders for `detail`. */
const notOurs = ({ detail }: { detail: string }): string =>
  `automation seat · ${SLUG} is no longer the untouched row this seat registered (${detail}), so it is left as it is`;

describe("retiredSeatRowText", () => {
  it("cuts its fixture row through the real handover register", () => {
    expect(registerExit).toBe(EXIT_OK);
  });

  it("cancels the untouched row and records why on it", () => {
    const retired = unwrap(retiredSeatRowText({ ask: ASK, journal: EMPTY_JOURNAL, path, slug: SLUG, text, why: WHY }));
    expect(parseHandoverDoc({ path, text: retired }).status).toBe("cancelled");
    expect(retired).toContain(
      'statusSummary: "Retired by its automation seat, no session opened: cmux spawn exited 4"',
    );
  });

  it("refuses a row whose journal carries a line", () => {
    const journal = parseLedger({
      text: `${JSON.stringify({ atIso: "2026-09-15T23:06:00.000Z", by: "a-chair", kind: "dispatched", target: "workspace:1" })}\n`,
    });
    const refused = retiredSeatRowText({ ask: ASK, journal, path, slug: SLUG, text, why: WHY });
    expect(unwrapErr(refused).message).toBe(
      notOurs({ detail: "its journal carries a line, so a chair or a session has touched it" }),
    );
  });

  it("refuses a row registered under another slug", () => {
    const refused = retiredSeatRowText({
      ask: ASK,
      journal: EMPTY_JOURNAL,
      path,
      slug: "automations-seat-other",
      text,
      why: WHY,
    });
    expect(unwrapErr(refused).code).toBe("SEAT_ROW_NOT_OURS");
  });

  it("refuses an ask that differs from the registered one by a single byte", () => {
    const refused = retiredSeatRowText({ ask: `${ASK} `, journal: EMPTY_JOURNAL, path, slug: SLUG, text, why: WHY });
    expect(unwrapErr(refused).message).toBe(notOurs({ detail: "its ask is not the one this seat registered" }));
  });

  it.each(["", "   ", "one\ntwo"])("refuses a reason that is not one non-empty line: %j", (why) => {
    const refused = retiredSeatRowText({ ask: ASK, journal: EMPTY_JOURNAL, path, slug: SLUG, text, why });
    expect(unwrapErr(refused).message).toBe(notOurs({ detail: "the retirement reason must be one non-empty line" }));
  });

  it("refuses a row that is already cancelled", () => {
    const cancelled = unwrap(
      retiredSeatRowText({ ask: ASK, journal: EMPTY_JOURNAL, path, slug: SLUG, text, why: WHY }),
    );
    const refused = retiredSeatRowText({
      ask: ASK,
      journal: EMPTY_JOURNAL,
      path,
      slug: SLUG,
      text: cancelled,
      why: WHY,
    });
    expect(unwrapErr(refused).message).toBe(
      notOurs({ detail: "it is a ask row at status cancelled, not a ready ask" }),
    );
  });
});
