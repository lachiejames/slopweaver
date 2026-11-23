/**
 * Settings → Models' rows of the console's read allowlist, kept beside `./liveVerbs.ts` and spread into it whole, so
 * that list stays the one place a slug resolves and this file is only where these two rows are written. Every rule
 * `./liveVerbs.ts`'s header states applies here unchanged.
 */
import type { LiveVerb } from "./liveVerbs";

/**
 * The Models section's reads: every connected plan with its usage limit, and the sign-in a Connect press started.
 *
 * @param fastTimeoutMs the fast lane's timeout, passed in so the lane has one number
 * @returns the rows, in the order the tab draws them
 */
export function plansLiveVerbs({ fastTimeoutMs }: { fastTimeoutMs: number }): readonly LiveVerb[] {
  return [
    {
      // Every connected plan and the usage limit it carries — the Models section's rows and their one drop-down each
      // (`../components/console/ModelsSettings.tsx`). One store read. MEASURED on this machine's home, ten
      // plans: 1.44s wall. FAST so the re-read a press asks for answers inside the fast lane's timeout. Reproduce with
      // `/usr/bin/time -p ./bin/slopweaver plans list --json`.
      argv: ["plans", "list", "--json"],
      // A register holding no plan exits 3 (`src/cli/commands/plans/run.ts`): an answer, never a failed read. A fresh
      // install's derived register is empty until the user signs in to a plan — a login found on the machine is none.
      expectedEmpty: { code: "NO_PLANS", exitCode: 3 },
      format: "json",
      lane: "fast",
      slug: "plans",
      stampsItsOwnTime: false,
      timeoutMs: fastTimeoutMs,
      title: "slopweaver plans list --json",
    },
    {
      // The sign-in a Connect press started, per provider: its step, the page it opened, how it ended. One small file
      // read per provider. MEASURED on this machine's home, no attempt recorded: 1.78s wall. FAST because
      // the tab polls it while an attempt is live, so the row moves from "waiting for you in the browser" to connected
      // without a reload. Reproduce with `/usr/bin/time -p ./bin/slopweaver plans connections --json`.
      argv: ["plans", "connections", "--json"],
      format: "json",
      lane: "fast",
      slug: "plan-connections",
      stampsItsOwnTime: false,
      timeoutMs: fastTimeoutMs,
      title: "slopweaver plans connections --json",
    },
  ];
}
