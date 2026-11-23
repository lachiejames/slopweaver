/**
 * The courier's boot-refusal pass over a throwaway home: one wake per open register card, claimed before the
 * keystroke, its cause read off a fresh register read, released only when nothing was typed — and nothing typed for a
 * register that reads, or for a card already claimed.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildHandStep } from "../../../hand/step.js";
import { appendHandRow } from "../../../hand/store.js";
import { err, ok, type Result, unwrap } from "../../../lib/result.js";
import { type PlanRegisterError, PlanRegisterErrors } from "../../../plans/errors.js";
import {
  bootRefusalCauseOf,
  bootRefusalClaimPath,
  bootRefusalWakeReportLine,
  wakeChairForBootRefusal,
} from "../../../talk/bootRefusalWakeShell.js";
import type { Delivery } from "../../../talk/deliveryOutcome.js";
import { bootRefusalWakeLine } from "../../../transcripts/bootRefusalWake.js";

const CARD = "mon-claude-register-0123456789abcdef";
const POSTED = "2026-11-07T02:46:30.000Z";
const AT = "2026-11-07T02:46:35.000Z";
const minted: string[] = [];

const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "boot-refusal-"));
  minted.push(home);
  return home;
};

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Post one open hand step under an id. */
async function postCard({ home, id }: { home: string; id: string }): Promise<void> {
  const step = unwrap(
    buildHandStep({
      draft: {
        id,
        postedBy: "supervisor",
        postedIso: POSTED,
        unblocks: "every new Claude session",
        url: "http://127.0.0.1:4317/queue",
        what: "Ask on this card for a plans register repair, so new Claude sessions can start again",
        witness: `slopweaver hand done ${id}`,
      },
    }),
  );
  unwrap(await appendHandRow({ home, nowIso: POSTED, row: { kind: "posted", step } }));
}

const STALE = (): Promise<Result<unknown, PlanRegisterError>> =>
  Promise.resolve(
    err(PlanRegisterErrors.registerStoreUnavailable({ doing: "open", reason: "stale", staleStore: true })),
  );

const typed: Delivery = { atIso: AT, detail: "typed into the chair", kind: "typed", via: "courier" };
const busy: Delivery = {
  atIso: AT,
  detail: "the owner's words are in the composer",
  kind: "skipped",
  refusal: "composer-busy",
  via: "courier",
};

describe("bootRefusalCauseOf", () => {
  it("reads a register that reads as no cause, so the card is residue", () => {
    expect(bootRefusalCauseOf({ read: ok({}) })).toBe(undefined);
  });

  it("reads a store refused as stale as the one cause a hatch helps", () => {
    const read = err(PlanRegisterErrors.registerStoreUnavailable({ doing: "open", reason: "x", staleStore: true }));

    expect(bootRefusalCauseOf({ read })).toBe("stale-store");
  });

  it("reads every other failure as no hatch", () => {
    const unreachable = err(PlanRegisterErrors.registerStoreUnavailable({ doing: "open", reason: "refused" }));

    expect(bootRefusalCauseOf({ read: unreachable })).toBe("register-unreadable");
    expect(bootRefusalCauseOf({ read: err(PlanRegisterErrors.registerInvalid({ problems: ["bad"] })) })).toBe(
      "register-unreadable",
    );
  });
});

