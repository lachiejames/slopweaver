/**
 * The local store's pinned Supabase CLI. Docker, the store's other prerequisite, is `./runtimeProbes.ts`'s.
 *
 * The store is `yarn store:start` from this checkout: the `store start` verb, which runs only the Supabase CLI that
 * `package.json` pins exactly (`dependencies.supabase`) and `yarn install` puts in `node_modules`, then locks
 * the stack (`skills/store/reference/local-lock.md`), so no
 * Homebrew or other global install is needed. The CLI version picks the stack's Docker image tags, which is
 * why the pin is the version the stack runs. A miss is a warning, not fatal: `yarn install` restores it, and
 * every verb that does not read the store keeps working.
 */
import type { EnvironmentFacts, EnvironmentProbe } from "./facts.js";
import { okProbe } from "./facts.js";

/** What a missing or mismatched CLI costs. */
const NO_LOCAL_STORE =
  "the local store cannot start, so the console draws nothing and every `store` verb refuses until a store is reachable";

/**
 * The pinned Supabase CLI: is the version `package.json` declares the one installed in this checkout?
 *
 * It reads package metadata and never runs either CLI, so the free `doctor` run stays subprocess-free. A
 * `supabase` on `PATH` that resolves outside this checkout's install (Homebrew's, say) is named, never
 * graded: `yarn store:*` runs `node node_modules/supabase/dist/supabase.js` by path, which fails rather than
 * fall through to `PATH` when the install is missing, with `SUPABASE_CLI_BINARY_OVERRIDE` cleared on that
 * same command so neither the shell nor a Yarn-injected `.env.yarn` can point the launcher elsewhere.
 *
 * @param facts what `./gather.ts` found
 * @returns the graded probe
 */
export function supabaseCliProbe({ facts }: { facts: EnvironmentFacts }): EnvironmentProbe {
  const id = "supabase-cli";
  const scope = "slopweaver";
  const pinned = facts.pins.supabaseCli;
  const installed = facts.installedSupabaseCli;
  const ambient =
    facts.ambientSupabase === null
      ? ""
      : `; \`yarn store:*\` runs only this checkout's dependency binary, never the \`supabase\` on PATH at ${facts.ambientSupabase}`;
  if (pinned === null) {
    return {
      fix: "restore `dependencies.supabase` in this checkout's `package.json` (`git checkout package.json yarn.lock`)",
      id,
      says: `this checkout's \`package.json\` pins no Supabase CLI version${ambient}`,
      scope,
      verdict: "warning",
      withoutFix: `nothing says which Supabase the store runs, so ${NO_LOCAL_STORE}`,
    };
  }
  if (installed === null) {
    return {
      fix: "`yarn install` in this checkout",
      id,
      says: `the Supabase CLI is pinned at ${pinned} but not installed in this checkout${ambient}`,
      scope,
      verdict: "warning",
      withoutFix: NO_LOCAL_STORE,
    };
  }
  if (installed !== pinned) {
    return {
      fix: "`yarn install` in this checkout",
      id,
      says: `the Supabase CLI installed here is ${installed}, but \`package.json\` pins ${pinned}${ambient}`,
      scope,
      verdict: "warning",
      withoutFix: `\`yarn store:start\` runs ${installed}, whose Docker images can differ from the ones the pin names`,
    };
  }
  return okProbe({ id, says: `the Supabase CLI is pinned and installed at ${pinned}${ambient}`, scope });
}
