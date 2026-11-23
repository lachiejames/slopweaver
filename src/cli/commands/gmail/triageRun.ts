/**
 * The effectful shell for `gmail triage`: parse (pure), read the inbox through a grant carrying the READ
 * capability, optionally persist the reading, and render it — the whole of it, one named group with its ids (pinned
 * under a card's slug when asked), the ids a pinned card still finds in the inbox, or the ids a declared archive rule
 * covers (`--ruled`). The install's own triage policy (the store's `gmail-triage-rules` row) is read first, for
 * the same home the grant resolves from, and a malformed row or an unreachable store stops the run before the inbox
 * is read; the code ships no policy of its own. Every edge is injected, so dispatch, the exit codes and the writes are
 * unit tested with plain fakes and no mailbox.
 *
 * It changes nothing in the mailbox and goes through no door, exactly like `gmail list`: what it can write is local
 * state under the home — the snapshot, a card's pin, and the pinned mail stored beside it for the Queue to draw — which
 * is why the verb is `local-state` rather than a read. The reading itself is metadata only; `--pin` alone reads the
 * pinned messages in full (`live/gmail/cardMailCapture.ts`).
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { acquireOperationLock } from "../../../admit/operationLock.js";
import { slopweaverHome } from "../../../homeDir.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { makeGmailApi } from "../../../live/gmail/api.js";
import { MAX_CARD_MAIL_MESSAGES, readCardMailStore, removeCardMailStore } from "../../../live/gmail/cardMail.js";
import { captureCardMailWithGrant } from "../../../live/gmail/cardMailCapture.js";
import { resolveGmailClient } from "../../../live/gmail/client.js";
import type { GmailError } from "../../../live/gmail/errors.js";
import type { GmailTriageDocument } from "../../../live/gmail/triage.js";
import { readCardedKeys, type TriageCardedKeysRead } from "../../../live/gmail/triageCardedStore.js";
import { pinTriageCard, readTriageCard } from "../../../live/gmail/triageCards.js";
import { readGmailTriage } from "../../../live/gmail/triageRead.js";
import {
  presentGmailTriageGroup,
  renderGmailTriageReadingJson,
  renderGmailTriageText,
} from "../../../live/gmail/triageRender.js";
import type { GmailTriageRulesError } from "../../../live/gmail/triageRuleErrors.js";
import {
  type GmailTriageRulesPort,
  type GmailTriageRulesSnapshot,
  gmailTriageRulesPort,
  inertRuleFileLine,
  triagePolicyOf,
} from "../../../live/gmail/triageRuleStore.js";
import type { GmailTriagePolicy } from "../../../live/gmail/triageRules.js";
import { writeGmailTriageDocument } from "../../../live/gmail/triageStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { gmailArgsErrorLines } from "./errors.js";
import { type GmailTriageArgs, parseGmailTriageArgs } from "./triageCore.js";
import { captureThenPin, type TriagePinDeps } from "./triagePin.js";
import { printCard, printRuled } from "./triageRunActs.js";

const VERB_ARG_OFFSET = 4;

/** The seams `gmail triage` performs its effects through; the pin step's own are {@link TriagePinDeps}. */
export interface GmailTriageDeps extends TriagePinDeps {
  readonly readArchiveRules: (args: {
    home: string;
  }) => Promise<Result<GmailTriageRulesSnapshot, GmailTriageRulesError>>;
  readonly triage: (args: {
    home: string;
    limit: number;
    policy: GmailTriagePolicy;
  }) => Promise<Result<GmailTriageDocument, GmailError>>;
  readonly write: (args: {
    document: GmailTriageDocument;
    home: string;
  }) => Result<{ readonly path: string }, IngestError>;
  /** Which of the reading's keys an open card already stands for (`live/gmail/triageCardedStore.ts`). */
  readonly readCarded: (args: { home: string; keys: ReadonlySet<string> }) => TriageCardedKeysRead;
  readonly home: () => string;
  readonly writeOut: (line: string) => void;
}

/** `--home` when given, else the ambient home. */
function homeOf({ args, deps }: { args: GmailTriageArgs; deps: GmailTriageDeps }): string {
  if (args.home !== undefined) {
    return args.home;
  }
  return deps.home();
}

/**
 * Read which of the reading's keys an open card already stands for, saying on stderr what the scan could not read —
 * an unread pin or card row never makes a group read as carded, so it is carded again and named, never skipped.
 */