describe("wakeChairForBootRefusal", () => {
  it("types the stale-store line once and keeps its claim, so the next pass is silent", async () => {
    const home = freshHome();
    await postCard({ home, id: CARD });
    const lines: string[] = [];
    const deliver = ({ line }: { line: string }): Promise<Delivery> => {
      lines.push(line);
      return Promise.resolve(typed);
    };

    const first = await wakeChairForBootRefusal({ deliver, home, readRegister: STALE });
    const second = await wakeChairForBootRefusal({ deliver, home, readRegister: STALE });

    expect(first).toEqual({ cardId: CARD, cause: "stale-store", delivery: typed, kind: "woke", unreleased: undefined });
    expect(second).toEqual({ kind: "none" });
    expect(lines).toEqual([bootRefusalWakeLine({ cardId: CARD, cause: "stale-store" })!]);
    expect(existsSync(bootRefusalClaimPath({ cardId: CARD, home }))).toBe(true);
  });

  it("releases the claim when the owner's words held the composer, so the next pass types it", async () => {
    const home = freshHome();
    await postCard({ home, id: CARD });
    const deliveries = [busy, typed];
    const lines: string[] = [];
    const deliver = ({ line }: { line: string }): Promise<Delivery> => {
      lines.push(line);
      return Promise.resolve(deliveries.shift()!);
    };

    const first = await wakeChairForBootRefusal({ deliver, home, readRegister: STALE });
    const claimAfterBusy = existsSync(bootRefusalClaimPath({ cardId: CARD, home }));
    const second = await wakeChairForBootRefusal({ deliver, home, readRegister: STALE });

    expect(first).toEqual({ cardId: CARD, cause: "stale-store", delivery: busy, kind: "woke", unreleased: undefined });
    expect(claimAfterBusy).toBe(false);
    expect(second).toEqual({
      cardId: CARD,
      cause: "stale-store",
      delivery: typed,
      kind: "woke",
      unreleased: undefined,
    });
    expect(lines.length).toBe(2);
  });

  it("types nothing for a card another pass already claimed", async () => {
    const home = freshHome();
    await postCard({ home, id: CARD });
    const claim = bootRefusalClaimPath({ cardId: CARD, home });
    mkdirSync(dirname(claim), { recursive: true });
    writeFileSync(claim, "");
    const lines: string[] = [];

    const outcome = await wakeChairForBootRefusal({
      deliver: ({ line }) => {
        lines.push(line);
        return Promise.resolve(typed);
      },
      home,
      readRegister: STALE,
    });

    expect(outcome).toEqual({ kind: "none" });
    expect(lines).toEqual([]);
  });

  // Two passes reading at different moments must never both act on the card.
  it("lets a pass that starts while another is reading neither read the register nor type", async () => {
    const home = freshHome();
    await postCard({ home, id: CARD });
    const lines: string[] = [];
    const deliver = ({ line }: { line: string }): Promise<Delivery> => {
      lines.push(line);
      return Promise.resolve(typed);
    };
    let innerReads = 0;
    let inner: unknown;

    const outer = await wakeChairForBootRefusal({
      deliver,
      home,
      readRegister: async () => {
        inner = await wakeChairForBootRefusal({
          deliver,
          home,
          readRegister: () => {
            innerReads += 1;
            return Promise.resolve(ok({}));
          },
        });
        return STALE();
      },
    });

    expect(inner).toEqual({ kind: "none" });
    expect(innerReads).toBe(0);
    expect(outer).toEqual({ cardId: CARD, cause: "stale-store", delivery: typed, kind: "woke", unreleased: undefined });
    expect(lines.length).toBe(1);
  });

  // Released on purpose: the store card is keyed by its code alone, so a kept claim would silence a store
  // that breaks again under the same card. The release is what lets the next outage reach the chair.
  it("types nothing and claims nothing while the register reads", async () => {
    const home = freshHome();
    await postCard({ home, id: CARD });
    const lines: string[] = [];

    const outcome = await wakeChairForBootRefusal({
      deliver: ({ line }) => {
        lines.push(line);
        return Promise.resolve(typed);
      },
      home,
      readRegister: () => Promise.resolve(ok({})),
    });

    expect(outcome).toEqual({ cardId: CARD, kind: "residue" });
    expect(lines).toEqual([]);
    expect(existsSync(bootRefusalClaimPath({ cardId: CARD, home }))).toBe(false);
  });

  it("never reads the register on a pass with no register card open", async () => {
    const home = freshHome();
    await postCard({ home, id: "mon-claude-plan-two" });
    let reads = 0;

    const outcome = await wakeChairForBootRefusal({
      deliver: () => Promise.resolve(typed),
      home,
      readRegister: () => {
        reads += 1;
        return STALE();
      },
    });

    expect(outcome).toEqual({ kind: "none" });
    expect(reads).toBe(0);
  });
});

describe("bootRefusalWakeReportLine", () => {
  it("says what the wake did, and nothing for a quiet pass", () => {
    expect(
      bootRefusalWakeReportLine({
        outcome: { cardId: CARD, cause: "stale-store", delivery: typed, kind: "woke", unreleased: undefined },
      }),
    ).toBe(`talk courier: boots refused on ${CARD} (stale-store) — chair wake typed: typed into the chair`);
    expect(bootRefusalWakeReportLine({ outcome: { kind: "none" } })).toBe(undefined);
    expect(bootRefusalWakeReportLine({ outcome: { cardId: CARD, kind: "lost-race" } })).toBe(undefined);
    expect(bootRefusalWakeReportLine({ outcome: { kind: "unreadable", why: "x" } })).toBe(
      "talk courier: could not tell whether boots are refused — x",
    );
  });
});
