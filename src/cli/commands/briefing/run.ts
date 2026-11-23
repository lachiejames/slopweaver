/**
 * `slopweaver briefing check <html>` — refuse a fleet-briefing artifact whose react-now cards or whose page
 * as a whole put a wall of text where the owner cannot avoid it
 * (`skills/supervisor/reference/fleet-briefing-shape.md`). Read-only — over the file, and over GitHub for
 * the one half that judges freshness; see `src/briefing/check.ts` for the actual rules. A non-zero exit
 * REPORTS a defect it found in a well-formed file, exactly like `audit hygiene` — it is not a broken tool.
 *
 * ## Why this edge loads a profile
 *
 * The caps are public and ship in this repository. The operator's banned characters and words do not: they
 * live in private `profile.json` configuration under the state home, which is why the check takes `--home`
 * and why the voice half of the gate is applied HERE rather than inside a schema. That is the same split
 * `../../aboveFoldDoor.ts` makes at every other outbound door, and it honours the same journalled hatch —
 * a `voice-rules` grant lifts exactly the packing and voice findings, and never a cap.
 *
 * ## Why this edge reaches GitHub
 *
 * One half of the gate — `../../../briefing/prPremise.ts` — asks whether the pull request a card is about
 * has merged, closed or entered the merge queue since the sweep that composed it. Nothing on disk can
 * answer that, so this edge does the read and hands the result to the pure check. It is ON by default,
 * because a freshness gate a composer has to remember to ask for is one that fires after the owner has already
 * read the stale card; a `stale-cards` grant is the one journalled way past, and a run with
 * no GitHub credential at all is REFUSED rather than passed quietly.
 */
import { existsSync, readFileSync } from "node:fs";

import type { BlockedAskPremise } from "../../../briefing/blockedAsks.js";
import { briefingRefused, checkBriefing, renderBriefingCheck } from "../../../briefing/check.js";
import { CARD_FRAMING_OVERRIDE_ENV } from "../../../briefing/fleetJargon.js";
import { cardPrRefs } from "../../../briefing/prPremise.js";
import { hatchOpenNow } from "../../../hatch/open.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { foldAskLifecycle, parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import type { SilentRow } from "../../../live/automation/silentRows.js";
import type { PrPremise } from "../../../live/github/prPremise.js";
import { blockedAsks } from "../../../live/turn/blockedOnHuman.js";
import { BARE_REFS_HATCH } from "../../../outbound/linkify/bareRefsHatch.js";
import type { ExactVoiceRule } from "../../../outbound/voice/exactRules.js";
import { VOICE_RULES_HATCH } from "../../../outbound/voice/exactRules.js";
import { type ProfileReadError, readExactVoiceRules } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { productionReadCardPremises, type ReadCardPremises, STALE_CARDS_HATCH } from "../../prPremiseDoor.js";
import { briefingCheckPath, parseBriefingCheckArgs, VERB_ARG_OFFSET } from "./core.js";
import { type BriefingCommandError, BriefingCommandErrors, briefingCommandErrorLines } from "./errors.js";
import { silentRecipeRows } from "./silentRowReader.js";
import { BRIEFING_CHECK_USAGE } from "./usage.js";

/**
 * Run `briefing check` against injected output sinks.
 *
 * @param rest the argv tail after `briefing check`
 * @param readFile reads the artifact file, or throws — injected so a test never touches real disk
 * @param exists whether the artifact path exists — injected for the same reason
 * @param voiceRules the operator's private exact rules for a given home, or why its profile cannot be trusted
 * @param applyVoice whether the packing and voice pass runs at all, asked of the resolved home's grant journal
 * @param applyBareRefs whether the bare-reference scan runs at all, asked of that home's journal too
 * @param applyPrPremise whether each card's pull request is re-read live, asked of that home's journal too
 * @param readBlockedAsks reads every bot turn currently waiting on the owner, from the ask-lifecycle log
 * @param readPrPremises reads what GitHub currently says about each pull request a card names
 * @param readSilentRows reads every standing scheduled row that has stopped posting, from the recipe store
 * @param writeOut where the check's lines are printed
 * @param writeDiagnostic where a usage/parse problem is printed
 * @returns the process exit code
 */
