/**
 * Which registered Codex destination a VISIBLE SEAT boots against, and what its boot line carries.
 *
 * Pure: a ranking and the operator's own two levers in, a destination and a shell prefix out. Every disk
 * read — the register, each home's rollout log, each cap record — happened already in
 * `codex/fleetRead.ts`, and the ordering in `codex/rank.ts`. This module is only the seat's half of that
 * answer: a `codex route` report is a comparison a reader acts on, while a spawn has to end in ONE
 * destination or a stated refusal.
 *
 * ## Why a seat routes at all, given `codex route` already existed
 *
 * Before this, `cmux spawn --driver codex` booted `codex` with no environment at all, so every Codex seat on
 * this machine landed on the ambient `$CODEX_HOME` however many accounts the register carried — the
 * one-account assumption the register was built to end. The ranking is the same one a pass uses, so a seat
 * and a pass cannot disagree about which account is emptiest.
 *
 * ## `--force` re-admits a REFUSAL, never a PAUSE
 *
 * They are not the same fact (`codex/fleetTypes.ts` § CodexRouteExclusion). A `quota-refused` destination is
 * evidence read off a log, and evidence can be stale or wrong about this minute — which is exactly what
 * `cmux spawn --force` has always meant: bypass the quota fast-fail once. A `paused` row is the owner's own
 * standing decision, recorded deliberately, and a flag whose documented job is "bypass the quota check" must
 * not quietly also overrule the owner. So forcing past a pause is not expressible here, and that is the point.
 *
 * A `usage-limit` and a `not-measured` row are the same kind of fact as a pause — the owner's own register setting, and a
 * limit the owner sets is respected even if it means taking the fleet down — so neither a
 * named `--plan` nor `--force` re-admits either (`../plans/usageLimit.ts`).
 */

import type { Result } from "#lib/result.js";
import { err, ok } from "#lib/result.js";
import { shellQuoteToken } from "#lib/shellCommandLine.js";

import { codexBrowserOffFlags } from "../codex/browserSurface.js";
import type { CodexDestination } from "../codex/destinations.js";
import type { CodexPlanRanking, CodexRouteExclusion } from "../codex/fleetTypes.js";
import { CODEX_MODEL } from "../codex/profiles.js";
import { rankedCodexChoice } from "../codex/seatPlanChoice.js";
import type { SessionPlanChoice } from "../sessions/planChoice.js";
import { namedTiers } from "./modelPin.js";
import { type CodexSeatRouteError, CodexSeatRouteErrors } from "./seatRouteErrors.js";

/** The destination a seat boots against, and the one line saying why it and not another. */
export interface CodexSeatRoute {
  readonly destination: CodexDestination;
  /**
   * Why this destination, for the spawn's own stdout. A routed seat that printed only the home would leave
   * a reader unable to tell a ranked choice from an explicit `--plan` from a forced-past refusal.
   */
  readonly why: string;
  /**
   * The plan choice the session records on its ledger row (`../sessions/planChoice.ts`): aliases, typed exclusion
   * kinds and rank positions only — never {@link why}, which can carry an exclusion's free-text reason.
   */
  readonly choice?: SessionPlanChoice;
}

/**
 * The environment prefix a Codex boot line carries so the seat reads the routed account's own home.
 *
 * A prefix rather than something applied at the call site, for the reason `claude/seatPinning.ts`'s
 * `bootEnvPrefix` is one: a launch line is ONE literal a scanner can recognise, and
 * `devLint/noHeadless.ts` recognises that literal by exact text. The path is shell-quoted because it is a
 * string the OWNER chose — `slopweaver plans add --store-dir` takes whatever the owner types, and an unquoted home
 * carrying a space would assign the prefix its first word and run the rest as the command, booting a seat
 * against a home nobody named while the line still read as if it named one.
 *
 * @param codexHome the routed home, or undefined for a seat that follows the ambient one
 * @returns the prefix, empty when there is no routed home
 */