function readCarded({
  args,
  deps,
  document,
}: {
  args: GmailTriageArgs;
  deps: GmailTriageDeps;
  document: GmailTriageDocument;
}): TriageCardedKeysRead["standingsByKey"] {
  const keys = new Set(document.groups.map((group) => group.key));
  const read = deps.readCarded({ home: homeOf({ args, deps }), keys });
  for (const line of read.diagnostics) {
    deps.writeDiagnostic(`gmail triage: ${line}`);
  }
  return read.standingsByKey;
}

/**
 * Print one named group and its ids, pinning them under `--pin` first; an absent group is exit 3 — exit 1 when the
 * reading stopped at its cap, which cannot say "clear" — and a pin that could not be written is exit 1 with nothing
 * printed, so a card is never made over a set that was not pinned. A `--pin` for a group an open card already stands
 * for pins nothing and is exit 3, naming that card. Pinning captures the group's mail first
 * (`live/gmail/cardMailCapture.ts`); a capture that fails writes no pin, so no card stands without its mail.
 */
async function printOneGroup({
  args,
  document,
  deps,
  key,
}: {
  args: GmailTriageArgs;
  document: GmailTriageDocument;
  deps: GmailTriageDeps;
  key: string;
}): Promise<number> {
  const group = document.groups.find((candidate) => candidate.key === key);
  if (group === undefined && !document.complete) {
    deps.writeDiagnostic(
      `gmail triage: no group has key ${key} in a reading that STOPPED at the message cap ` +
        `(--limit ${String(args.limit)}), so its mail may sit past the cap; re-run with a higher --limit`,
    );
    return EXIT_ERROR;
  }
  if (group === undefined) {
    deps.writeDiagnostic(`gmail triage: no inbox group has key ${key} — it is already clear, or the key is wrong`);
    return EXIT_EXPECTED_EMPTY;
  }
  // Read BEFORE a `--pin` writes: the new pin has no card row yet, and must not read as the group already carded.
  const carded = readCarded({ args, deps, document });
  // A card pins at most the newest MAX_CARD_MAIL_MESSAGES, so it acts on exactly the mail it draws; the rest stay in
  // the inbox for the next reading.
  const ids = group.entries
    .map((entry) => entry.id)
    .slice(0, args.pin === undefined ? undefined : MAX_CARD_MAIL_MESSAGES);
  const heldBack = group.entries.length - ids.length;
  if (args.pin !== undefined) {
    if (refuseRecard({ carded, deps, key, slug: args.pin })) {
      return EXIT_EXPECTED_EMPTY;
    }
    const card = { ids, key, pinnedAtIso: document.readAtIso, schemaVersion: 1, slug: args.pin } as const;
    const failed = await captureThenPin({ card, deps, heldBack, home: homeOf({ args, deps }) });
    if (failed !== undefined) {
      return failed;
    }
  }
  if (args.json) {
    // `null` rather than an absent key, so a reader sees "not pinned" instead of a field that may have been lost.
    const value = {
      group: presentGmailTriageGroup({ carded, group }),
      heldBack,
      ids,
      key,
      pinned: unsetFieldAsNull({ key: "pin", record: args }),
    };
    deps.writeOut(safeJsonStringify({ label: "gmail triage group", space: 2, value }));
  } else {
    deps.writeOut(renderGmailTriageText({ carded, document, only: group }));
  }
  return EXIT_OK;
}

/**
 * A second card for a group an open card already stands for is the re-card this scan exists to stop, so the verb
 * holds it rather than the recipe's prose alone: nothing pinned, nothing captured, the open card named on stderr.
 * True when the `--pin` must be refused.
 */
function refuseRecard({
  carded,
  deps,
  key,
  slug,
}: {
  carded: TriageCardedKeysRead["standingsByKey"];
  deps: GmailTriageDeps;
  key: string;
  slug: string;
}): boolean {
  const standing = carded.get(key);
  if (standing?.carded !== true) {
    return false;
  }
  const filed = standing.filedInto === null ? "" : `, filed into ${standing.filedInto}`;
  deps.writeDiagnostic(
    `gmail triage: ${key} is already carded as ${standing.slug}${filed} and still open, so --pin ${slug} ` +
      "pinned nothing; settle that card before carding the group again",
  );
  return true;
}

