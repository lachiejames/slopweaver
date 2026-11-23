/**
 * The credential half of the refusal table (`./refusals.ts`): a `STORE_REFUSED` row per routing refusal kind, and
 * the sign-in button a signed-out plan earns — shared with `SEAT_STILL_WALLED`, which names the same account.
 *
 * Pure: values in, values out.
 */
import type { FleetAccountNames, FleetRefusal } from "./refusals.js";
import type { FleetHandStep, FleetReason } from "./types.js";

/** The account a sign-in button names, written as the owner reads it. */
function accountPhrase({ alias, email }: { alias: string; email: string | undefined }): string {
  if (email === undefined) {
    return `the account for ${alias} (no email is mapped to it yet)`;
  }
  return `${email} (${alias})`;
}

/**
 * The sign-in step for one plan.
 *
 * @param alias the plan whose login is signed out
 * @param accounts each plan's email, so the button names the account
 * @returns the hand step, labelled by email when one is mapped
 */
export function signinStep({ alias, accounts }: { alias: string; accounts: FleetAccountNames }): FleetHandStep {
  const email = accounts.emailFor({ alias });
  const account = accountPhrase({ alias, email });
  return {
    action: { alias, email, kind: "claude-signin" },
    id: `claude-signin:${alias}`,
    label: email === undefined ? `Sign in to ${alias}` : `Sign in as ${email}`,
    note: `Sign in to Anthropic as ${account}. A cmux tab opens and Chrome asks you to sign in; recovery continues once it is done.`,
  };
}

/**
 * A reason with no button.
 *
 * @param refusal what was recorded — its code and its producer's text, for the fold
 * @returns the reason, carrying the producer's text as `raw`
 */
export function reasonOf({
  refusal,
  headline,
  detail,
}: {
  refusal: FleetRefusal;
  headline: string;
  detail: string;
}): FleetReason {
  return { code: refusal.code, detail, headline, raw: refusal.message };
}

/** How a token refusal names its plan: by alias, or as "this plan" when the refusal carries none. */
function planLabel({ alias }: { alias: string | undefined }): string {
  if (alias === undefined) {
    return "this plan";
  }
  return alias;
}

/**
 * The refusals that carry no button. A usage limit, and a monthly-spend plan with no fresh spend reading, are the
 * owner's own policy on the plan, so no override crosses them — only the owner changes the limit, and a spend reading
 * reopens the plan; an unreadable fleet clears by itself; a paused fleet is the owner's deliberate stop, lifted only by a
 * resume.
 */
const BUTTONLESS_REASONS: Readonly<
  Record<"usage-limit" | "not-measured" | "unreadable-plan" | "paused", { detail: string; headline: string }>
> = {
  paused: {
    detail:
      "The Claude plan this seat would boot on is paused (every plan, or the one it is pinned to), so it boots only once that plan is resumed with `slopweaver claude resume <alias>`.",
    headline: "The Claude account this seat needs is paused, so recovery boots no seat.",
  },
  "not-measured": {
    detail:
      "The plan for this seat bills monthly spend, and no spend reading from the last hour says how much is left, so recovery will not spend it blind. Recording a fresh reading reopens it.",
    headline: "The account for this seat is a monthly-spend plan with no fresh spend reading.",
  },
  "unreadable-plan": {
    detail: "No plan's usage could be read, so recovery will not boot a seat blind. This usually clears by itself.",
    headline: "Slopweaver could not verify any account, so it will not boot a seat blind.",
  },
  "usage-limit": {
    detail:
      "The plan for this seat is at the usage limit you set on it. Recovery stops there rather than spend past it; raising the limit is the only way on.",
    headline: "The account for this seat is at the usage limit you set.",
  },
};

/**
 * The `STORE_REFUSED` rows, one per routing refusal kind.
 *
 * @param refusal a `STORE_REFUSED` refusal, its `storeRefusal` naming which routing refusal it was
 * @param accounts each plan's email, for a sign-in button
 * @returns the reason, with a button only for a spent plan or a signed-out one
 */
export function storeReason({
  refusal,
  accounts,
}: {
  refusal: FleetRefusal;
  accounts: FleetAccountNames;
}): FleetReason {
  const alias = refusal.alias;
  switch (refusal.storeRefusal) {
    case "spent-plan":
      return {
        ...reasonOf({
          detail:
            "Every plan that could take this seat has used its current window. Resuming anyway spends the plan past its gauge.",
          headline: "The account for this seat has used its available window.",
          refusal,
        }),
        handStep: {
          action: { hatch: "SLOPWEAVER_ALLOW_SPENT_PLAN", kind: "policy-override" },
          id: "policy-override:SLOPWEAVER_ALLOW_SPENT_PLAN",
          label: "Use this plan anyway",
          note: "The plan for this seat is spent. Resume on it anyway?",
        },
      };
    case "usage-limit":
    case "not-measured":
    case "unreadable-plan":
    case "paused":
      return reasonOf({ ...BUTTONLESS_REASONS[refusal.storeRefusal], refusal });
    case "token":
      return reasonOf({
        detail: `The setup token for ${planLabel({ alias })} would not read, and recovery never falls back to the plan's store.`,
        headline: "The setup token for this plan could not be used safely.",
        refusal,
      });
    case "configuration":
    case undefined:
      if (alias !== undefined) {
        return {
          ...reasonOf({
            detail:
              "That account is signed out and has no setup token, so a seat brought back on it would lock out again. Nothing was stopped; signing in once lets recovery carry on.",
            headline: signinHeadline({ accounts, alias }),
            refusal,
          }),
          handStep: signinStep({ accounts, alias }),
        };
      }
      return reasonOf({
        detail: "The configured Anthropic accounts cannot identify a safe account for this seat.",
        headline: "The configured Anthropic accounts cannot identify a safe account for this seat.",
        refusal,
      });
    default: {
      const unreachable: never = refusal.storeRefusal;
      return unreachable;
    }
  }
}

/**
 * "Sign in to …" for one plan.
 *
 * @param alias the plan whose login is signed out
 * @param accounts each plan's email, so the headline names the account
 * @returns the headline, naming the account by email when one is mapped
 */
export function signinHeadline({ alias, accounts }: { alias: string; accounts: FleetAccountNames }): string {
  return `Sign in to ${accountPhrase({ alias, email: accounts.emailFor({ alias }) })}.`;
}
