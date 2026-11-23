/**
 * Everything you can ASK the escape-hatch register, split out from the register itself.
 *
 * `registry.ts` and its category files DECLARE; this one ANSWERS. Nothing here may grow a second copy of a
 * row — every function below derives from {@link ESCAPE_HATCHES} rather than restating any part of it, which
 * is the same rule the register's own header states.
 *
 * A row's category file is scanned by `escape-hatch` like any other source (only `registry.ts` itself is
 * `src/devLint/escapeHatch.ts`'s `REGISTER_PATH`); a `SLOPWEAVER_ALLOW_*` literal a row's prose quotes is
 * declared by its own row, so the scan finds nothing there to refuse.
 */
import { slopweaverHomeOf } from "../homeDir.js";
import { liveHatchGrant } from "./grant.js";
import { grantSessionId } from "./grantSession.js";
import { readHatchGrants } from "./grantStore.js";
import { ESCAPE_HATCHES } from "./registry.js";
import type { EscapeHatch } from "./types.js";

/**
 * Whether a session holds a live grant for one journalled hatch — the ONE function an outbound gate calls.
 *
 * Wraps the store read so a gate never touches the journal directly, and answers `false` for an ambient row
 * rather than throwing: a caller asking the wrong question about the wrong lane should get a closed hatch,
 * never an exception thrown out of a refusal path.
 *
 * Both the session and, when no `home` is passed, the state home are read from `env` — the environment the
 * caller was handed — never from this process's own, so the one seam a gate already takes is the whole of
 * what decides the answer. Production passes `process.env`, which makes that identical to the resolved home
 * and the harness's own session id.
 *
 * @param id the register row
 * @param env the environment the session id and the default state home are read from
 * @param nowIso the current instant
 * @param home the state home, when the caller already holds one; otherwise the one `env` names
 * @returns true when this session may proceed past that hatch right now
 */
export function hatchGrantOpen({
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
  if (hatchesById().get(id)?.lane !== "journalled") {
    return false;
  }
  const session = grantSessionId({ env });
  if (session === undefined) {
    return false;
  }
  const grants = readHatchGrants({ home: grantHome({ env, home }) });
  return liveHatchGrant({ claudeSessionId: session, grants, hatchId: id, nowIso }) !== undefined;
}

/** The home whose grant journal answers: the one the caller holds, else the one `env` names. */
function grantHome({
  env,
  home,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string | undefined;
}): string {
  if (home !== undefined) {
    return home;
  }
  return slopweaverHomeOf({ env });
}

/** Every registered hatch id, derived rather than restated. */
export type HatchId = (typeof ESCAPE_HATCHES)[number]["id"];

/**
 * The register keyed by id, for the O(1) lookup a gate and the artifact both want.
 *
 * @internal — {@link hatchFor} is what a caller reaches for.
 * @returns a map from a hatch id to its declaration
 */
export function hatchesById(): ReadonlyMap<string, EscapeHatch> {
  return new Map(ESCAPE_HATCHES.map((hatch) => [hatch.id, hatch]));
}

/**
 * Look one up by id, throwing rather than returning `undefined` — a gate names a literal id from this file,
 * so a miss is a programming error the type system already refuses, never a runtime condition to branch on.
 *
 * @param id the register id
 * @returns the hatch declaration
 */
export function hatchFor({ id }: { id: HatchId }): EscapeHatch {
  const found = hatchesById().get(id);
  if (found === undefined) {
    throw new Error(`escape-hatch register has no row for "${id}"`);
  }
  return found;
}

/** Every override variable the register declares, by its full name — `ALLOW_FABLE_OVERRIDE` beside the `SLOPWEAVER_ALLOW_*` family. */
export const REGISTERED_ENV_VARIABLES: readonly string[] = ESCAPE_HATCHES.flatMap((hatch) =>
  hatch.key.kind === "env" ? [hatch.key.variable] : [],
);

/** Every door `warn` token the register declares. */
export const REGISTERED_DOOR_TOKENS: readonly string[] = ESCAPE_HATCHES.flatMap((hatch) =>
  hatch.key.kind === "door-token" ? [hatch.key.token] : [],
);
