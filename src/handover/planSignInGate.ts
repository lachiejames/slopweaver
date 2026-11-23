/**
 * The gate a question the owner reads meets when it asks them to sign into a Claude or Codex plan: it names the plan's
 * email address, never its alias alone, because otherwise the owner has to guess which plan an alias means. The
 * judgement is `../hand/planSignIn.ts`'s, which the hand register's append also runs, so a floating note and a
 * queue question cannot disagree about what a plan sign-in must carry.
 *
 * Pure: the caller supplies the texts, the register's addresses and the environment.
 */

import { type PlanEmail, planSignInGap, planSignInGapLine } from "../hand/planSignIn.js";
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";

/**
 * The environment variable that records a question this gate refuses.
 *
 * A LITERAL rather than `hatchEnvVar({ suffix })`: `escape-hatch` in `yarn lint` checks that a row's named
 * reader mentions its own key, and a name assembled at runtime is one no static scan can see.
 */
export const PLAN_SIGN_IN_WITHOUT_EMAIL_HATCH = "SLOPWEAVER_ALLOW_PLAN_SIGN_IN_WITHOUT_EMAIL";

/** What a verb should do with the texts it was handed. */
export type PlanSignInVerdict =
  | { readonly kind: "ok" }
  /** Not recordable. `lines` is whole — the caller prints it and adds nothing. */
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/**
 * The verdict on the texts a question's card draws, read together as the owner reads the card, with the hatch applied.
 *
 * @param texts every text the card draws — the question, and its shape when it has one
 * @param plans every registered plan's alias and cached address
 * @param command the door being refused, as the owner would type it
 * @param env the process environment, for the hatch
 * @returns `ok`, or the whole refusal to print
 */
export function planSignInVerdict({
  texts,
  plans,
  command,
  env,
}: {
  texts: readonly string[];
  plans: readonly PlanEmail[];
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): PlanSignInVerdict {
  const gap = planSignInGap({ plans, text: texts.join("\n") });
  if (gap === undefined || env[PLAN_SIGN_IN_WITHOUT_EMAIL_HATCH] === "1") {
    return { kind: "ok" };
  }
  const hatch = { ...hatchFor({ id: "plan-sign-in-without-email" }), command };
  return {
    kind: "refused",
    lines: [
      hatchRefusal({ hatch }),
      `  - it ${planSignInGapLine({ gap })}`,
      "NOTHING was recorded and the run is not paused, so name the address and run the same command again.",
    ],
  };
}
