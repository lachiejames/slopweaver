/*
 * What the `gmail triage` test files share: a synthetic inbox (mail content never enters a fixture), the recorder
 * the fake seams push into, one install rule row, and the shell's deps over plain fakes with the REAL pin store.
 * `newHome()` mints a `mkdtempSync` home for the cases that round-trip the snapshot and the pins, removed by the
 * `afterEach` that `useHomes()` registers. It moved here when `triageRun.test.ts` was split by behaviour.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

import type { GmailTriageDeps } from "../../../../../../cli/commands/gmail/triageRun.js";
import { err, ok, type Result } from "../../../../../../lib/result.js";
import { type CardMailStore, CardMailStoreErrors } from "../../../../../../live/gmail/cardMail.js";
import { CardMailCaptureErrors } from "../../../../../../live/gmail/cardMailCapture.js";
import { GmailErrors } from "../../../../../../live/gmail/errors.js";
import type { GmailMessage } from "../../../../../../live/gmail/parse.js";
import { buildGmailTriage, type GmailTriageDocument } from "../../../../../../live/gmail/triage.js";
import type { TriageCardedKeysRead } from "../../../../../../live/gmail/triageCardedStore.js";
import { pinTriageCard, readTriageCard, TriageCardErrors } from "../../../../../../live/gmail/triageCards.js";
import type { GmailTriageRulesError } from "../../../../../../live/gmail/triageRuleErrors.js";
import type { GmailTriageRulesSnapshot } from "../../../../../../live/gmail/triageRuleStore.js";
import { EMPTY_TRIAGE_POLICY, type GmailTriageArchiveRule } from "../../../../../../live/gmail/triageRules.js";
import { EVERY_LANE_POLICY } from "../../../../live/gmail/triage/harness.js";

export const READ_AT = "2026-09-30T08:00:00.000Z";

const EMPTY_RULES: GmailTriageRulesSnapshot = { ...EMPTY_TRIAGE_POLICY, inertFile: undefined, revision: null };

/**
 * One synthetic inbox message.
 *
 * @returns an unread inbox message from that sender at that instant, on its own `t-<id>` thread
 */
export function message({ id, from, atIso }: { id: string; from: string; atIso: string }): GmailMessage {
  return {
    id,
    internalDate: String(Date.parse(atIso)),
    labelIds: ["INBOX", "UNREAD"],
    payload: { headers: [{ name: "From", value: from }] },
    threadId: `t-${id}`,
  };
}

export const DOCUMENT = buildGmailTriage({
  account: "owner@example.test",
  complete: true,
  inviteFileIds: new Set<string>(),
  repliedThreadIds: new Set<string>(),
  inboxEstimate: 3,
  policy: EVERY_LANE_POLICY,
  messages: [
    message({ atIso: "2026-09-29T10:00:00.000Z", from: "a@example.test", id: "a-late" }),
    message({ atIso: "2026-09-28T10:00:00.000Z", from: "a@example.test", id: "a-early" }),
    message({ atIso: "2026-09-28T10:00:00.000Z", from: "b@example.test", id: "b-1" }),
  ],
  readAtIso: READ_AT,
});

export const EMPTY = buildGmailTriage({
  account: "owner@example.test",
  complete: true,
  inviteFileIds: new Set<string>(),
  repliedThreadIds: new Set<string>(),
  inboxEstimate: 0,
  policy: EVERY_LANE_POLICY,
  messages: [],
  readAtIso: READ_AT,
});

/** Everything the fake seams recorded. */
interface Recorded {
  readonly out: string[];
  readonly diagnostics: string[];
  readonly written: string[];
  readonly limits: number[];
  /** The pin-path effects in the order they ran: `capture:<ids>`, `pin:<ids>`, `discard:<slug>`. */
  readonly effects: string[];
  /**
   * Each read, in order: `rules:<home>` for the policy, `triage:<home>:<sender keys, then structural kinds>` for the
   * inbox, `carded:<home>:<keys>` for card standing.
   */
  readonly reads: string[];
}

/**
 * A fresh record.
 *
 * @returns empty output, diagnostic, write, limit, effect and read lists for the fake seams to push into
 */
export function fresh(): Recorded {
  return { diagnostics: [], effects: [], limits: [], out: [], reads: [], written: [] };
}