export function codexHomePrefix({ codexHome }: { codexHome: string | undefined }): string {
  if (codexHome === undefined) {
    return "";
  }
  return `CODEX_HOME=${shellQuoteToken({ token: codexHome })} `;
}

/**
 * The exact line that boots a visible Codex seat: the routed home as an environment prefix, the interactive
 * TUI, the repository's own model pin, and the `-c` overrides that switch the ChatGPT app's browser and
 * computer-use tools off (`codex/browserSurface.ts`) — a seat booted without them launched a second Chrome
 * that crashed in front of the owner, and rule 3 bans a launched browser.
 *
 * It lives beside {@link codexHomePrefix} rather than in `cmux/spawn.ts` — which owns the Claude line and
 * delegates here — because the two halves of this line are the same decision: which account, and on what.
 * `devLint/noHeadless.ts` recognises the returned literal by EXACT text wherever it is returned from, so the
 * local `homePrefix` is a name that set spells, not an incidental one: rename it and NH006/NH007 both fire.
 *
 * Exported also because the SUBPROCESS lane runs this real producer's output through a real shell — the only
 * lane that can witness what a string comparison cannot: that the `CODEX_HOME=` prefix actually reaches the
 * child's environment and beats an exported ambient value.
 *
 * A fleet-worktree seat's `NX_DAEMON=false ` (`./fleetEnv.ts`) rides the front of that same local, for the same
 * reason: one more environment variable is not one more command, and the literal stays the one the gate knows.
 *
 * @param codexHome the routed `$CODEX_HOME`, or undefined for a seat that follows the ambient one
 * @param envPrefix the seat's placement environment from `./fleetEnv.ts`, empty outside a fleet worktree
 * @returns the line to send into the workspace
 */
export function codexBootLine({ codexHome, envPrefix }: { codexHome: string | undefined; envPrefix: string }): string {
  const homePrefix = `${envPrefix}${codexHomePrefix({ codexHome })}`;
  const browserOffSuffix = codexBrowserOffFlags();
  return `${homePrefix}codex --no-alt-screen --model ${CODEX_MODEL}${browserOffSuffix}`;
}

/**
 * The note to print when a `--driver codex` spawn was pinned to a CLAUDE tier, or undefined when it was not.
 *
 * `cmux spawn --model` is required and its vocabulary is Claude's (`./modelPin.ts` carries the measurement
 * that made it required). A Codex seat boots on the repository's own pin instead — `codex/profiles.ts`
 * moves that for the whole fleet at once and deliberately offers no per-invocation dial — so the flag's
 * value does not reach the Codex boot line. Saying so is the rule rather than a courtesy: the substitution
 * is real, and `.claude/rules/typescript-patterns.md` § No silent fallback is why it is announced rather
 * than absorbed.
 *
 * @param requestedModel the `--model` the spawn was given
 * @returns the sentence to print, or undefined when the value names no Claude tier
 */
export function codexSeatModelNote({ requestedModel }: { requestedModel: string }): string | undefined {
  if (namedTiers({ text: requestedModel }).length === 0) {
    return undefined;
  }
  return (
    `--model ${requestedModel} names a Claude tier, and a Codex seat does not take one: this seat boots on ` +
    `the repository's own pin, ${CODEX_MODEL} (src/codex/profiles.ts), which moves for the whole fleet at once`
  );
}

/**
 * The route an explicitly named `--plan <alias>` resolves to.
 *
 * @param allowRefusing whether `--force` was passed, which re-admits a refusing or near-cap destination and never a paused one
 * @param alias the alias the operator named
 * @param ranking what the ranker concluded over every registered Codex destination
 * @returns the destination, or the typed reason that alias cannot take the seat
 */