export async function runBriefingCheck({
  rest,
  readFile,
  exists,
  voiceRules,
  applyVoice,
  applyBareRefs,
  applyFraming,
  applyPrPremise,
  readBlockedAsks,
  readPrPremises,
  readSilentRows,
  writeOut,
  writeDiagnostic,
}: {
  rest: readonly string[];
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
  voiceRules: (args: { home: string }) => Result<readonly ExactVoiceRule[], ProfileReadError>;
  applyVoice: (args: { home: string }) => boolean;
  applyBareRefs: (args: { home: string }) => boolean;
  applyFraming: boolean;
  applyPrPremise: (args: { home: string }) => boolean;
  readBlockedAsks: (args: { home: string }) => readonly BlockedAskPremise[];
  readPrPremises: ReadCardPremises;
  readSilentRows: (args: { home: string; nowIso: string }) => readonly SilentRow[];
  writeOut: (line: string) => void;
  writeDiagnostic: (line: string) => void;
}): Promise<number> {
  const invocation = resolveInvocation({ exists, rest });
  if (invocation.isErr()) {
    for (const line of invocation.error.lines) {
      writeDiagnostic(line);
    }
    return invocation.error.code;
  }
  const { home, path } = invocation.value;
  const html = readFile(path);
  const inputs = await readCheckInputs({ applyPrPremise, home, html, readPrPremises, voiceRules });
  if (inputs.isErr()) {
    for (const line of inputs.error) {
      writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  const result = checkBriefing({
    applyBareRefs: applyBareRefs({ home }),
    applyFraming,
    applyVoice: applyVoice({ home }),
    html,
    rules: inputs.value.rules,
    ...premiseInputs({ home, premises: inputs.value.premises, readBlockedAsks, readSilentRows }),
  });
  for (const line of renderBriefingCheck({ result })) {
    writeOut(line);
  }
  return briefingRefused({ result }) ? EXIT_ERROR : EXIT_OK;
}

/**
 * The four inputs no file the page carries can supply: the clock, the blocks waiting on the owner, the standing
 * rows that have gone quiet, and what GitHub currently says about each card's pull request.
 *
 * Gathered together rather than inline so ONE instant serves every leg that judges time — a page checked
 * against two clocks can report a card stale and its row current in the same breath. The door reads a page
 * it did not render, so the honest instant is now: a premise dated after the moment somebody is reading the
 * page is wrong whenever that page was written.
 *
 * @param home the resolved state home each read is scoped to
 * @param premises what the live pull-request read answered, or `undefined` when that leg did not run
 * @param readBlockedAsks reads every bot turn currently waiting on the owner
 * @param readSilentRows reads every standing scheduled row that has stopped posting
 * @returns the premise half of {@link checkBriefing}'s arguments
 */
function premiseInputs({
  home,
  premises,
  readBlockedAsks,
  readSilentRows,
}: {
  home: string;
  premises: ReadonlyMap<string, PrPremise> | undefined;
  readBlockedAsks: (args: { home: string }) => readonly BlockedAskPremise[];
  readSilentRows: (args: { home: string; nowIso: string }) => readonly SilentRow[];
}): {
  readonly blocked: readonly BlockedAskPremise[];
  readonly nowIso: string;
  readonly silent: readonly SilentRow[];
  readonly prStates?: ReadonlyMap<string, PrPremise>;
} {
  const nowIso = new Date().toISOString();
  return {
    blocked: readBlockedAsks({ home }),
    nowIso,
    silent: readSilentRows({ home, nowIso }),
    ...(premises === undefined ? {} : { prStates: premises }),
  };
}

/**
 * Read the argv tail into the two things the run needs from it, or into what to print and exit with.
 *
 * Separated from the run itself so the verb's body is the gate it runs rather than its argument handling —
 * and so the file-missing case, which is an error rather than a usage problem, keeps its own exit code.
 *
 * @param exists whether the artifact path exists
 * @param rest the argv tail after `briefing check`
 * @returns the artifact path and the state home, or the lines to print and the code to exit with
 */
function resolveInvocation({
  exists,
  rest,
}: {
  exists: (path: string) => boolean;
  rest: readonly string[];
}): Result<{ home: string; path: string }, { lines: readonly string[]; code: number }> {
  const parsed = parseBriefingCheckArgs({ rest });
  if (parsed.isErr()) {
    return err({ code: EXIT_USAGE, lines: [...parsed.error, BRIEFING_CHECK_USAGE] });
  }
  const path = briefingCheckPath({ parsed: parsed.value });
  if (path === undefined) {
    return err({
      code: EXIT_USAGE,
      lines: ["briefing check needs a path to the artifact HTML", BRIEFING_CHECK_USAGE],
    });
  }
  if (!exists(path)) {
    return err({ code: EXIT_ERROR, lines: [`briefing check: no such file: ${path}`] });
  }
  const homeValue = parsed.value.values["home"];
  return ok({ home: typeof homeValue === "string" ? homeValue : slopweaverHome(), path });
}

/**
 * The operator's voice rules and the live pull-request premises, each refusal as the lines it prints.
 *
 * The voice read comes first so a corrupt `profile.json` refuses before the premise read reaches GitHub: the
 * page gets no verdict, where read as no rules it would pass every word the owner bans.
 */
async function readCheckInputs({
  applyPrPremise,
  home,
  html,
  readPrPremises,
  voiceRules,
}: {
  applyPrPremise: (args: { home: string }) => boolean;
  home: string;
  html: string;
  readPrPremises: ReadCardPremises;
  voiceRules: (args: { home: string }) => Result<readonly ExactVoiceRule[], ProfileReadError>;
}) {
  const rules = voiceRules({ home });
  if (rules.isErr()) {
    return err([`refused: ${rules.error.message}. the page was not checked.`]);
  }
  const premises = await readPremises({ applyPrPremise: applyPrPremise({ home }), home, html, readPrPremises });
  if (premises.isErr()) {
    return err(briefingCommandErrorLines({ error: premises.error }));
  }
  return ok({ premises: premises.value, rules: rules.value });
}

/**
 * Read what GitHub currently says about every pull request this page's cards rest on.
 *
 * @param applyPrPremise whether the leg runs at all
 * @param home the state home whose credential the read resolves from
 * @param html the artifact
 * @param readPrPremises the injected live read
 * @returns the premises, `undefined` when the break-glass switched the leg off, or the lines to print
 */
async function readPremises({
  applyPrPremise,
  home,
  html,
  readPrPremises,
}: {
  applyPrPremise: boolean;
  home: string;
  html: string;
  readPrPremises: ReadCardPremises;
}): Promise<Result<ReadonlyMap<string, PrPremise> | undefined, BriefingCommandError>> {
  if (!applyPrPremise) {
    return ok(undefined);
  }
  const read = await readPrPremises({ addresses: cardPrRefs({ html }).map((ref) => ref.address), home });
  if (read.isErr()) {
    return err(BriefingCommandErrors.premiseReadFailed({ cause: read.error.message, verb: "check" }));
  }
  return ok(read.value);
}

/**
 * Every bot turn currently WAITING on the owner, as the premises the gate checks the page against.
 *
 * `waiting` rows only. A `ready-to-resume` row is one the owner has already dealt with and a visible session owes a
 * re-dispatch — carding it would ask the owner to do again what the owner has just done, which is the fastest way to
 * teach the owner to stop reading these cards.
 *
 * An unreadable or absent log yields an empty list, so this leg can only ever ADD a refusal: a briefing on a
 * machine that has never run the bot is not refused for failing to card blocks that do not exist.
 *
 * @param home the resolved state home
 * @returns one premise per ask waiting on the owner, oldest block first
 */
function blockedAskPremises({ home }: { home: string }): readonly BlockedAskPremise[] {
  const { events } = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
  return blockedAsks({ folded: foldAskLifecycle({ events }) })
    .filter((row) => row.standing === "waiting")
    .map((row) => ({ channel: row.channel, messageTs: row.messageTs, what: row.blocked.what }));
}

/** `slopweaver briefing check`. */
export const briefingCheckCommand = defineCommand({
  run: (argv) =>
    runBriefingCheck({
      applyBareRefs: ({ home }) => !hatchOpenNow({ home, id: BARE_REFS_HATCH }),
      applyFraming: process.env[CARD_FRAMING_OVERRIDE_ENV] !== "1",
      applyPrPremise: ({ home }) => !hatchOpenNow({ home, id: STALE_CARDS_HATCH }),
      applyVoice: ({ home }) => !hatchOpenNow({ home, id: VOICE_RULES_HATCH }),
      exists: existsSync,
      readFile: (path) => readFileSync(path, "utf8"),
      readBlockedAsks: ({ home }) => blockedAskPremises({ home }),
      readPrPremises: productionReadCardPremises,
      readSilentRows: ({ home, nowIso }) => silentRecipeRows({ home, nowIso }),
      rest: argv.slice(VERB_ARG_OFFSET),
      voiceRules: ({ home }) => readExactVoiceRules({ home }),
      writeDiagnostic: (line) => {
        logger.error({ msg: line });
      },
      writeOut: (line) => {
        logger.out({ line });
      },
    }),
});
