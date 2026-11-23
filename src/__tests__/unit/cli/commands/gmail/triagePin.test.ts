/**
 * Unit: the pin step's ORDER and its failure settlements — capture before pin, nothing captured over a standing pin,
 * and a copy discarded only when no card stands on it. Every seam is a plain in-memory fake; no mailbox, no disk.
 */
import { describe, expect, it } from "vitest";

import { captureThenPin, type TriagePinDeps } from "../../../../../cli/commands/gmail/triagePin.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { CardMailStoreErrors } from "../../../../../live/gmail/cardMail.js";
import { CardMailCaptureErrors } from "../../../../../live/gmail/cardMailCapture.js";
import { GmailErrors } from "../../../../../live/gmail/errors.js";
import { type GmailTriageCard, type TriageCardError, TriageCardErrors } from "../../../../../live/gmail/triageCards.js";

const SLUG = "inbox-triage-20261001-from-notices-example-com";

const CARD: GmailTriageCard = {
  ids: ["0000000000000001", "0000000000000002"],
  key: "from:notices@example.com",
  pinnedAtIso: "2026-10-01T10:00:00.000Z",
  schemaVersion: 1,
  slug: SLUG,
};

/** What a run did, in order, and what it said. */
interface Recorded {
  readonly effects: string[];
  readonly diagnostics: string[];
}

/** The pin another run wrote between this run's check and its own write: same slug, its own key and ids. */
const WINNER: GmailTriageCard = { ...CARD, ids: ["0000000000000009"], key: "from:other@example.com" };

/**
 * The seams, each recording itself; `existing` is what reading the slug's pin answers until this run pins, `afterPin`
 * what it answers after, `pinError` a failed write, `failCaptureOf` the key whose capture fails, `lockBusy` why
 * the slug's lock is held elsewhere, and `onDisk` whose mail the stored copy holds — by default this run's own, which
 * is what its capture left there — or `"none"`.
 */
function depsFor({
  recorded,
  existing,
  afterPin,
  captureFails = false,
  failCaptureOf,
  lockBusy,
  onDisk = CARD,
  pinError,
}: {
  recorded: Recorded;
  existing: TriageCardError | "pinned";
  afterPin?: GmailTriageCard | TriageCardError;
  captureFails?: boolean;
  failCaptureOf?: string;
  lockBusy?: string;
  onDisk?: GmailTriageCard | "none";
  pinError?: TriageCardError;
}): TriagePinDeps {
  return {
    capture: async ({ card }) => {
      recorded.effects.push(card.key === CARD.key ? "capture" : `capture:${card.key}`);
      if (captureFails || card.key === failCaptureOf) {
        return err(CardMailCaptureErrors.fetchFailed({ cause: GmailErrors.notConnected(), id: card.ids[0]! }));
      }
      const mails = card.ids.map((id) => ({ id, kind: "gone" as const }));
      const store = {
        key: card.key,
        mails,
        omittedCount: 0,
        pinnedCount: card.ids.length,
        schemaVersion: 1 as const,
        slug: card.slug,
        storedAtIso: card.pinnedAtIso,
      };
      return ok({ path: `/home/live/gmail/card-mail/${card.slug}.json`, store });
    },
    discardMail: ({ slug }) => {
      recorded.effects.push(`discard:${slug}`);
      return ok(undefined);
    },
    lock: ({ slug }) => {
      if (lockBusy !== undefined) {
        return err(lockBusy);
      }
      recorded.effects.push(`lock:${slug}`);
      return ok({ release: () => recorded.effects.push(`release:${slug}`) });
    },
    pin: ({ card }) => {
      recorded.effects.push("pin");
      if (pinError !== undefined) {
        return err(pinError);
      }
      return ok({ path: `/home/live/gmail/triage-cards/${card.slug}.json` });
    },
    readCard: () => {
      if (afterPin !== undefined && recorded.effects.includes("pin")) {
        return "code" in afterPin ? err(afterPin) : ok(afterPin);
      }
      return existing === "pinned" ? ok(CARD) : err(existing);
    },
    readMail: ({ pin }) => {
      if (onDisk === "none") {
        return err(CardMailStoreErrors.notStored({ slug: pin.slug }));
      }
      if (onDisk.key !== pin.key) {
        return err(CardMailStoreErrors.pinMismatch({ slug: pin.slug, why: "the stored key is another card's" }));
      }
      const mails = pin.ids.map((id) => ({ id, kind: "gone" as const }));
      return ok({
        key: pin.key,
        mails,
        omittedCount: 0,
        pinnedCount: pin.ids.length,
        schemaVersion: 1 as const,
        slug: pin.slug,
        storedAtIso: pin.pinnedAtIso,
      });
    },
    writeDiagnostic: (line) => recorded.diagnostics.push(line),
  };
}

