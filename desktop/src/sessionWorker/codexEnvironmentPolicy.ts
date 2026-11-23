/**
 * The environment an app-hosted Codex session runs under: the app's child environment, its plan's `CODEX_HOME`, and
 * none of the credentials the Codex CLI would read INSTEAD of that home's own login. Pure.
 *
 * The three names, and why dropping them is the whole point, are the CLI's own resolution chain, measured and
 * explained once at `src/codex/client.ts` `CREDENTIAL_KEYS`: an exported `OPENAI_API_KEY` outranks the routed home's
 * `auth.json`, so a session would spend an account its ledger row never named. The desktop builds apart from `src/`
 * and cannot import that set, so it is restated here and `desktop/__tests__/unit/sessionWorkerEnvironment.test.ts`
 * fails the moment the two differ.
 *
 * The same scrub runs at BOTH boundaries — the control plane launching the worker, and the worker launching the
 * adapter (`adapterEnvironment.ts`) — because the worker's own `process.env` is mutable by anything that runs in it
 * before the adapter starts. `NODE_OPTIONS` is dropped for the same reason: a `--require` preload in it would run
 * inside the worker and could put a credential back.
 */
import { keptEnvironment } from "./keptEnvironment";

/**
 * The credentials the Codex CLI reads in preference to `$CODEX_HOME/auth.json`. A frozen list, never an exported
 * `Set`: a `ReadonlySet` is a mutable `Set` at run time, so an importer could delete a key and switch scrubbing off.
 */
export const CODEX_CREDENTIAL_KEYS: readonly string[] = Object.freeze([
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
]);

/** Node's bootstrap configuration, which can run code inside the worker before the worker's own code does. */
const NODE_PRELOAD_KEYS: readonly string[] = Object.freeze(["NODE_OPTIONS"]);

/**
 * The session's environment.
 *
 * @param inherited the app's child environment (`consoleEndpoint.ts` `childEnv`), or the worker's own
 * @param codexHome the `$CODEX_HOME` the session's plan routes it to
 * @returns the complete environment, credentials and preloads dropped and the plan's home set
 */
export function codexSessionEnvironment({
  inherited,
  codexHome,
}: {
  inherited: Readonly<Record<string, string | undefined>>;
  codexHome: string;
}): Record<string, string> {
  const environment = keptEnvironment({ dropped: [...CODEX_CREDENTIAL_KEYS, ...NODE_PRELOAD_KEYS], inherited });
  environment["CODEX_HOME"] = codexHome;
  return environment;
}
