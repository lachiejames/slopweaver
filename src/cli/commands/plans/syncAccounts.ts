/**
 * `plans sync-accounts` — which account each registered Codex store is ACTUALLY signed into, written onto its
 * row, and which stores still need a sign-in.
 *
 * Pure: the register's Codex rows and one live read of their stores in (`codex/accountLive.ts`), the report
 * and the exact register edits out. The verb in `./run.ts` performs each edit as its own locked change, one
 * row per change, so the register's rule that a change is exact holds here too.
 *
 * ## What it writes, and what it never does
 *
 * A row's `email` is what the owner CALLS that store, and until this verb nothing checked it. The value
 * written is the address the store's own provider answered `account/read` with — never a guess, never read
 * out of `auth.json`, never a token. A store that is signed out, missing, or did not answer keeps whatever
 * its row said, and the report names the login that fixes it. Slopweaver never performs the sign-in.
 */
import type { CodexAccountLive } from "../../../codex/accountLiveParse.js";
import { codexLoginCommand } from "../../../plans/login.js";
import type { RegisteredPlan } from "../../../plans/types.js";

/** One Codex row's outcome in a sync, the JSON document's unit. */
export interface AccountSyncRow {
  readonly alias: string;
  readonly storeDir: string;
  /** What the store's own app-server said: `signed-in`, `signed-out`, `store-missing`, `unreadable`. */
  readonly state: CodexAccountLive["kind"];
  /** The address the provider reported, or null when this read established none. */
  readonly liveEmail: string | null;
  /** What the row said before this sync, or null when it carried no address. */
  readonly recordedEmail: string | null;
  /** Whether this sync writes the row — true for every signed-in store that reported an address. */
  readonly update: boolean;
  /** The one line a reader acts on. */
  readonly line: string;
}

/** What the row carried before this sync, as the report shows it. */
function recordedEmailOf({ plan }: { plan: RegisteredPlan }): string | null {
  if (plan.email === undefined) {
    return null;
  }
  return plan.email;
}

/**
 * The live answer for this row's own store. An answer is bound to the store directory it was read from, so a
 * reader that returned its rows in another order can never put one store's address on another's row;
 * a store with no answer at all reads as unreadable.
 */
function liveFor({
  byHome,
  plan,
}: {
  byHome: ReadonlyMap<string, CodexAccountLive>;
  plan: RegisteredPlan;
}): CodexAccountLive {
  const live = byHome.get(plan.storeDir);
  if (live === undefined) {
    return {
      codexHome: plan.storeDir,
      kind: "unreadable",
      readAtIso: "",
      reason: "the live read returned no answer for this store",
    };
  }
  return live;
}

/**
 * Pair each Codex row with its live answer and decide what changes.
 *
 * A signed-in store's address is ALWAYS written, never compared against the row first: the row's `email` is a
 * display cache, and the store's own answer is the only thing here that says which account it is. Rewriting
 * an address that already matched is a no-op edit, and the report shows what the row said beside it.
 *
 * @param plans the register's Codex rows, in register order
 * @param lives the live read of those rows' stores, each paired to its row by `codexHome`, never by position
 * @returns one outcome per row
 */
export function planAccountSync({
  lives,
  plans,
}: {
  lives: readonly CodexAccountLive[];
  plans: readonly RegisteredPlan[];
}): readonly AccountSyncRow[] {
  const byHome = new Map(lives.map((live) => [live.codexHome, live]));
  return plans.map((plan) => {
    const live = liveFor({ byHome, plan });
    const recordedEmail = recordedEmailOf({ plan });
    const base = { alias: plan.alias, recordedEmail, state: live.kind, storeDir: plan.storeDir };
    if (live.kind === "signed-in") {
      if (live.email === undefined) {
        return {
          ...base,
          line: `${plan.alias}: signed in, but the provider reported no address — the row is left as it was`,
          liveEmail: null,
          update: false,
        };
      }
      const said = recordedEmail === null ? "the row carried no address" : `the row said ${recordedEmail}`;
      return {
        ...base,
        line: `${plan.alias}: signed in as ${live.email} — recorded (${said})`,
        liveEmail: live.email,
        update: true,
      };
    }
    if (live.kind === "unreadable") {
      return { ...base, line: `${plan.alias}: live read unavailable — ${live.reason}`, liveEmail: null, update: false };
    }
    const state = live.kind === "signed-out" ? "not signed in" : "store directory missing";
    return {
      ...base,
      line: `${plan.alias}: ${state} — run ${codexLoginCommand({ codexHome: plan.storeDir })}`,
      liveEmail: null,
      update: false,
    };
  });
}
