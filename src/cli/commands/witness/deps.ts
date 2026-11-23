/**
 * The real effects behind the `witness` verbs' seams — the one file in the noun that touches cmux, git, Slack
 * (through the capture chain `witness help` shares with the listener) and the journal on disk. Every verb's logic lives in `../../../live/witness/session.ts` against plain fakes;
 * this is only the wiring.
 *
 * `productionSpawnDeps()` holds a live socket and an event subscription, both of which keep the event loop
 * alive, so it is opened and closed around EACH call rather than once per verb — the same discipline
 * `../turn/dispatchFreshSession.ts` keeps, and for the same reason: a verb that forgets prints its answer and
 * then hangs forever.
 */
import { runningCheckoutBranch, runningCheckoutRoot } from "#lib/gitRepo.js";
import { logger } from "#lib/logger.js";
import { err, ok } from "#lib/result.js";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { acquireOperationLock } from "../../../admit/operationLock.js";
import { readSlackDraftLines } from "../../../admit/slackDraftStore.js";
import { slopweaverHome } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import type { SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import { currentlyIgnoredConversations } from "../../../live/ask/ignoredConversationStore.js";
import { currentlyIgnoredAsks } from "../../../live/ask/ignoreStore.js";
import { parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import { capturedMentionHandler } from "../../../live/listen/capture.js";
import { type EmittedMention, emittedMention } from "../../../live/listen/handoff.js";
import type { ListenLog } from "../../../live/listen/socket.js";
import { admitResponder } from "../../../live/listen/whitelist.js";
import { loadResponderWhitelist } from "../../../live/listen/whitelistStore.js";
import { readWitnessState } from "../../../live/listen/witnessStateStore.js";
import { fetchCompleteSlackThread } from "../../../live/slack/pagination.js";
import { deliverFreshSessionPickup, launchFreshVisibleSession } from "../../../live/turn/freshSession.js";
import { closeWitnessWorkspace, type WitnessCloseTarget } from "../../../live/witness/close.js";
import type { WitnessHelpDeps, WitnessHelpRequest } from "../../../live/witness/help.js";
import { WitnessHelpErrors } from "../../../live/witness/helpErrors.js";
import { helpFactsFrom } from "../../../live/witness/helpFacts.js";
import { helpThreadVerdict } from "../../../live/witness/helpThread.js";
import { appendWitnessEvent, readWitnessJournal } from "../../../live/witness/journalStore.js";
import { launchWitnessSession } from "../../../live/witness/launch.js";
import { witnessReplyReserved } from "../../../live/witness/replyReserved.js";
import type { WitnessReviseDeps } from "../../../live/witness/revise.js";
import { WitnessReviseErrors } from "../../../live/witness/reviseErrors.js";
import type { WitnessDispatchDeps, WitnessJournalDeps } from "../../../live/witness/session.js";
import type { WitnessStandDownDeps } from "../../../live/witness/standDown.js";
import { standDownReactionEmojiFromProfile } from "../../../profileStore.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { productionSpawnDeps } from "../../../sessionHarness/recordedSpawn.js";
import { recordingSessionHarness } from "../../../sessionHarness/recordingHarness.js";
import { sessionLedgerDeps } from "../../../sessionHarness/sessionLedger.js";
import type { SupervisorSession } from "../../../supervisor/session.js";
import { EXIT_OK } from "../../exitCodes.js";
import { liveCaptureDeps } from "../listen/liveCapture.js";
import { type CorrectRunContext, runCorrect } from "../slack/correctRun.js";
import { productionLifecycleDeps } from "../slack/lifecycleRun.js";

/**
 * One lock per home, not per key: the one-at-a-time cap is a check across every witness in the journal, and a
 * settle must not land between a dispatch's read and its `dispatched` row.
 */
const WITNESS_LOCK_KEY = "witness-journal";

/**
 * Close one witness workspace over a connection opened for the call, parked through the RECORDING harness so the
 * session ledger row its boot opened is closed by the same act (`../../../live/witness/close.ts`).
 *
 * @param home the state home whose session ledger records the close; the resolved home when absent
 * @param target the workspace to close and the ledger key its boot registered
 * @returns the failure text, or `undefined` once it is closed
 */
async function closeWorkspaceRecorded({
  home,
  target,
}: {
  home: string | undefined;
  target: WitnessCloseTarget;
}): Promise<string | undefined> {
  const callerWorkspaceId = process.env["CMUX_WORKSPACE_ID"];
  // The same resolved home the boot's row was written under (`productionWitnessDispatchDeps`'s `launch`).
  const ledger = sessionLedgerDeps({ home: lockHomeOf({ home }) });
  try {
    return await withCmuxSessionHost({
      body: ({ harness }) =>
        closeWitnessWorkspace({
          callerWorkspaceId,
          harness: recordingSessionHarness({ callerSessionId: callerWorkspaceId, harness, ledger }),
          ledger,
          target,
        }),
    });
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

/** The home the lock file lives in: the one named, else the resolved one — read only when a lock is taken. */
function lockHomeOf({ home }: { home: string | undefined }): string {
  if (home !== undefined) {
    return home;
  }
  return slopweaverHome();
}

/**
 * The journal effects for one state home.
 *
 * @param home the state home; the resolved home when absent
 * @returns the real journal, close and clock seams
 */
export function productionWitnessJournalDeps({ home }: { home: string | undefined }): WitnessJournalDeps {
  const homeArg = home === undefined ? {} : { home };
  return {
    append: ({ event }) => appendWitnessEvent({ event, ...homeArg }),
    closeWorkspace: (target) => closeWorkspaceRecorded({ home, target }),
    // Never aged out while its holder lives: a launch stalled past any threshold has read the journal and will
    // still append, so a second dispatch taking the lock over would pass the cap on the same empty read.
    // A dead holder is still taken over.
    lock: () =>
      acquireOperationLock({
        home: lockHomeOf({ home }),
        key: WITNESS_LOCK_KEY,
        nowIso: new Date().toISOString(),
        staleAfterMs: Number.POSITIVE_INFINITY,
      }),
    nowIso: () => new Date().toISOString(),
    readJournal: () => readWitnessJournal(homeArg),
  };
}

/**
 * Every effect `witness help` needs, for real: the journal and lock, the facts read fresh off the home under
 * that lock, and the listener's own capture chain (👀, the card, the lifecycle rows) over the bot transport.
 *
 * @param home the resolved state home
 * @param openOverride whether the journalled `responder-allow-open` grant is open, exactly as the listener asks it
 * @param supervisor the visible supervisor session the card is attributed to, when there is one
 * @param token the bot token the thread re-read uses — a read, beside the transport's writes
 * @param transport the bot's Slack write transport — the door every capture effect posts through
 * @returns the real help seams
 */
export function productionWitnessHelpDeps({
  home,
  openOverride,
  supervisor,
  token,
  transport,
}: {
  home: string;
  openOverride: boolean;
  supervisor: SupervisorSession | undefined;
  token: string;
  transport: SlackWriteTransport;
}): WitnessHelpDeps {
  const journal = productionWitnessJournalDeps({ home });
  const log: ListenLog = ({ line }) => {
    logger.error({ msg: `witness help: ${line}` });
  };
  return {
    append: journal.append,
    capture: async ({ mention }) => {
      const { checklist, reaction } = liveCaptureDeps({
        doorLedger: doorLedgerPort(),
        home,
        log,
        supervisor,
        transport,
      });
      let emitted: EmittedMention | undefined;
      const handler = capturedMentionHandler({
        checklist,
        lifecycle: { home, log },
        reaction,
        sink: async (captured) => {
          emitted = emittedMention({ mention: captured });
          await Promise.resolve();
        },
      });
      await handler(mention);
      return emitted;
    },
    facts: ({ nowIso, request }) => helpFactsOfHome({ home, nowIso, openOverride, request }),
    lock: journal.lock,
    nowIso: journal.nowIso,
    readJournal: journal.readJournal,
    thread: ({ request }) => helpThreadOfSlack({ home, openOverride, request, token, transport }),
  };
}

/**
 * Every effect `witness stand-down` needs, for real: the journal and lock, the profile's emoji, and one
 * `reactions.add` over the bot's write transport — the only Slack write it ever makes.
 *
 * @param home the resolved state home
 * @param transport the bot's Slack write transport
 * @returns the real stand-down seams
 */
export function productionWitnessStandDownDeps({
  home,
  transport,
}: {
  home: string;
  transport: SlackWriteTransport;
}): WitnessStandDownDeps {
  const journal = productionWitnessJournalDeps({ home });
  return {
    append: journal.append,
    emoji: standDownReactionEmojiFromProfile({ home }),
    lock: journal.lock,
    nowIso: journal.nowIso,
    react: async ({ emoji, key }) =>
      transport.addReaction({ name: emoji, posted: { channel: key.channel, ts: key.messageTs } }),
    readJournal: journal.readJournal,
  };
}

/** `witness revise`'s run of the correction: journalled as its own verb, and a re-run showing the same line has landed. */
const WITNESS_REVISE_CONTEXT: CorrectRunContext = {
  action: { kind: "verb", noun: "witness", verb: "revise" },
  alreadyCorrected: "landed-if-same",
};

/**
 * Every effect `witness revise` needs, for real: the journal and lock, and `slack correct`'s own runner — door,
 * voice rules, ownership and read-back — aimed at the reply the journal recorded.
 *
 * @param home the resolved state home
 * @returns the real revise seams
 */
export function productionWitnessReviseDeps({ home }: { home: string }): WitnessReviseDeps {
  const journal = productionWitnessJournalDeps({ home });
  return {
    append: journal.append,
    correct: async ({ channel, correction, dryRun, postedTs, wrong }) => {
      const exitCode = await runCorrect({
        context: WITNESS_REVISE_CONTEXT,
        deps: {
          ...productionLifecycleDeps(),
          readDraftLog: ({ home: draftHome }) => readSlackDraftLines({ home: draftHome }),
        },
        // A witness reply is the bot's own message, so it is corrected as the bot.
        options: { actor: "bot", channel, correction, dryRun, home, json: false, ts: postedTs, urgent: false, wrong },
      });
      if (exitCode !== EXIT_OK) {
        return err(WitnessReviseErrors.correctionNotApplied({ exitCode }));
      }
      return ok(undefined);
    },
    lock: journal.lock,
    nowIso: journal.nowIso,
    readJournal: journal.readJournal,
  };
}

/** The facts a help is judged on, read fresh off the home — the snapshot, both ignore registries, the lifecycle. */
function helpFactsOfHome({
  home,
  nowIso,
  openOverride,
  request,
}: {
  home: string;
  nowIso: string;
  openOverride: boolean;
  request: WitnessHelpRequest;
}): ReturnType<WitnessHelpDeps["facts"]> {
  const witnessState = readWitnessState({ home });
  if (witnessState.isErr()) {
    return err(WitnessHelpErrors.state({ why: witnessState.error.message }));
  }
  return ok(
    helpFactsFrom({
      ignoredAsks: currentlyIgnoredAsks({ home }),
      ignoredConversations: currentlyIgnoredConversations({ home }),
      lifecycleEvents: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events,
      nowIso,
      openOverride,
      request,
      whitelist: loadResponderWhitelist({ home }),
      witnessState: witnessState.value,
    }),
  );
}

/** Slack's own read of the help's thread, checked by `helpThreadVerdict` against the same whitelist a tag crosses. */
async function helpThreadOfSlack({
  home,
  openOverride,
  request,
  token,
  transport,
}: {
  home: string;
  openOverride: boolean;
  request: WitnessHelpRequest;
  token: string;
  transport: SlackWriteTransport;
}): ReturnType<WitnessHelpDeps["thread"]> {
  try {
    const self = await transport.whoAmI();
    if (self.userId === undefined) {
      return err(WitnessHelpErrors.threadUnreadable({ why: "auth.test named no bot user id" }));
    }
    const { channel, threadTs } = request.key;
    const thread = await fetchCompleteSlackThread({ api: makeSlackApi({ token }), channel, threadTs });
    if (thread.isErr()) {
      return err(WitnessHelpErrors.threadUnreadable({ why: thread.error.message }));
    }
    const whitelist = loadResponderWhitelist({ home });
    return helpThreadVerdict({
      admits: ({ userId }) => admitResponder({ openOverride, userId, whitelist }).admitted,
      request,
      rows: thread.value.rawMessages,
      selfUserId: self.userId,
    });
  } catch (cause) {
    return err(WitnessHelpErrors.threadUnreadable({ why: cause instanceof Error ? cause.message : String(cause) }));
  }
}

/**
 * Every effect `witness dispatch` needs, for real.
 *
 * @param home the state home; the resolved home when absent
 * @returns the real dispatch seams
 */
export function productionWitnessDispatchDeps({ home }: { home: string | undefined }): WitnessDispatchDeps {
  return {
    ...productionWitnessJournalDeps({ home }),
    checkout: () => {
      // A detached HEAD has no branch to record; the plan names that state rather than an empty string.
      const current = runningCheckoutBranch();
      let branch = "detached";
      if (current !== undefined) {
        branch = current;
      }
      return { branch, repoRoot: runningCheckoutRoot() };
    },
    deliver: async ({ plan, session }) => {
      const spawnDeps = productionSpawnDeps();
      try {
        return await deliverFreshSessionPickup({ deps: spawnDeps, plan, session });
      } finally {
        spawnDeps.close();
      }
    },
    launch: ({ plan }) =>
      launchWitnessSession({
        boot: async ({ plan: booted }) => {
          const spawnDeps = productionSpawnDeps();
          try {
            return await launchFreshVisibleSession({ deps: spawnDeps, plan: booted });
          } finally {
            spawnDeps.close();
          }
        },
        home: lockHomeOf({ home }),
        plan,
      }),
    replyReserved: ({ key }) =>
      witnessReplyReserved({ home: lockHomeOf({ home }), key, nowIso: new Date().toISOString() }),
  };
}
