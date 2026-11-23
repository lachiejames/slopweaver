/**
 * Settings → Models' rows of the console's act list, kept beside `./actVerbs.ts` and spread into it whole, so that
 * list stays the one place a slug resolves and this file is only where these rows are written. Every rule
 * `./actVerbs.ts`'s header states applies here unchanged — the twin of `./liveVerbsPlans.ts` for the reads.
 */
import type { ActVerb } from "./actVerbs";

/**
 * Twenty seconds for a plan-register write: more than a ledger append, since it opens the store, compare-and-sets the
 * register row and rewrites its two file projections. Not measured; a kill inside it answers outcome-unknown and the
 * page re-reads the register, which is safe either way.
 */
const PLAN_WRITE_TIMEOUT_MS = 20_000;

/**
 * The Models section's acts: a plan's usage limit, keeping the plans found on this Mac, and a Connect and its Cancel.
 *
 * @param localTimeoutMs the ledger-act timeout, passed in so the list has one number for it
 * @returns the rows, in the order the tab draws them
 */
export function plansActVerbs({ localTimeoutMs }: { localTimeoutMs: number }): readonly ActVerb[] {
  return [
    // One drop-down per connected plan (a hundred percent of a personal plan, fifty percent of
    // an enterprise plan, say). Every slot is a value the page read off `plans list --json` or a choice the select
    // printed: the provider and alias name a row the register holds, the allowance is that row's own kind carried
    // through unchanged, `--from` is the limit the drop-down was drawn at, and the percent is one of the ten the verb
    // accepts — the VERB refuses any other, so the list stays closed without a new slot shape. `--from` makes the verb
    // refuse when the row's limit or allowance kind moved since the page read it, so a stale choice never writes back
    // over someone else's change. A local register write, hence its own timeout.
    {
      argv: [
        "plans",
        "set-usage-limit",
        "--provider",
        { shape: "id", slot: "provider" },
        "--plan",
        { shape: "id", slot: "plan" },
        "--percent",
        { shape: "count", slot: "percent" },
        "--from",
        { shape: "count", slot: "from" },
        "--allowance",
        { shape: "id", slot: "allowance" },
        "--json",
      ],
      readsSlug: "plans",
      slug: "plans-set-usage-limit",
      timeoutMs: PLAN_WRITE_TIMEOUT_MS,
      title:
        "slopweaver plans set-usage-limit --provider <provider> --plan <plan> --percent <percent> --from <from> --allowance <allowance> --json",
    },
    // "Keep these plans", on an install whose plans were found on this Mac and never written down: the verb writes the
    // derived picture as it reads, so the usage-limit drop-downs it locked take a choice. No slot; a local write.
    {
      argv: ["plans", "adopt", "--json"],
      readsSlug: "plans",
      slug: "plans-adopt",
      timeoutMs: PLAN_WRITE_TIMEOUT_MS,
      title: "slopweaver plans adopt --json",
    },
    // The Connect button (setting up a plan never takes a terminal). The verb writes one starting record
    // and backgrounds the sign-in worker, which opens OpenAI's own sign-in page in the browser: that page, where the
    // owner signs in or does not, is the consent this press stands in front of, and nothing reaches the plan before the
    // sign-in completes there. No model runs — the worker drives `codex app-server`'s account sign-in, never a turn.
    // No slot.
    {
      argv: ["plans", "connect", "--provider", "codex", "--json"],
      readsSlug: "plan-connections",
      slug: "plans-connect-codex",
      timeoutMs: PLAN_WRITE_TIMEOUT_MS,
      title: "slopweaver plans connect --provider codex --json",
    },
    // The live sign-in row's Cancel. The id is the attempt's own, as `plans connections --json` printed it; the verb
    // drops a marker the worker polls, and answers an attempt that already ended as it stands.
    {
      argv: ["plans", "connect-cancel", "--id", { shape: "id", slot: "id" }, "--json"],
      readsSlug: "plan-connections",
      slug: "plans-connect-cancel",
      timeoutMs: localTimeoutMs,
      title: "slopweaver plans connect-cancel --id <id> --json",
    },
  ];
}