/** Persist the reading under `--home`, else the ambient home, and say where; false when the write failed. */
function persistReading({
  args,
  deps,
  document,
}: {
  args: GmailTriageArgs;
  deps: GmailTriageDeps;
  document: GmailTriageDocument;
}): boolean {
  const written = deps.write({ document, home: homeOf({ args, deps }) });
  if (written.isErr()) {
    deps.writeDiagnostic(written.error.message);
    return false;
  }
  deps.writeDiagnostic(`gmail triage: wrote ${written.value.path}`);
  return true;
}

/**
 * Run `gmail triage` against injected edges.
 *
 * @param rest argv after `gmail triage`
 * @param deps the read, write and output seams
 * @returns the process exit code
 */
export async function runGmailTriage({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GmailTriageDeps;
}): Promise<number> {
  const parsed = parseGmailTriageArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...gmailArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = homeOf({ args, deps });
  // The install's own rules are read before the mailbox is bound, so a corrupt row or an unreachable store refuses
  // with nothing read: triaging as if no rule applied would put already-ruled mail back in front of the owner.
  const rules = await deps.readArchiveRules({ home });
  if (rules.isErr()) {
    deps.writeDiagnostic(`gmail triage: ${rules.error.message} — nothing was triaged`);
    return EXIT_ERROR;
  }
  const inert = inertRuleFileLine({ snapshot: rules.value });
  if (inert !== undefined) {
    deps.writeDiagnostic(`gmail triage: ${inert}`);
  }
  const read = await deps.triage({ home, limit: args.limit, policy: triagePolicyOf({ snapshot: rules.value }) });
  if (read.isErr()) {
    deps.writeDiagnostic(read.error.message);
    return EXIT_ERROR;
  }
  const document = read.value;
  if (args.write && !persistReading({ args, deps, document })) {
    return EXIT_ERROR;
  }
  return printReading({ args, deps, document });
}

/** Print the reading in the shape the flags asked for — one card, one group, the ruled mail, or all of it. */
function printReading({
  args,
  deps,
  document,
}: {
  args: GmailTriageArgs;
  deps: GmailTriageDeps;
  document: GmailTriageDocument;
}): number | Promise<number> {
  if (args.card !== undefined) {
    return printCard({ args, deps, document, home: homeOf({ args, deps }), slug: args.card });
  }
  if (args.key !== undefined) {
    return printOneGroup({ args, deps, document, key: args.key });
  }
  if (args.ruled) {
    return printRuled({ args, deps, document });
  }
  const carded = readCarded({ args, deps, document });
  deps.writeOut(
    args.json
      ? renderGmailTriageReadingJson({ carded, document })
      : renderGmailTriageText({ carded, document, only: undefined }),
  );
  const empty = [
    document.groups,
    document.unkeyed,
    document.fathom,
    document.meetingNotes,
    document.replied,
    document.passedInvites,
  ].every((held) => held.length === 0);
  return empty ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * The production seams. Triage needs only the `read` capability, so a `--grant read` install runs it whole.
 *
 * @param rulesPort the store door the install's own triage policy is read through
 * @returns the grant-aware reader, the snapshot and pin stores and output sinks
 */
export function productionGmailTriageDeps({ rulesPort }: { rulesPort: GmailTriageRulesPort }): GmailTriageDeps {
  return {
    capture: captureCardMailWithGrant,
    discardMail: removeCardMailStore,
    home: slopweaverHome,
    lock: ({ home, slug }) =>
      acquireOperationLock({ home, key: `gmail-triage-pin:${slug}`, nowIso: new Date().toISOString() }),
    pin: pinTriageCard,
    readCard: readTriageCard,
    readCarded: readCardedKeys,
    readArchiveRules: rulesPort.read,
    readMail: readCardMailStore,
    triage: async ({ home, limit, policy }) => {
      const bound = resolveGmailClient({ capabilities: ["read"], home });
      if (bound.isErr()) {
        return err(bound.error);
      }
      return readGmailTriage({
        account: bound.value.account,
        api: makeGmailApi({ account: bound.value.account, client: bound.value.client }),
        limit,
        nowIso: () => new Date().toISOString(),
        policy,
      });
    },
    write: writeGmailTriageDocument,
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver gmail triage`. */
export const gmailTriageCommand = defineCommand({
  run: (argv) =>
    runGmailTriage({
      deps: productionGmailTriageDeps({ rulesPort: gmailTriageRulesPort() }),
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