/** The effects of one run that held the slug's lock: taken first, released last, whatever happened between. */
function held(...inner: string[]): string[] {
  return [`lock:${SLUG}`, ...inner, `release:${SLUG}`];
}

describe("captureThenPin", () => {
  it("stores and pins nothing while another run holds the slug's lock", async () => {
    const recorded: Recorded = { diagnostics: [], effects: [] };
    const deps = depsFor({
      existing: TriageCardErrors.notPinned({ slug: SLUG }),
      lockBusy: "held by pid 4242",
      recorded,
    });
    expect(await captureThenPin({ card: CARD, deps, heldBack: 0, home: "/home" })).toBe(EXIT_ERROR);
    expect(recorded.effects).toEqual([]);
    expect(recorded.diagnostics).toEqual([
      `gmail triage: another run is pinning ${SLUG} (held by pid 4242) — nothing was stored or pinned`,
    ]);
  });

  it("captures the mail, then pins, and says how many older messages stay in the inbox", async () => {
    const recorded: Recorded = { diagnostics: [], effects: [] };
    const deps = depsFor({ existing: TriageCardErrors.notPinned({ slug: SLUG }), recorded });
    expect(await captureThenPin({ card: CARD, deps, heldBack: 3, home: "/home" })).toBe(undefined);
    expect(recorded.effects).toEqual(held("capture", "pin"));
    expect(recorded.diagnostics).toEqual([
      `gmail triage: stored 2 message(s) for card ${SLUG} at /home/live/gmail/card-mail/${SLUG}.json`,
      `gmail triage: pinned 2 id(s) as card ${SLUG} at /home/live/gmail/triage-cards/${SLUG}.json; ` +
        "3 older one(s) stay in the inbox for the next reading",
    ]);
  });

  it("refuses a slug already pinned before capturing anything over its stored mail", async () => {
    const recorded: Recorded = { diagnostics: [], effects: [] };
    const deps = depsFor({ existing: "pinned", recorded });
    expect(await captureThenPin({ card: CARD, deps, heldBack: 0, home: "/home" })).toBe(EXIT_ERROR);
    expect(recorded.effects).toEqual(held());
    expect(recorded.diagnostics).toEqual([TriageCardErrors.alreadyPinned({ slug: SLUG }).message]);
  });

  it("refuses an unreadable existing pin rather than reading it as absent", async () => {
    const recorded: Recorded = { diagnostics: [], effects: [] };
    const deps = depsFor({ existing: TriageCardErrors.malformed({ slug: SLUG }), recorded });
    expect(await captureThenPin({ card: CARD, deps, heldBack: 0, home: "/home" })).toBe(EXIT_ERROR);
    expect(recorded.effects).toEqual(held());
    expect(recorded.diagnostics).toEqual([TriageCardErrors.malformed({ slug: SLUG }).message]);
  });

  it("pins nothing when the capture fails", async () => {
    const recorded: Recorded = { diagnostics: [], effects: [] };
    const deps = depsFor({ captureFails: true, existing: TriageCardErrors.notPinned({ slug: SLUG }), recorded });
    expect(await captureThenPin({ card: CARD, deps, heldBack: 0, home: "/home" })).toBe(EXIT_ERROR);
    expect(recorded.effects).toEqual(held("capture"));
    expect(recorded.diagnostics[0]).toContain("— nothing was pinned");
  });

  it("discards the stored copy when the pin write fails and no card stands", async () => {
    const recorded: Recorded = { diagnostics: [], effects: [] };
    const pinError = TriageCardErrors.malformed({ slug: SLUG });
    const deps = depsFor({ existing: TriageCardErrors.notPinned({ slug: SLUG }), pinError, recorded });
    expect(await captureThenPin({ card: CARD, deps, heldBack: 0, home: "/home" })).toBe(EXIT_ERROR);
    expect(recorded.effects).toEqual(held("capture", "pin", `discard:${SLUG}`));
  });

  it("never discards another card's copy when the pin write fails and no card stands", async () => {
    const recorded: Recorded = { diagnostics: [], effects: [] };
    const pinError = TriageCardErrors.malformed({ slug: SLUG });
    const deps = depsFor({
      existing: TriageCardErrors.notPinned({ slug: SLUG }),
      onDisk: WINNER,
      pinError,
      recorded,
    });
    expect(await captureThenPin({ card: CARD, deps, heldBack: 0, home: "/home" })).toBe(EXIT_ERROR);
    expect(recorded.effects).toEqual(held("capture", "pin"));
  });

  it("stores the mail again for the card that won when another run pinned the slug in between", async () => {
    const recorded: Recorded = { diagnostics: [], effects: [] };
    const pinError = TriageCardErrors.alreadyPinned({ slug: SLUG });
    const deps = depsFor({
      afterPin: WINNER,
      existing: TriageCardErrors.notPinned({ slug: SLUG }),
      pinError,
      recorded,
    });
    expect(await captureThenPin({ card: CARD, deps, heldBack: 0, home: "/home" })).toBe(EXIT_ERROR);
    expect(recorded.effects).toEqual(held("capture", "pin", `capture:${WINNER.key}`));
    expect(recorded.diagnostics.slice(-2)).toEqual([
      pinError.message,
      `gmail triage: stored the mail for the card that pinned ${SLUG} first`,
    ]);
  });

  it("discards its own copy and names the --fetch repair when the winning card's mail cannot be stored again", async () => {
    const recorded: Recorded = { diagnostics: [], effects: [] };
    const deps = depsFor({
      afterPin: WINNER,
      existing: TriageCardErrors.notPinned({ slug: SLUG }),
      failCaptureOf: WINNER.key,
      pinError: TriageCardErrors.alreadyPinned({ slug: SLUG }),
      recorded,
    });
    expect(await captureThenPin({ card: CARD, deps, heldBack: 0, home: "/home" })).toBe(EXIT_ERROR);
    expect(recorded.effects).toEqual(held("capture", "pin", `capture:${WINNER.key}`, `discard:${SLUG}`));
    expect(recorded.diagnostics.at(-1)).toContain(
      `card ${SLUG} stands without its mail; run slopweaver gmail card-mail ${SLUG} --fetch`,
    );
  });

  it("leaves the winning card's copy untouched when it is already that card's mail", async () => {
    const recorded: Recorded = { diagnostics: [], effects: [] };
    const deps = depsFor({
      afterPin: WINNER,
      existing: TriageCardErrors.notPinned({ slug: SLUG }),
      onDisk: WINNER,
      pinError: TriageCardErrors.alreadyPinned({ slug: SLUG }),
      recorded,
    });
    expect(await captureThenPin({ card: CARD, deps, heldBack: 0, home: "/home" })).toBe(EXIT_ERROR);
    expect(recorded.effects).toEqual(held("capture", "pin"));
    expect(recorded.diagnostics.at(-1)).toBe(`gmail triage: the card that pinned ${SLUG} first keeps its stored mail`);
  });

  it("discards nothing when the winning card's mail cannot be stored and no copy was there to judge", async () => {
    const recorded: Recorded = { diagnostics: [], effects: [] };
    const deps = depsFor({
      afterPin: WINNER,
      existing: TriageCardErrors.notPinned({ slug: SLUG }),
      failCaptureOf: WINNER.key,
      onDisk: "none",
      pinError: TriageCardErrors.alreadyPinned({ slug: SLUG }),
      recorded,
    });
    expect(await captureThenPin({ card: CARD, deps, heldBack: 0, home: "/home" })).toBe(EXIT_ERROR);
    expect(recorded.effects).toEqual(held("capture", "pin", `capture:${WINNER.key}`));
    expect(recorded.diagnostics.at(-1)).toContain(`run slopweaver gmail card-mail ${SLUG} --fetch`);
  });

  it("keeps the stored copy when the pin write reported a failure but its own pin reads back whole", async () => {
    const recorded: Recorded = { diagnostics: [], effects: [] };
    const deps = depsFor({
      afterPin: CARD,
      existing: TriageCardErrors.notPinned({ slug: SLUG }),
      pinError: TriageCardErrors.malformed({ slug: SLUG }),
      recorded,
    });
    expect(await captureThenPin({ card: CARD, deps, heldBack: 0, home: "/home" })).toBe(EXIT_ERROR);
    expect(recorded.effects).toEqual(held("capture", "pin"));
    expect(recorded.diagnostics.at(-1)).toBe(
      `gmail triage: the pin for ${SLUG} was written whole, so its stored mail stays`,
    );
  });

  it("leaves the copy when a pin is there after the failure but will not read", async () => {
    const recorded: Recorded = { diagnostics: [], effects: [] };
    const unreadable = TriageCardErrors.malformed({ slug: SLUG });
    const deps = depsFor({
      afterPin: unreadable,
      existing: TriageCardErrors.notPinned({ slug: SLUG }),
      pinError: TriageCardErrors.malformed({ slug: SLUG }),
      recorded,
    });
    expect(await captureThenPin({ card: CARD, deps, heldBack: 0, home: "/home" })).toBe(EXIT_ERROR);
    expect(recorded.effects).toEqual(held("capture", "pin"));
    expect(recorded.diagnostics.at(-1)).toBe(unreadable.message);
  });
});
