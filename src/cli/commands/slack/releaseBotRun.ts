/**
 * `slack post|reply --as bot --draft <id> --approve <digest>` — the release of one parked bot card: resolve its row
 * (`./releaseRow.ts`), then run the ORDINARY bot card lane (`./cardWriteRun.ts`) over its form and its verified
 * media, with their approval recomputed after every gate and the row marked released once the card landed.
 */
import { errorMessage } from "../../../lib/errorMessage.js";
import type { ReleaseFreshnessError } from "../../../outbound/slack/releaseFreshness.js";
import { type CardDraftRelease, runSlackCardWrite } from "./cardWriteRun.js";
import type { SlackCardOptions, SlackDraftReleaseOptions } from "./coreTypes.js";
import { slackLifecycleErrorLines } from "./lifecycleErrors.js";
import { releaseFreshness, releasePriorAsk } from "./releaseFreshnessGate.js";
import { stampedGroupDmRefusal } from "./releaseGroupDm.js";
import { appendReleaseHold, holdFreshnessRefusal } from "./releaseRefusalHold.js";
import {
  markDraftReleased,
  offeredDigestRefusal,
  type ResolvedDraftRow,
  releaseMediaLines,
  resolveDraftRow,
  rowMovedBeforeSend,
  servedMedia,
} from "./releaseRow.js";
import type { SlackWriteDeps } from "./run.js";
import { unreadableProfileExit } from "./voiceAdmission.js";
import { usage } from "./writeOutput.js";

/**
 * The card options a parked `--as bot` row sends as: its channel, placement and form, its verified media keyed
 * as the served `readMedia` answers them, and `approvedDraft` — the one field that lets a finding go into the
 * channel and thread they approved it for.
 *
 * @param options the parsed release
 * @param row the resolved row
 * @returns the card options the ordinary bot lane runs against
 */
export function botReleaseCardOptions({
  options,
  row,
}: {
  options: SlackDraftReleaseOptions;
  row: ResolvedDraftRow;
}): SlackCardOptions {
  const { draft } = row;
  return {
    actor: "bot",
    allowUnresolvedOwner: false,
    approvedDraft: true,
    channel: draft.channel,
    dryRun: options.dryRun,
    formJson: row.formJson,
    home: options.home,
    json: options.json,
    media: [...row.media.keys()],
    resendUnconfirmed: options.resendUnconfirmed,
    verb: draft.threadTs === undefined ? "post" : "reply",
    ...(draft.threadTs === undefined ? {} : { threadTs: draft.threadTs }),
  };
}

/**
 * Release one parked `--as bot` draft: resolve its row, then run the ORDINARY bot card lane over its form and its
 * verified media, with their approval checked after every gate and the row marked released once the card landed. A throw
 * once the release reached its Slack reads holds the row `slack-refused` before it goes on, so their Queue card says why
 * their yes did not go out.
 *
 * @returns the process exit code
 */
export async function runBotDraftRelease({
  deps,
  options,
  token,
}: {
  deps: SlackWriteDeps;
  options: SlackDraftReleaseOptions;
  token: string;
}): Promise<number> {
  // READ before stdin or Slack, as a fresh bot card does: a corrupt profile is a fact about the install.
  const rules = deps.voiceRules({ home: options.home });
  if (rules.isErr()) {
    return unreadableProfileExit({ error: rules.error, nothingHappened: "nothing was posted." });
  }
  const row = resolveDraftRow({ deps, options });
  if (row.isErr()) {
    return usage({ errors: slackLifecycleErrorLines({ error: row.error }) });
  }
  // A bot row is never stamped, so a stamp is a hand-written line: re-read it, and a group DM the bot cannot read fails.
  const groupDm = await stampedGroupDmRefusal({ deps, draft: row.value.draft, token });
  if (groupDm !== undefined) {
    return usage({ errors: slackLifecycleErrorLines({ error: groupDm }) });
  }
  const { media } = row.value;
  if (!options.json) {
    for (const line of releaseMediaLines({ media })) {
      deps.out(line);
    }
  }
  const hooks = botReleaseHooks({ deps, options, row: row.value, token });
  // Whether the card's own gates passed and the release reached its Slack reads — the approval's identity check, the
  // re-read, the send — so a throw from then on is Slack refusing rather than a check that never asked it. A holder,
  // not a `let`: the hook sets it from a closure, which flow analysis cannot see, so a bare `false` reads as never set.
  const reached: { slack: boolean } = { slack: false };
  const release: CardDraftRelease = {
    ...hooks,
    drift: async (args) => {
      reached.slack = true;
      return hooks.drift(args);
    },
  };
  try {
    return await runSlackCardWrite({
      cardOptions: botReleaseCardOptions({ options, row: row.value }),
      deps: { ...deps, readMedia: servedMedia({ media }) },
      release,
      token,
    });
  } catch (error) {
    if (reached.slack && !options.dryRun) {
      const why = `Slack refused the bot card: ${errorMessage({ error })}`;
      appendReleaseHold({ deps, home: options.home, id: row.value.draft.id, reason: "slack-refused", why });
    }
    throw error;
  }
}

