/**
 * What to do when the owner's own browser will not authenticate to GitHub — pure, no browser, no clock.
 *
 * ## The rule this shape serves, and the rule that shapes the mechanism
 *
 * **A lapsed login is never grounds to ship less.** A pull request once shipped with
 * a bare link where its proof screenshot belonged and a footnote explaining that the session behind
 * `github attach upload` had expired. The evidence had already been gathered; only the delivery step was
 * blocked, and substituting weaker output makes the owner do the work of noticing and asking.
 *
 * Nothing here launches a browser, ever (`docs/browser-route.md`; what it retired,
 * `docs/browser-route/screenshot-reading-and-retirement.md`). The session is read from the Chrome the owner is
 * signed in to all day, so the commonest cause of that incident — a captured session quietly ageing out in a
 * profile nobody looks at — **cannot occur at all**.
 *
 * The residue is stated rather than hidden: when the owner genuinely IS signed out of github.com in their own
 * browser, `attach upload` can no longer fix that itself. It refuses in one line naming the exact fix, and
 * publishes the supervisor event below so the block is visible where the owner reads (doctrine rule 6) instead of
 * sitting in a terminal nobody is looking at.
 *
 * ## Which failures this covers, and the one that looks like it should and does not
 *
 * Four codes mean "the browser's session cannot authenticate and only the owner's own hands fix it": absent,
 * unusable, lapsed, and not SAML-authorised for the organisation. There is no longer a fifth for a missing
 * browser binary, because no binary is involved on any path.
 */

import type { AttachStreamEvent } from "../../events/event.js";
import type { GithubAttachError } from "./attach.errors.js";

/** The failure codes only the owner's own hands, in their own browser, can fix. */
type OwnerLoginCode = "WEB_SESSION_MISSING" | "WEB_SESSION_UNREADABLE" | "WEB_SESSION_EXPIRED" | "ORG_SSO_REQUIRED";

/** The narrowed error, so a caller that has tested it keeps every field its own variant carries. */
export type OwnerLoginError = Extract<GithubAttachError, { code: OwnerLoginCode }>;

/**
 * The failure re-phrased as "the owner's browser needs signing in", or `undefined` when it is something else.
 *
 * Returns the NARROWED error rather than a boolean, because the caller phrases its own notices from the
 * variant afterwards and a type predicate cannot be written over a destructured parameter (TS1230) — the
 * same shape `events/event.ts`'s `oneOf` uses, and for the same reason: no assertion to be wrong about.
 *
 * Written as a comparison chain rather than a `switch`, which the exhaustiveness gate reads as an incomplete
 * switch over the whole sixteen-variant union. Adding a code to {@link OwnerLoginCode} and forgetting this
 * line still fails the build, because {@link whyOf} switches exhaustively over the same union.
 *
 * @param error the failure one upload attempt returned
 * @returns the narrowed session failure when asking the owner to sign in personally is the correct next move
 */
export function needsOwnerLogin({ error }: { error: GithubAttachError }): OwnerLoginError | undefined {
  return error.code === "WEB_SESSION_MISSING" ||
    error.code === "WEB_SESSION_UNREADABLE" ||
    error.code === "WEB_SESSION_EXPIRED" ||
    error.code === "ORG_SSO_REQUIRED"
    ? error
    : undefined;
}

/** The state of the browser's session, phrased so it can be the middle of any of the sentences below. */
function whyOf({ error }: { error: OwnerLoginError }): string {
  switch (error.code) {
    case "WEB_SESSION_MISSING":
      return "no Chrome profile has been recorded for this machine yet";
    case "WEB_SESSION_UNREADABLE":
      return "your Chrome holds no usable github.com session";
    case "WEB_SESSION_EXPIRED":
      return "GitHub answered your browser's cookies as an anonymous visitor";
    case "ORG_SSO_REQUIRED":
      return "your browser's session is not SAML-authorised for this repository's organisation";
  }
}

/**
 * The single line printed when the upload cannot go through.
 *
 * Names the exact action in the owner's browser rather than only the condition: nothing here can open a window, so
 * a reader who is told "the session is dead" and not where to fix it has been given a diagnosis and no
 * correction. One line, because rule 7 caps what appears above the fold.
 *
 * @param error the session failure that blocked the upload
 * @returns the refusal line
 */
export function ownerSignInRefusal({ error }: { error: OwnerLoginError }): string {
  // The SSO case names a DIFFERENT action, and naming the plain one would be the same confident wrong
  // answer this area keeps producing: being signed in to github.com never establishes an organisation's
  // SAML grant, so a reader who just signs in watches the next upload fail identically.
  // A GitHub sign-in is the fleet's to press, so the line names the look that presses it
  // first, and the owner's own Chrome only for the step that look finds theirs.
  const fix =
    error.code === "ORG_SSO_REQUIRED"
      ? "press the organisation's single sign-on prompt with `slopweaver browser sign-in --provider github --org " +
        "<org>`, or complete it in your own Chrome if that look finds the step yours"
      : "press it with `slopweaver browser sign-in --provider github`, or sign in to github.com in your own Chrome " +
        "if that look finds the step yours";
  return `${whyOf({ error })} and nothing was uploaded — ${fix}, then run this upload again`;
}

/**
 * The stream event that tells a supervisor briefing the owner is the blocker.
 *
 * It is now the ONLY trace a blocked upload leaves anywhere the owner reads: the verb exits, the child that ran it
 * is gone, and no window appears in the owner's foreground to notice. Doctrine rule 6 is what makes publishing it
 * mandatory rather than nice.
 *
 * @param atIso when this was published
 * @param error the session failure
 * @param sessionPath the Chrome profile the block is about
 * @returns the event to append to the supervisor stream
 */
export function needsOwnerLoginEvent({
  atIso,
  error,
  sessionPath,
}: {
  atIso: string;
  error: OwnerLoginError;
  sessionPath: string;
}): AttachStreamEvent {
  return {
    atIso,
    kind: "needs-owner-login",
    sessionPath,
    source: "github-attach",
    why: `${whyOf({ error })} — an upload was NOT delivered, and only signing in yourself unblocks it`,
  };
}

/**
 * The clearing half: the browser holds a live session again, so an outstanding `needs-owner-login` no
 * longer applies.
 *
 * Published by `attach status`, which is the verb an operator or a supervisor briefing runs to ask the
 * question — and which is on no hot path, so the clear costs nothing and can never be forgotten the way the
 * retired login verb's own publish could be.
 *
 * @param atIso when this was published
 * @param login the account the owner's browser is signed in as
 * @param sessionPath the Chrome profile it was read from
 * @returns the event to append to the supervisor stream
 */
export function loginCapturedEvent({
  atIso,
  login,
  sessionPath,
}: {
  atIso: string;
  login: string;
  sessionPath: string;
}): AttachStreamEvent {
  return {
    atIso,
    kind: "login-captured",
    sessionPath,
    source: "github-attach",
    why: `your own Chrome is signed in to github.com as ${login} — uploads work again`,
  };
}
