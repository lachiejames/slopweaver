/**
 * The THIN SHELL for the lifecycle verbs. Every decision worth reviewing is in `./lifecycleCore.ts` or one
 * of the per-verb files this module only orchestrates: `./lifecycleRunEdit.ts` (`edit`) and
 * `./lifecycleRunDelete.ts` (`delete`). This file only wires the dispatch, the production world, and the
 * two command exports the manifest loads.
 *
 * The order that matters, and it is the same for every verb: resolve the token, read the state, run the
 * OWNERSHIP check for anything that mutates an existing message, then route the mutation through
 * `throughDoor`. Nothing reaches Slack outside a `perform` thunk.
 *
 * ## There is no progress lifecycle here any more
 *
 * `slack progress start|step|watch|finish|sweep` drew a SECOND live-progress shape — a bar, a count and an
 * elapsed clock — beside the one the turn card already draws, and a worker whose card path had dead-ended
 * reached for it in a public channel. There is now exactly one progress shape in
 * `src/outbound`: `assistant/todoBlock.ts`'s checklist, written by `turn status`/`turn watch`. A stale
 * spinner an old run left behind is removed by its own ts with `slopweaver slack delete`.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { recordExactVoicePainPoints } from "../../../admit/painPoint.js";
import { journalSlackDraftDeletion } from "../../../admit/slackDraftStore.js";
import { slackBotToken, slackUserToken, slopweaverHome } from "../../../config.js";
import { makeSlackWriteApi, makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { makeSlackAccountReader } from "../../../corpus/slack/writeApiAccount.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import { cardNameLookup } from "../../../live/turn/cardNames.js";
import { mentionsFromIdentity } from "../../../outbound/slack/mentionWiring.js";
import { readExactVoiceRules, readHighStakesConfig } from "../../../profileStore.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { imageAdmitFor } from "../../../visualEvidence/prepareUploads.js";
import { bareRefContext as bareRefContextFor } from "../../bareRefContext.js";
import { defineCommand } from "../../defineCommand.js";
import { type SlackParsed, slackArgumentErrorLines } from "./argumentErrors.js";
import { type LifecycleOptions, parseDeleteArgs, parseEditArgs } from "./lifecycleCore.js";
import { runDelete } from "./lifecycleRunDelete.js";
import { runEdit } from "./lifecycleRunEdit.js";
import { usage } from "./lifecycleRunShared.js";
import type { LifecycleDeps } from "./lifecycleRunTypes.js";
import { liveReadiness } from "./uploadReadiness.js";
import { liveVerifiedOwnDm } from "./verifiedOwnDm.js";
import { voiceBriefingExit } from "./voiceBriefingGate.js";
import {
  chromeFromProfile,
  dripConfigFromProfile,
  freshSlackIdsNow,
  pollEventTypeFromProfile,
  standaloneProgressEventTypeFromProfile,
} from "./wiring.js";

export type { LifecycleDeps } from "./lifecycleRunTypes.js";

/**
 * Run one lifecycle verb.
 *
 * @param options the parsed invocation
 * @param deps the injected world
 * @returns the process exit code
 */
export async function runLifecycle({
  options,
  deps,
}: {
  options: LifecycleOptions;
  deps: LifecycleDeps;
}): Promise<number> {
  switch (options.kind) {
    case "edit": {
      // A rewrite is new words in the owner's name, so a session never shown their voice brief is refused first.
      const applies = options.actor === "me";
      const unbriefed = voiceBriefingExit({ applies, env: deps.doorEnv(), home: options.home, now: deps.nowIso });
      if (unbriefed !== undefined) {
        return unbriefed;
      }
      return runEdit({ deps, options });
    }
    case "delete":
      return runDelete({ deps, options });
  }
}

/**
 * The production wiring for the lifecycle verbs.
 *
 * @returns the real world, wired
 */