/**
 * The register read once more after the bot lane's live reads awaited Slack: a channel steer, a pick or a re-cut
 * landing while they ran stops the card exactly as the as-me lane's own re-read does.
 *
 * @param draft the row as the release resolved it
 * @returns the refusal's lines, empty when the row still says what their yes named
 */
function registerMovedLines({
  deps,
  draft,
  home,
}: {
  deps: SlackWriteDeps;
  draft: ResolvedDraftRow["draft"];
  home: string;
}): readonly string[] {
  const moved = rowMovedBeforeSend({ deps, draft, home });
  return moved === undefined ? [] : slackLifecycleErrorLines({ error: moved });
}

/**
 * The two hooks the card lane runs a bot release through: `drift`, which proves their approval names the bytes about to
 * post, re-reads the thread for a person's change and then the register for a steer, pick or re-cut, and `landed`,
 * which marks the row released.
 *
 * @param row the resolved row, its held re-cuts and verified media included
 * @param token the bot token the freshness re-read goes out under
 * @returns the release hooks, sharing what the re-read cleared between them
 */
function botReleaseHooks({
  deps,
  options: { dryRun, home, threadMovedCleared },
  row,
  token,
}: {
  deps: SlackWriteDeps;
  options: SlackDraftReleaseOptions;
  row: ResolvedDraftRow;
  token: string;
}): CardDraftRelease {
  const { draft, heldCuts, media } = row;
  const records = [...media.values()].map((entry) => entry.record);
  // What the freshness re-read cleared, carried from the drift hook to the released event.
  let cleared: readonly string[] = [];
  // The thread moving is one of their named reasons not to send, so it is held on the row as well as refused.
  const movedOn = ({ error }: { error: ReleaseFreshnessError }): readonly string[] => {
    holdFreshnessRefusal({ deps, draftId: draft.id, dryRun, error, home });
    return [error.message];
  };
  return {
    drift: async ({ plan, resolution }) => {
      const refusal = await offeredDigestRefusal({
        deps,
        draft,
        media: records,
        payload: plan.payload,
        resolution,
        threadTs: plan.threadTs,
        token,
      });
      if (refusal.length > 0) {
        return refusal;
      }
      // After the approval is proven to name these bytes, before anything posts: has a person moved it?
      const fresh = await releaseFreshness({ cleared: threadMovedCleared, deps, draft, home, token });
      if (fresh.isErr()) {
        return movedOn({ error: fresh.error });
      }
      const prior = await releasePriorAsk({ deps, draft, token });
      if (prior.isErr()) {
        return movedOn({ error: prior.error });
      }
      cleared = fresh.value;
      return registerMovedLines({ deps, draft, home });
    },
    lastCheck: () => registerMovedLines({ deps, draft, home }),
    // The card lane answers no permalink, so a bot row journals its channel and ts alone.
    landed: ({ sent }) =>
      markDraftReleased({
        deps,
        draft,
        heldCuts,
        home,
        permalink: undefined,
        threadMovedCleared: cleared,
        ts: sent.ts,
      }),
  };
}
