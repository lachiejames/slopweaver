/**
 * The ONE question a gate asks of a registered hatch: is it open for me, right now?
 *
 * The answer is the row's LANE, read off the register rather than chosen by the caller. The owner
 * ruled the outbound hatches **journalled** — a grant that names the session, carries a written reason and
 * expires — and those answer from that grant and nothing else. No variable opens a journalled row: exported
 * once, it would survive the shell, waive the rule for every later send that session made, and leave no line anyone could read afterwards. Every other row is **ambient**, by the same
 * ruling, and opens on its variable set to `1`.
 *
 * The grant is reachable wherever an outbound gate runs. `hatch open` keys it on the visible session
 * (`./grantSession.ts` — a Claude Code session or a Codex thread), every child of that session's shell
 * inherits the id, and a test or a subprocess fixture appends a real grant under its own home and names the
 * session in the env it passes. `src/devLint/escapeHatch.ts` keeps it that way: a journalled row's variable
 * on a code line anywhere but the register is a lint failure.
 */
import { type HatchId, hatchFor, hatchGrantOpen } from "./lookup.js";

/**
 * Whether one registered hatch is open for this session.
 *
 * @param id the register row; its lane decides which of the two answers below applies
 * @param env the environment an ambient row's variable, a journalled row's session id and (when none is
 *   passed) the state home are read from
 * @param nowIso the instant a grant's expiry is judged against
 * @param home the state home the grant journal lives under, when the caller already holds one
 * @returns for a journalled row, whether the session `env` names holds a live grant; for an ambient env row,
 *   whether its variable is `1`; false for an ambient row with no env key
 */
export function hatchOpen({
  id,
  env,
  nowIso,
  home,
}: {
  id: HatchId;
  env: Readonly<Record<string, string | undefined>>;
  nowIso: string;
  home?: string | undefined;
}): boolean {
  if (hatchFor({ id }).lane === "journalled") {
    return hatchGrantOpen({ env, home, id, nowIso });
  }
  return ambientHatchOpen({ env, id });
}

/**
 * Whether one AMBIENT row's variable is set to `1` in `env` — {@link hatchOpen}'s ambient half, for a pure
 * reader that holds no clock and no home because an ambient row needs neither.
 *
 * Answers `false` for a journalled row whatever `env` carries, so a reader that asks the wrong lane gets a
 * closed hatch rather than one an exported variable opened.
 *
 * @param id the register row
 * @param env the environment the row's variable is read from
 * @returns true only for an ambient env row whose variable is exactly `1`
 */
export function ambientHatchOpen({
  id,
  env,
}: {
  id: HatchId;
  env: Readonly<Record<string, string | undefined>>;
}): boolean {
  const hatch = hatchFor({ id });
  if (hatch.lane !== "ambient" || hatch.key.kind !== "env") {
    return false;
  }
  return env[hatch.key.variable] === "1";
}

/**
 * {@link hatchOpen} for this process, right now — what a verb's production wiring asks when it has no
 * injected environment or clock of its own to pass.
 *
 * `home` is required rather than defaulted: a verb taking `--home <dir>` must read the grant `hatch open
 * --home <dir>` wrote, and a default would quietly read the ambient home's journal instead.
 *
 * @param id the register row
 * @param home the state home the verb resolved, whose journal holds the grant
 * @returns whether that hatch is open for this process's own session at this instant
 */
export function hatchOpenNow({ id, home }: { id: HatchId; home: string }): boolean {
  return hatchOpen({ env: process.env, home, id, nowIso: new Date().toISOString() });
}
