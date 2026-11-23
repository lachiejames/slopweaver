/**
 * The ask an approving `github reviewer pick` leads to — the one already held on the owner's queue for that person and
 * pull request, or a new one parked for the owner's yes through `slack draft record`'s own path. Nothing here sends.
 *
 * Split from `./reviewerRun.ts` along the seam the verb already had: the pick row is the register's business,
 * and everything after it — the lock, the held-ask check with its one Slack read, the park — is the draft
 * register's. The pure half is `../../../review/reviewAskDraft.ts`.
 */

import { z } from "zod";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { readSlackDraftLines } from "../../../admit/slackDraftStore.js";
import { slackUserToken } from "../../../config.js";
import { CONSOLE_URL_ENV, consoleBaseFrom } from "../../../hand/consoleLink.js";
import { slopweaverHome } from "../../../homeDir.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import type { ReceiptsDeclaration } from "../../../outbound/slack/draftReceipts.js";
import type { SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import { loadProfile } from "../../../profileStore.js";
import {
  heldAskFor,
  heldDmChannelsFor,
  reviewAskFormOf,
  reviewAskReceiptsOf,
  reviewAskWhyOf,
} from "../../../review/reviewAskDraft.js";
import { prKeyOfRow } from "../../../review/reviewerHook.js";
import type { ReviewerReadingRow } from "../../../review/reviewerReading.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { DraftRecordOptions } from "../slack/draftCore.js";
import { type ReviewAskError, ReviewAskErrors } from "./reviewAskErrors.js";

/** An approved pick's ask, held on the owner's queue: the parked draft and the console card that shows it. */
export interface ParkedAsk {
  readonly draftId: string;
  readonly consoleUrl: string;
}

/** What finding or parking an approved pick's ask touches outside itself. */
export interface ReviewerAskDeps {
  /** Slack id → name, from the roster — what a parked ask's why calls a person the reading never named. */
  readonly rosterNames: (args: {
    home: string | undefined;
  }) => Promise<Result<ReadonlyMap<string, string>, IdentityRosterError>>;
  /** The draft register, folded — what an approve reads for an ask already held. */
  readonly drafts: (args: { home: string | undefined }) => readonly SlackDraftItem[];
  /**
   * The member on the other end of a `D…` DM, through the door as the owner (`conversations.info`, a read), or
   * `undefined` when Slack could not say.
   */
  readonly dmUser: (args: { home: string | undefined; channel: string }) => Promise<string | undefined>;
  /** The console card a held draft opens on. */
  readonly draftUrl: (args: { id: string }) => Promise<string>;
  /**
   * Park an approved pick's ask through `slack draft record`'s own path — every as-me gate, nothing sent. `err`
   * carries why nothing parked.
   */
  readonly parkAsk: (args: {
    home: string | undefined;
    channel: string;
    form: string;
    why: string;
    /** What the ask declares about its receipts ({@link reviewAskReceiptsOf}). */
    receipts: ReceiptsDeclaration;
  }) => Promise<Result<ParkedAsk, ReviewAskError>>;
  /**
   * Hold the lock one person-and-pull-request's ask is parked under, so two approves pressed together cannot
   * both find nothing held and both park. `err` says who holds it.
   */
  readonly lockAsk: (args: {
    home: string | undefined;
    key: string;
    nowIso: string;
  }) => Result<{ readonly release: () => void }, string>;
  readonly now: () => string;
}

/** The ask an approve leads to, and whether it was already held. */
export interface ApprovedAsk {
  readonly ask: ParkedAsk;
  readonly reused: boolean;
}

/**
 * The ask an approve leads to: the one already held on the owner's queue, or a new one parked for the owner's yes. The check
 * and the park run under one lock per PERSON: the page draws the Approve button twice (the row's fold and the
 * slide-over), and two presses racing each found nothing held and both parked. Per person rather than per pull
 * request because asks to one person are one batch (`../../../outbound/slack/draftSamePersonDay.ts`), and two
 * approves for them on different pull requests would otherwise both pass that hold and park two cards.
 *
 * @param reviewer the picked person's Slack member id
 * @param row the pull request the pick is on
 * @param people Slack id to name, from the reading, so the queue card names the person
 * @returns the held draft and whether it was already there, or why nothing parked
 */
export async function askFor({
  deps,
  home,
  reviewer,
  row,
  people,
}: {
  deps: ReviewerAskDeps;
  home: string | undefined;
  reviewer: string;
  row: ReviewerReadingRow;
  people: ReadonlyMap<string, string>;
}): Promise<Result<ApprovedAsk, ReviewAskError>> {
  const lock = deps.lockAsk({ home, key: `review-ask|${reviewer}`, nowIso: deps.now() });
  if (lock.isErr()) {
    return err(ReviewAskErrors.askLocked({ holder: lock.error, reviewer }));
  }
  try {
    return await checkThenPark({ deps, home, people, reviewer, row });
  } finally {
    lock.value.release();
  }
}

/**
 * The id of the ask to this person about this pull request already held on the owner's queue. A held draft that links
 * the pull request in a `D…` DM is asked of Slack for whose DM it is; one Slack cannot answer for stops the
 * park rather than risk a second ask to the same person.
 *
 * @param url the pull request's address
 * @returns the held draft's id, nothing when none is held, or why it cannot be told
 */
async function heldAskOf({
  deps,
  home,
  reviewer,
  url,
}: {
  deps: ReviewerAskDeps;
  home: string | undefined;
  reviewer: string;
  url: string;
}): Promise<Result<string | undefined, ReviewAskError>> {
  const items = deps.drafts({ home });
  const dmUsers = new Map<string, string>();
  const unknown: string[] = [];
  for (const channel of heldDmChannelsFor({ items, url })) {
    const user = await deps.dmUser({ channel, home });
    if (user === undefined) {
      unknown.push(channel);
    } else {
      dmUsers.set(channel, user);
    }
  }
  const held = heldAskFor({ dmUsers, items, reviewer, url });
  if (held !== undefined || unknown.length === 0) {
    return ok(held);
  }
  return err(ReviewAskErrors.dmUnresolved({ channels: unknown }));
}

/**
 * {@link askFor}'s body, run under its lock.
 *
 * @returns the held draft and whether it was already there, or why nothing parked
 */
async function checkThenPark({
  deps,
  home,
  reviewer,
  row,
  people,
}: {
  deps: ReviewerAskDeps;
  home: string | undefined;
  reviewer: string;
  row: ReviewerReadingRow;
  people: ReadonlyMap<string, string>;
}): Promise<Result<ApprovedAsk, ReviewAskError>> {
  const held = await heldAskOf({ deps, home, reviewer, url: row.url });
  if (held.isErr()) {
    return err(held.error);
  }
  if (held.value !== undefined) {
    return ok({ ask: { consoleUrl: await deps.draftUrl({ id: held.value }), draftId: held.value }, reused: true });
  }
  let who = reviewer;
  const named = people.get(reviewer);
  const rosterNames = await deps.rosterNames({ home });
  if (rosterNames.isErr()) {
    return err(ReviewAskErrors.rosterUnreadable({ detail: rosterNames.error.message }));
  }
  const rostered = rosterNames.value.get(reviewer);
  if (named !== undefined) {
    who = named;
  } else if (rostered !== undefined) {
    who = rostered;
  }
  const form = reviewAskFormOf({ number: row.number, title: row.title, url: row.url });
  const parked = await deps.parkAsk({
    channel: reviewer,
    form,
    home,
    receipts: reviewAskReceiptsOf({ form, url: row.url }),
    why: reviewAskWhyOf({ prKey: prKeyOfRow({ row }), who }),
  });
  return parked.map((ask) => ({ ask, reused: false }));
}

/**
 * What an approve prints once its pick row is written: the receipt and exit 0 when the ask is held, or why
 * not, then that the pick stands but nothing parked, and exit 1.
 *
 * @param asked what {@link askFor} answered
 * @param json whether the verb was asked for its JSON receipt
 * @param path the reviewer register the pick row was written to
 * @param row the pick row written
 * @returns the lines for each channel and the exit code
 */
export function approveReceiptOf({
  asked,
  json,
  path,
  row,
}: {
  asked: Result<ApprovedAsk, ReviewAskError>;
  json: boolean;
  path: string;
  row: { readonly reviewer: string; readonly prKey: string };
}): { readonly out: readonly string[]; readonly diagnostics: readonly string[]; readonly code: number } {
  if (asked.isErr()) {
    return {
      code: EXIT_ERROR,
      diagnostics: [
        `github reviewer: ${asked.error.message}`,
        `github reviewer: recorded approve of ${row.reviewer} for ${row.prKey}, but NO ask was parked and nothing ` +
          "was sent. Park it with `slopweaver slack draft record` once the reason above is fixed.",
      ],
      out: [],
    };
  }
  const { ask, reused } = asked.value;
  if (json) {
    const value = { ask: { ...ask, reused }, path, recorded: true, row, sent: false };
    return { code: EXIT_OK, diagnostics: [], out: [safeJsonStringify({ label: "a reviewer pick receipt", value })] };
  }
  let parked = `parked the ask ${ask.draftId} for your yes`;
  if (reused) {
    parked = `the ask ${ask.draftId} was already waiting for your yes`;
  }
  return {
    code: EXIT_OK,
    diagnostics: [],
    out: [
      `github reviewer: recorded approve of ${row.reviewer} for ${row.prKey}, and ${parked}: ${ask.consoleUrl}. ` +
        "Nothing was sent; the page reads 'picked' until a later reading sees the ask.",
    ],
  };
}

/**
 * The home a read resolves against: the one passed with `--home`, else the ambient one.
 *
 * @returns the home directory
 */
export function reviewerHomeOf({ home }: { home: string | undefined }): string {
  if (home === undefined) {
    return slopweaverHome();
  }
  return home;
}

/**
 * The Slack ids a reviewer is never suggested or picked from: the owner's and the owner's bot's, from the profile —
 * whoever the install declares.
 *
 * @returns the ids, empty when the profile declares none
 */
export function reviewerExcludedIds({ home }: { home: string | undefined }): ReadonlySet<string> {
  const slackBot = loadProfile({ home: reviewerHomeOf({ home }) })?.slackBot;
  // An absent bot list is an empty set: `new Set(undefined)` holds nothing.
  const ids = new Set<string>(slackBot?.botUserIds);
  if (slackBot?.ownerUserId !== undefined) {
    ids.add(slackBot.ownerUserId);
  }
  return ids;
}

/** What `slack draft record --json` prints on a park — the only two fields the pick receipt carries on. */
const parkedDocument = z.object({ consoleUrl: z.string(), item: z.object({ id: z.string() }) });

/**
 * The console's origin, as `slack draft record` resolves it, so a reused ask links the same card a new one does.
 *
 * @returns the console base URL
 */
function liveConsoleBase(): string {
  return consoleBaseFrom({ configured: process.env[CONSOLE_URL_ENV] });
}

/**
 * The `slack draft record` options an ask parks with. A review ask is a message to a person, never a finding
 * (`../../../outbound/slack/findingIdentity.ts`).
 *
 * @returns the parsed-record options {@link parkAskThroughDraftRecord} hands the recorder
 */
function reviewAskRecordOptions({
  home,
  channel,
  form,
  receipts,
  why,
}: {
  home: string | undefined;
  channel: string;
  form: string;
  receipts: ReceiptsDeclaration;
  why: string;
}): DraftRecordOptions {
  return {
    // What the card badges it: a review ask, never guessed from the `why`.
    act: "review-ask",
    actor: "me",
    // The FIRST ask of the reviewer the owner just picked: an ask to them about this pull request already held is reused
    // above (`heldAskOf`) rather than recorded again. One released earlier is not read here — the residue
    // `skills/slack/reference/asked-before.md` names.
    askedBefore: { kind: "none" },
    channel,
    formSource: form,
    home: reviewerHomeOf({ home }),
    json: true,
    kind: "message",
    media: [],
    mode: "record",
    // The ask links the pull request it is about, so its receipt is read off the message (`reviewAskReceiptsOf`).
    receipts,
    // The owner's approved pick, and by the owner's own criterion a person who was not in the conversation the work came from
    // is the wrong one — so the bare ask this composes opens on the ask, which only an in-thread reviewer takes.
    reviewer: "in-thread",
    supersedes: [],
    why,
  };
}

/**
 * Park an ask through `slack draft record` itself — the same gates, the same register, the same card — with
 * its report captured rather than printed, so the pick's receipt is the one document this verb prints. Its
 * refusals still reach stderr through its own logger, which is where the console's act route reads them.
 *
 * Loaded on first use: `list` is polled by the page and never parks, so it does not pay for the Slack lane.
 *
 * @returns the parked draft, or why nothing parked
 */
async function parkAskThroughDraftRecord({
  home,
  channel,
  form,
  receipts,
  why,
}: {
  home: string | undefined;
  channel: string;
  form: string;
  receipts: ReceiptsDeclaration;
  why: string;
}): Promise<Result<ParkedAsk, ReviewAskError>> {
  const [{ runDraftRecord }, { liveSlackDraftDeps }] = await Promise.all([
    import("../slack/draftRecordEntry.js"),
    import("../slack/draftWiring.js"),
  ]);
  const printed: string[] = [];
  const code = await runDraftRecord({
    deps: {
      ...liveSlackDraftDeps(),
      out: (line) => {
        printed.push(line);
      },
    },
    options: reviewAskRecordOptions({ channel, form, home, receipts, why }),
  });
  if (code !== EXIT_OK) {
    return err(ReviewAskErrors.parkRefused({ exitCode: code }));
  }
  const parsed = parkedDocument.safeParse(
    safeJsonParse({ label: "slack draft record's park report", text: printed.join("\n") }),
  );
  if (!parsed.success) {
    return err(ReviewAskErrors.parkReportUnreadable({ detail: parsed.error.message }));
  }
  return ok({ consoleUrl: parsed.data.consoleUrl, draftId: parsed.data.item.id });
}

/**
 * The real seams for the ask, less the roster and the clock the verb already holds.
 *
 * @returns the production dependencies {@link askFor} needs beyond the verb's own
 */
export function productionReviewerAskDeps(): Omit<ReviewerAskDeps, "rosterNames" | "now"> {
  return {
    dmUser: async ({ home, channel }) => {
      const token = slackUserToken({ home: reviewerHomeOf({ home }) });
      if (token === undefined) {
        return undefined;
      }
      const { makeSlackWriteTransport } = await import("../../../corpus/slack/writeApi.js");
      return (await makeSlackWriteTransport({ home: reviewerHomeOf({ home }), token }).conversationInfo({ channel }))
        .user;
    },
    draftUrl: async ({ id }) => {
      const { draftConsoleUrl } = await import("../slack/draftPark.js");
      return draftConsoleUrl({ deps: { consoleBase: liveConsoleBase }, id });
    },
    drafts: ({ home }) =>
      foldSlackDraftLog({
        log: parseSlackDraftLog({ lines: readSlackDraftLines({ home: reviewerHomeOf({ home }) }) }),
      }),
    lockAsk: ({ home, key, nowIso }) => acquireOperationLock({ home: reviewerHomeOf({ home }), key, nowIso }),
    parkAsk: parkAskThroughDraftRecord,
  };
}
