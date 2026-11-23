/**
 * `slopweaver automation seat` end to end over a throwaway home: it claims every row it seats, opens one session
 * on the board row it wrote, releases its claims when it cannot, and steps past a row the ledger refuses.
 *
 * The two effectful edges, `register` and `openSession`, are injected as plain recording functions: what is
 * under test is which argv each is handed and what the claims file holds afterwards, and a recording
 * function observes that without writing a board row or opening a workspace. No mocks, per `testing.md`.
 */
import { chmodSync, existsSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { appendSignInProbe } from "../../../../../../browser/signInProbeStore.js";
import { runRecipeSeat } from "../../../../../../cli/commands/automation/seat.js";
import { unseatableSkipLine } from "../../../../../../cli/commands/automation/seatRefusals.js";
import {
  EXIT_DEFERRED,
  EXIT_ERROR,
  EXIT_EXPECTED_EMPTY,
  EXIT_OK,
  EXIT_USAGE,
} from "../../../../../../cli/exitCodes.js";
import { buildSettledRow } from "../../../../../../hand/row.js";
import { buildHandStep } from "../../../../../../hand/step.js";
import { appendHandRow } from "../../../../../../hand/store.js";
import { err, ok, type Result, unwrap } from "../../../../../../lib/result.js";
import { readSlotAttempt } from "../../../../../../live/automation/slotLedger.js";
import type { ResyncState } from "../../../../../../live/resync/outcome.js";
import { writeResyncState } from "../../../../../../live/resync/outcomeStore.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { COOLING_WHY, EXHAUSTED_WHY, resyncRow, SEAT_CHECKOUT, verbRunRow } from "./fixtures.js";
import { failFiring, holdOnDisk, homeWith, removeHomes, seatDeps } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("recipe seat", () => {
  it("claims every row it seats and opens one session on the board row it wrote", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = seatDeps();
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(deps.opened).toEqual([["automations-seat-token-00", "--model", "sonnet", "--home", home]]);
    const held = unwrap(
      readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-15T23:00:00.000Z" }),
    );
    expect(held!.holder).toBe("automations-seat-token-00");
  });

  // MEASURED on the first real seat: the board row carried no `repo:`, so `cmux spawn` refused
  // with "names no `repo:`, so there is nowhere to open a worktree in", and the claims already taken had to
  // be released. `vulnfix topup` measured the identical shape a day earlier.
  it("names the checkout on the board row, which is what `cmux spawn` cuts the worktree from", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = seatDeps();
    await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps,
    });
    const argv = deps.registered[0]!;
    expect(argv[argv.indexOf("--repo") + 1]).toBe(SEAT_CHECKOUT);
  });

  it("states no workspace for a seat, whose recipes may be the team's work and carry no workspace to read", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = seatDeps();
    await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps,
    });
    const argv = deps.registered[0]!;
    expect([argv.includes("--repo"), argv.includes("--workspace"), argv.includes("--workspace-because")]).toEqual([
      true,
      false,
      false,
    ]);
  });

  // MEASURED seating bump-fix-slopweaver: `handover register` refused the row as an unshaped ask
  // (no problem, options or lean), so no seat had opened since. A seat asks the owner to pick
  // nothing, which is what `--dispatch` declares; it carries no shape flag, and no `--branch` — `cmux spawn` cuts the slug.
  it("registers the board row as a dispatch, carrying no decision shape", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = seatDeps();
    await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps,
    });
    const argv = deps.registered[0]!;
    expect(argv.includes("--dispatch")).toBe(true);
    expect(
      argv.filter((word) =>
        [
          "--problem",
          "--options",
          "--lean",
          "--risk",
          "--blast-radius",
          "--still-real",
          "--finding",
          "--branch",
        ].includes(word),
      ),
    ).toEqual([]);
  });

  it("claims nothing and registers nothing when no checkout can be resolved", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = seatDeps({ checkout: err(["no declared main checkout has lachiejames/slopweaver as its `origin`"]) });
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(deps.registered).toEqual([]);
    expect(deps.opened).toEqual([]);
    expect(deps.diag[0]).toContain("no declared main checkout");
    // The firing is held in the slot ledger now, so "claims nothing" is asserted there: no attempt was opened.
    expect(existsSync(stateHomePaths({ home }).live.recipe.slotAttemptsDir)).toBe(false);
  });

  it("puts the claim token in the ask, which is the only way the seated session can run the row", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = seatDeps();
    await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps,
    });
    const ask = deps.registered[0]![deps.registered[0]!.indexOf("--ask") + 1]!;
    expect(ask).toContain("--claim-id token-0002-aaaa-bbbb-cccc-dddddddddddd");
  });

  it("seats nothing and exits 3 when every due row runs in the calling process", async () => {
    const home = homeWith({ rows: [verbRunRow()] });
    const deps = seatDeps();
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(deps.opened).toEqual([]);
    expect(deps.out[0]).toContain("nothing needs a session");
  });

  it("releases every claim it took when the spawn fails, so the row is not silently held", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = seatDeps({ spawnExitCode: EXIT_ERROR });
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(
      unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-15T23:00:00.000Z" })),
    ).toBe(null);
  });

  it("releases its claims and exits 4 when the spawn backoff deferred the spawn, so the row is still due", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = seatDeps({ spawnExitCode: EXIT_DEFERRED });
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_DEFERRED);
    expect(
      unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-15T23:00:00.000Z" })),
    ).toBe(null);
  });

  it("exits 1, not 4, when a deferred spawn's claim will not release, since that claim still holds the row", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const attemptsDir = stateHomePaths({ home }).live.recipe.slotAttemptsDir;
    const deps = seatDeps({ spawnExitCode: EXIT_DEFERRED });
    const deferring: typeof deps = {
      ...deps,
      openSession: () => {
        // The claim is on disk by now; a read-only directory refuses its removal.
        chmodSync(attemptsDir, 0o500);
        return Promise.resolve(EXIT_DEFERRED);
      },
    };
    try {
      const code = await runRecipeSeat({
        argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
        deps: deferring,
      });
      expect(code).toBe(EXIT_ERROR);
      expect(
        unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-15T23:00:00.000Z" }))!
          .recipeId,
      ).toBe("resync-atlas-trelica");
    } finally {
      chmodSync(attemptsDir, 0o700);
    }
  });

  it("releases its claims and opens nothing when the board row cannot be written", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = seatDeps({ registerExitCode: EXIT_ERROR });
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(deps.opened).toEqual([]);
    expect(
      unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-15T23:00:00.000Z" })),
    ).toBe(null);
  });

  it("claims nothing under --dry-run", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = seatDeps();
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--dry-run", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(deps.registered).toEqual([]);
    expect(deps.out[0]).toContain("would seat 1 row(s)");
  });

  // MEASURED: three `--limit 10` seats in one hour were each refused outright on the
  // cooling first row of their prefix, released every claim they had taken, and opened no session.
  it("seats the rows behind a cooling row instead of refusing the whole seat", async () => {
    const home = homeWith({
      rows: [
        resyncRow({ params: { argv: ["recipe", "resync", "--atlas", "github"] }, recipeId: "resync-atlas-github" }),
        resyncRow({ params: { argv: ["recipe", "resync", "--atlas", "trelica"] }, recipeId: "resync-atlas-trelica" }),
      ],
    });
    failFiring({ home, recipeId: "resync-atlas-github" });
    const deps = seatDeps();
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "1", "--model", "sonnet", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(deps.diag).toEqual([]);
    expect(deps.out).toEqual([
      `recipe resync-atlas-github · slot 2026-09-15T23:00:00.000Z · ${COOLING_WHY} · skipped, not seated`,
      "automation seat · automations-seat-token-00 seated on sonnet with 1 row(s): resync-atlas-trelica",
    ]);
    expect(
      unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-15T23:00:00.000Z" }))!.holder,
    ).toBe("automations-seat-token-00");
  });

  // A row that failed every attempt it gets is refused by the ledger exactly as a cooling one is, so seating
  // it took the whole seat down by the same path — and `resync-atlas-cloudflare` was already on attempt 2 of
  // 3 when the cooling half was written.
  it("seats the rows behind an EXHAUSTED row instead of refusing the whole seat", async () => {
    const home = homeWith({
      rows: [
        resyncRow({ params: { argv: ["recipe", "resync", "--atlas", "github"] }, recipeId: "resync-atlas-github" }),
        resyncRow({ params: { argv: ["recipe", "resync", "--atlas", "trelica"] }, recipeId: "resync-atlas-trelica" }),
      ],
    });
    failFiring({ attempts: 3, home, recipeId: "resync-atlas-github" });
    const deps = seatDeps();
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "1", "--model", "sonnet", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(deps.diag).toEqual([]);
    expect(deps.out).toEqual([
      `recipe resync-atlas-github · slot 2026-09-15T23:00:00.000Z · ${EXHAUSTED_WHY} · skipped, not seated`,
      "automation seat · automations-seat-token-00 seated on sonnet with 1 row(s): resync-atlas-trelica",
    ]);
  });

  // MEASURED: `resync-atlas-xero` stopped at go.xero.com's sign-in page and cooled for a day. The
  // wall now gives its attempt back, so the ledger alone would seat the row straight back into the same page.
  describe("a resync row that stopped at a sign-in page", () => {
    const WALL_ISO = "2026-09-15T22:30:00.000Z";
    const XERO = "https://go.xero.com";
    const DATADOG = "https://app.datadoghq.com";

    /** Two resync rows, the first of which last stopped at a sign-in page — Xero's unless another is named. */
    function walledHome({ origin = XERO }: { origin?: string } = {}): string {
      const home = homeWith({
        rows: [
          resyncRow({ params: { argv: ["recipe", "resync", "--atlas", "github"] }, recipeId: "resync-atlas-github" }),
          resyncRow({ params: { argv: ["recipe", "resync", "--atlas", "trelica"] }, recipeId: "resync-atlas-trelica" }),
        ],
      });
      const wall: ResyncState = {
        blocker: null,
        lastAttempt: {
          afterClock: null,
          beforeClock: "2026-09-15T00:00:00.000Z",
          exitCode: EXIT_DEFERRED,
          finishedAtIso: WALL_ISO,
          outcome: "failed",
          problems: [`stopped at ${new URL(origin).host}'s sign-in page`],
          recipeId: "resync-atlas-github",
          signInWall: origin,
          startedAtIso: "2026-09-15T22:29:00.000Z",
        },
        lastSuccessAtIso: null,
        recipeId: "resync-atlas-github",
      };
      unwrap(writeResyncState({ state: wall, stateDir: stateHomePaths({ home }).live.recipe.resyncStateDir }));
      return home;
    }

    /** Post the owner's Xero sign-in card, then settle it at an instant, exactly as their Done does. */
    async function settleSignIn({ home, settledIso }: { home: string; settledIso: string }): Promise<void> {
      const card = unwrap(
        buildHandStep({
          draft: {
            id: "mon-signin-go-xero-com",
            postedBy: "workspace:29",
            postedIso: "2026-09-15T21:00:00.000Z",
            unblocks: "resync-atlas-github",
            url: XERO,
            what: "Sign in to go.xero.com in your work Chrome, so its resync can read again",
            witness: "slopweaver hand done mon-signin-go-xero-com",
          },
        }),
      );
      unwrap(await appendHandRow({ home, nowIso: "2026-09-15T21:00:00.000Z", row: { kind: "posted", step: card } }));
      const settled = unwrap(
        buildSettledRow({
          draft: { bySession: "owner", did: "signed in to Xero", id: "mon-signin-go-xero-com", settledIso },
        }),
      );
      unwrap(await appendHandRow({ home, nowIso: settledIso, row: settled }));
    }

    /**
     * One real `--limit 1` seat.
     *
     * @param home the state home holding the rows, the wall and the owner's cards
     * @returns what the seat printed
     */
    async function seatOne({ home }: { home: string }): Promise<readonly string[]> {
      const deps = seatDeps();
      const code = await runRecipeSeat({
        argv: ["node", "slopweaver", "recipe", "seat", "--limit", "1", "--model", "sonnet", "--home", home],
        deps,
      });
      expect(code).toBe(EXIT_OK);
      return deps.out;
    }

    it("steps past it until the owner's sign-in card is settled, naming the card", async () => {
      expect(await seatOne({ home: walledHome() })).toEqual([
        "recipe resync-atlas-github · slot 2026-09-15T23:00:00.000Z · AWAITING SIGN-IN · stopped at go.xero.com's " +
          `sign-in page at ${WALL_ISO}; seated again the moment their card mon-signin-go-xero-com is settled · ` +
          "skipped, not seated",
        "automation seat · automations-seat-token-00 seated on sonnet with 1 row(s): resync-atlas-trelica",
      ]);
    });

    it("seats it on the next pass once the owner's card was settled after the wall", async () => {
      const home = walledHome();
      await settleSignIn({ home, settledIso: "2026-09-15T22:45:00.000Z" });
      expect(await seatOne({ home })).toEqual([
        "automation seat · automations-seat-token-00 seated on sonnet with 1 row(s): resync-atlas-github",
      ]);
    });

    it("still steps past it when the only Done the owner gave predates the wall", async () => {
      const home = walledHome();
      await settleSignIn({ home, settledIso: "2026-09-15T22:00:00.000Z" });
      expect((await seatOne({ home }))[0]).toContain("AWAITING SIGN-IN · stopped at go.xero.com's sign-in page");
    });

    // A Datadog or GitHub wall is the fleet's to press. The monitor holds its card, so a
    // seat waiting on that card would wait forever.
    it("seats a Datadog wall no look reached the owner's hands on, so the seated session presses it", async () => {
      const home = walledHome({ origin: DATADOG });
      expect(await seatOne({ home })).toEqual([
        "automation seat · automations-seat-token-00 seated on sonnet with 1 row(s): resync-atlas-github",
      ]);
    });

    it("waits on the owner's card once a fresh look found the Datadog step genuinely theirs", async () => {
      const home = walledHome({ origin: DATADOG });
      unwrap(
        appendSignInProbe({
          home,
          row: {
            atIso: "2026-09-15T22:50:00.000Z",
            page: `${DATADOG}/account/login`,
            provider: "datadog",
            verdict: "owner-hands",
            why: "app.datadoghq.com asks for a password, passkey or second factor",
          },
        }),
      );
      expect((await seatOne({ home }))[0]).toContain("AWAITING SIGN-IN · stopped at app.datadoghq.com's sign-in page");
    });
  });

  it("reports the cooling row under --dry-run exactly as the real seat does, and plans past it", async () => {
    const home = homeWith({
      rows: [resyncRow({ recipeId: "resync-atlas-github" }), resyncRow({ recipeId: "resync-atlas-trelica" })],
    });
    failFiring({ home, recipeId: "resync-atlas-github" });
    const deps = seatDeps();
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "10", "--model", "sonnet", "--dry-run", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(deps.out).toEqual([
      unseatableSkipLine({
        row: { recipeId: "resync-atlas-github", slotIso: "2026-09-15T23:00:00.000Z", why: COOLING_WHY },
      }),
      `automation seat · would seat 1 row(s) as automations-seat-token-00 in ${SEAT_CHECKOUT}: resync-atlas-trelica`,
    ]);
  });

  it("exits 3 and opens nothing when the ledger refuses every spawn-shaped row", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    failFiring({ home, recipeId: "resync-atlas-trelica" });
    const deps = seatDeps();
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(deps.registered).toEqual([]);
    expect(deps.out.at(-1)).toBe(
      "automation seat · nothing to seat now — the ledger refuses every actionable spawn-shaped row",
    );
  });

  // A sibling dispatcher's failure can hold a row between this seat's plan and its claim. That row is the
  // store working, so it is skipped and every other planned row is still seated.
  it("skips a row a failure held after the seat was planned, and seats the rest", async () => {
    const home = homeWith({
      rows: [
        resyncRow({ params: { argv: ["recipe", "resync", "--atlas", "github"] }, recipeId: "resync-atlas-github" }),
        resyncRow({ params: { argv: ["recipe", "resync", "--atlas", "trelica"] }, recipeId: "resync-atlas-trelica" }),
      ],
    });
    const recorded = seatDeps();
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps: {
        ...recorded,
        // Runs after the plan and before the claim — the window a sibling's failure lands in.
        checkoutFor: (): Result<string> => {
          holdOnDisk({ home, recipeId: "resync-atlas-github" });
          return ok(SEAT_CHECKOUT);
        },
      },
    });
    expect(code).toBe(EXIT_OK);
    expect(recorded.out[0]).toContain("recipe resync-atlas-github · HELD since this seat was planned, so not seated");
    expect(recorded.out[1]).toBe(
      "automation seat · automations-seat-token-00 seated on sonnet with 1 row(s): resync-atlas-trelica",
    );
    expect(
      unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-github", slotIso: "2026-09-15T23:00:00.000Z" })),
    ).toBe(null);
  });

  it("opens no session and exits 3 when every planned row was held before it could be claimed", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const recorded = seatDeps();
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps: {
        ...recorded,
        checkoutFor: (): Result<string> => {
          holdOnDisk({ home, recipeId: "resync-atlas-trelica" });
          return ok(SEAT_CHECKOUT);
        },
      },
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(recorded.registered).toEqual([]);
    expect(recorded.opened).toEqual([]);
    expect(recorded.out.at(-1)).toBe(
      "automation seat · every planned row was held before it could be claimed — nothing seated",
    );
  });

  it("refuses without --limit rather than picking a bound of its own", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = seatDeps();
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--model", "sonnet", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(deps.opened).toEqual([]);
  });
});