function requestedRoute({
  allowRefusing,
  alias,
  ranking,
}: {
  allowRefusing: boolean;
  alias: string;
  ranking: CodexPlanRanking;
}): Result<CodexSeatRoute, CodexSeatRouteError> {
  const eligible = ranking.ranked.find((destination) => destination.alias === alias);
  if (eligible !== undefined) {
    return ok({
      choice: rankedCodexChoice({ alias, basis: "requested", forced: false, ranking }),
      destination: eligible,
      why: `--plan ${alias} named it explicitly`,
    });
  }
  const exclusion = ranking.excluded.find((entry) => entry.destination.alias === alias);
  if (exclusion === undefined) {
    return err(
      CodexSeatRouteErrors.planNotRegistered({
        alias,
        registered: registeredAliases({ ranking }),
      }),
    );
  }
  if (allowRefusing && forceableExclusion({ exclusion })) {
    return ok({
      choice: rankedCodexChoice({ alias, basis: "requested", forced: true, ranking }),
      destination: exclusion.destination,
      why: forcedWhy({ exclusion }),
    });
  }
  return err(CodexSeatRouteErrors.planUnavailable({ exclusion }));
}

/** Every Codex alias the ranking saw, ranked and excluded alike, in the order it reported them. */
function registeredAliases({ ranking }: { ranking: CodexPlanRanking }): readonly string[] {
  return [
    ...ranking.ranked.map((destination) => destination.alias),
    ...ranking.excluded.map((entry) => entry.destination.alias),
  ];
}

/**
 * Whether `--force` may seat a session past this exclusion.
 *
 * A quota refusal and the 99% near-cap bar are both evidence about spend, which the operator may choose to
 * spend past; a pause, a usage limit and a not-measured allowance are the owner's own standing decisions and
 * signed-out is a guaranteed 401, so none of those is.
 *
 * @param exclusion why the ranker left the destination out
 * @returns true when `--force` re-admits it
 */
function forceableExclusion({ exclusion }: { exclusion: CodexRouteExclusion }): boolean {
  return exclusion.kind === "quota-refused" || exclusion.kind === "near-cap";
}

/** The `why` line for a seat that `--force` put onto a destination its own evidence says is refusing or near its cap. */
function forcedWhy({ exclusion }: { exclusion: CodexRouteExclusion }): string {
  return (
    `--force put this seat on ${exclusion.destination.alias} past its own ${exclusion.kind} exclusion ` +
    `(${exclusion.reason}); any cached record is left standing`
  );
}

/**
 * Pick the Codex destination a visible seat boots against.
 *
 * @param allowRefusing whether `--force` was passed
 * @param ranking what the ranker concluded over every registered Codex destination
 * @param requestedAlias the `--plan <alias>` override, or undefined to take the ranking's own first choice
 * @returns the destination and why it, or the typed reason no seat can be opened
 */
export function routeCodexSeat({
  allowRefusing,
  ranking,
  requestedAlias,
}: {
  allowRefusing: boolean;
  ranking: CodexPlanRanking;
  requestedAlias: string | undefined;
}): Result<CodexSeatRoute, CodexSeatRouteError> {
  if (ranking.ranked.length === 0 && ranking.excluded.length === 0) {
    return err(CodexSeatRouteErrors.noDestination());
  }
  if (requestedAlias !== undefined) {
    return requestedRoute({ allowRefusing, alias: requestedAlias, ranking });
  }
  const best = ranking.ranked[0];
  if (best !== undefined) {
    return ok({
      choice: rankedCodexChoice({ alias: best.alias, basis: "routed", forced: false, ranking }),
      destination: best,
      why: `ranked first of ${String(ranking.ranked.length)} eligible destination(s), on ${ranking.basis}`,
    });
  }
  if (!allowRefusing) {
    return err(CodexSeatRouteErrors.everyDestinationUnavailable({ exclusions: ranking.excluded }));
  }
  const forced = ranking.excluded.find((exclusion) => forceableExclusion({ exclusion }));
  if (forced === undefined) {
    return err(CodexSeatRouteErrors.everyDestinationUnavailable({ exclusions: ranking.excluded }));
  }
  return ok({
    choice: rankedCodexChoice({ alias: forced.destination.alias, basis: "routed", forced: true, ranking }),
    destination: forced.destination,
    why: forcedWhy({ exclusion: forced }),
  });
}