export function productionLifecycleDeps(): LifecycleDeps {
  // One bag per verb call, so this is the send's ask instant — what the roster's freshness is judged against.
  const askedAtIso = new Date().toISOString();
  return {
    bareRefContext: ({ home }) => bareRefContextFor({ home }),
    botToken: ({ home }) => slackBotToken({ home }),
    cardChrome: ({ home }) => chromeFromProfile({ home }),
    cardNames: ({ home }) => cardNameLookup({ home }),
    doorEnv: () => process.env,
    doorLedger: doorLedgerPort(),
    dripConfig: ({ home }) => dripConfigFromProfile({ home }),
    highStakes: ({ home }) => readHighStakesConfig({ home }),
    journalDraftDeletion: (args) => journalSlackDraftDeletion(args),
    standaloneProgressEventType: ({ home }) => standaloneProgressEventTypeFromProfile({ home }),
    makeApi: ({ token, home }) =>
      makeSlackWriteApi({
        admit: imageAdmitFor({ env: process.env, home, nowIso: new Date().toISOString() }),
        home,
        readiness: liveReadiness({ token }),
        token,
      }),
    makeTransport: ({ home, token }) => makeSlackWriteTransport({ home, token }),
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
    out: (line) => {
      logger.out({ line: line });
    },
    pollEventType: ({ home }) => pollEventTypeFromProfile({ home }),
    readMedia: async ({ path }) => ({ bytes: await readFile(path), filename: basename(path) }),
    readStdin,
    recordVoicePainPoints: ({ findings, home, lane }) => {
      recordExactVoicePainPoints({ findings, home, lane, tsIso: new Date().toISOString() });
    },
    resolvePollPeople: freshSlackIdsNow,
    resolveMentions: ({ groups, home, people }) =>
      mentionsFromIdentity({ askedAtIso, groups, home, identityRoster: identityRosterPort(), people }),
    taggedAccount: async ({ home, token, user }) => makeSlackAccountReader({ home, token })({ user }),
    userToken: ({ home }) => slackUserToken({ home }),
    verifiedOwnDm: liveVerifiedOwnDm,
    voiceRules: ({ home }) => readExactVoiceRules({ home }),
  };
}

/**
 * Where a verb's own flags start in `process.argv`: `[node, script, noun, verb, ...flags]`.
 *
 * The router hands every handler the FULL argv and each verb slices its own tail. PR5's worst shipped bug
 * was getting this wrong — it was invisible to seventy unit tests that passed a hand-made tail — so these
 * verbs are exercised through the real offset in the suite rather than only through `runLifecycle`.
 */
const VERB_ARG_OFFSET = 4;

/**
 * Run one lifecycle verb against SUPPLIED dependencies.
 *
 * `deps` defaults to the production set, so the two command exports are unchanged. It exists so a test can
 * drive edit/delete with plain fakes and assert that a refusal performs no effect — this module
 * exports door-routed external-write handlers and had no test importing it at all.
 *
 * @param argv the full process argv
 * @param parse the verb's argument parser
 * @param deps the injected dependencies (defaults to production)
 * @returns the process exit code
 */
export async function runLifecycleWithDeps({
  argv,
  parse,
  deps,
}: {
  argv: readonly string[];
  parse: (args: { rest: readonly string[]; defaultHome: string }) => SlackParsed<LifecycleOptions>;
  deps?: LifecycleDeps;
}): Promise<number> {
  const parsed = parse({ defaultHome: slopweaverHome(), rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return usage({ errors: slackArgumentErrorLines({ error: parsed.error }) });
  }
  if (deps === undefined) {
    // Built only after a successful parse: production deps stamp the ask's instant, which roster freshness reads.
    return runLifecycle({ deps: productionLifecycleDeps(), options: parsed.value });
  }
  return runLifecycle({ deps, options: parsed.value });
}

/** `slopweaver slack edit` — re-render a card slopweaver posted, in place. */
export const slackEditCommand = defineCommand({ run: (argv) => runLifecycleWithDeps({ argv, parse: parseEditArgs }) });

/** `slopweaver slack delete` — remove a message slopweaver posted. */
export const slackDeleteCommand = defineCommand({
  run: (argv) => runLifecycleWithDeps({ argv, parse: parseDeleteArgs }),
});

/**
 * The resolved default home, so each verb's parser agrees with the rest of the CLI.
 *
 * @returns the default state home, resolved through the one typed contract rather than re-derived here
 */
export function defaultLifecycleHome(): string {
  return slopweaverHome();
}