/** A synthetic install row, as the home's rule file would declare it. */
export const INSTALL_ROW = {
  anchor: "transcript:FIXTURE#install-row",
  key: "from:notices@vendor.example",
  kind: "from",
  sender: "Vendor notices",
  why: "the signal reaches the owner another way",
} as const satisfies GmailTriageArchiveRule;

/**
 * The shell over fakes, with the REAL pin store; a test that pins passes a `mkdtempSync` home.
 *
 * @returns deps that record into `recorded` and read `document`, each failure switchable by its `…Fails` flag
 */
// max-lines-exempt: one plain-object fake of the whole GmailTriageDeps interface, its length that interface's, moved verbatim out of a test file this gate skips
export function depsFor({
  recorded,
  document = DOCUMENT,
  readFails = false,
  captureFails = false,
  pinFails = false,
  ambientHome = "/ambient-home",
  installRules = ok(EMPTY_RULES),
  carded = { diagnostics: [], standingsByKey: new Map() },
}: {
  recorded: Recorded;
  document?: GmailTriageDocument;
  readFails?: boolean;
  captureFails?: boolean;
  pinFails?: boolean;
  ambientHome?: string;
  installRules?: Result<GmailTriageRulesSnapshot, GmailTriageRulesError>;
  carded?: TriageCardedKeysRead;
}): GmailTriageDeps {
  // The fake capture writes nothing, so the stored copy is whatever it last captured, read against the asking pin.
  const stored: CardMailStore[] = [];
  return {
    capture: async ({ card, home }) => {
      recorded.effects.push(`capture:${card.ids.join(",")}`);
      if (captureFails) {
        return err(CardMailCaptureErrors.fetchFailed({ cause: GmailErrors.notConnected(), id: card.ids[0]! }));
      }
      const store: CardMailStore = {
        key: card.key,
        mails: card.ids.map((id) => ({ id, kind: "gone" as const })),
        omittedCount: 0,
        pinnedCount: card.ids.length,
        schemaVersion: 1 as const,
        slug: card.slug,
        storedAtIso: READ_AT,
      };
      stored.push(store);
      return ok({ path: `${home}/live/gmail/card-mail/${card.slug}.json`, store });
    },
    discardMail: ({ slug }) => {
      recorded.effects.push(`discard:${slug}`);
      return ok(undefined);
    },
    home: () => ambientHome,
    lock: () => ok({ release: () => undefined }),
    pin: (args) => {
      recorded.effects.push(`pin:${args.card.ids.join(",")}`);
      return pinFails ? err(TriageCardErrors.malformed({ slug: args.card.slug })) : pinTriageCard(args);
    },
    readArchiveRules: ({ home }) => {
      recorded.reads.push(`rules:${home}`);
      return Promise.resolve(installRules);
    },
    readCard: readTriageCard,
    readCarded: ({ home, keys }) => {
      recorded.reads.push(`carded:${home}:${[...keys].join(",")}`);
      return carded;
    },
    readMail: ({ pin }) => {
      const last = stored.at(-1);
      if (last === undefined) {
        return err(CardMailStoreErrors.notStored({ slug: pin.slug }));
      }
      if (last.key !== pin.key) {
        return err(CardMailStoreErrors.pinMismatch({ slug: pin.slug, why: "the stored key is another card's" }));
      }
      return ok(last);
    },
    triage: async ({ home, policy, limit }) => {
      recorded.limits.push(limit);
      const choices = [...policy.rules.map((rule) => rule.key), ...policy.structuralRules.map((rule) => rule.kind)];
      recorded.reads.push(`triage:${home}:${choices.join(",")}`);
      return readFails ? err(GmailErrors.notConnected()) : ok(document);
    },
    write: ({ home }) => {
      recorded.written.push(home);
      return ok({ path: `${home}/live/gmail/triage.json` });
    },
    writeDiagnostic: (line) => recorded.diagnostics.push(line),
    writeOut: (line) => recorded.out.push(line),
  };
}

const homes: string[] = [];

/** Register the `afterEach` that removes every home minted since the last case. Call it once per test file. */
export function useHomes(): void {
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });
}

/**
 * A fresh temp home, removed after the test by the `afterEach` that `useHomes()` registers.
 *
 * @returns the new home's absolute path
 */
export function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-gmail-triage-"));
  homes.push(home);
  return home;
}
