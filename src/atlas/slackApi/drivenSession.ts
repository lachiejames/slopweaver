/**
 * What a walk of the Slack web client SAW, as a document — the contract that outlived this surface's
 * browser.
 *
 * Owner ruling (`docs/browser-route.md`; what it retired,
 * `docs/browser-route/screenshot-reading-and-retirement.md`): nothing here launches a Chromium or keeps a profile.
 * This surface used to fill itself by driving a persistent profile over the workspace's own navigation
 * pages; now the visible session walks them in the owner's REAL Chrome and hands back this document, and
 * everything downstream — the projection, the match against the installed SDK, the generation — is
 * unchanged, because it always consumed this shape rather than a browser.
 *
 * ## No response body ever leaves the caller's hands, and today none arrives either
 *
 * A signed-in Slack session's responses are the workspace's real messages, members and files. A body that
 * arrives in this document is passed straight into `harObservations.ts`'s reduction and then dropped: what
 * is stored is method names, parameter names and response field PATHS, with value-shaped segments already
 * redacted. That reduction is committed and tested precisely so it can be reviewed rather than trusted.
 *
 * **`body` currently has no source, and that is measured rather than assumed.** On a live
 * console page: `read_network_requests` answered every request the page made with exactly `url`, `method` and
 * `statusCode`, with no body and no headers. So a walk through the extension can fill the method and
 * parameter halves of this shape and not the response-field half, and the field stays in the schema because
 * a route that does carry one would otherwise have nowhere to put it. `docs/browser-route/brief-profile-and-walks.md` § "What a
 * brief can and cannot ask for" is the canon.
 *
 * ## Why parsing REFUSES rather than defaulting
 *
 * The retired walk could treat a page it did not manage to read as a recorded gap, because it had watched
 * the page itself. A document handed in from outside has proved nothing, so a shape this cannot validate is
 * a refusal — a silently-empty page here would publish a generation claiming the web client calls nothing.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { strictForm } from "../../outbound/strictForm.js";
import type { UnreachablePage } from "./atlasProjection.js";
import { SlackAtlasErrors, slackAtlasErrorLines } from "./errors.js";

/**
 * One page a walk actually stood on, as its document records it.
 *
 * `screenshotPath` is a LOCAL path, never an artifact reference, and the difference is the whole point: the
 * digest is computed by `sync` from the bytes it reads, then stored through the kit's verified writer, so
 * the picture the atlas holds is provably the picture on disk rather than one the document asserted. A
 * document that could hand in its own digest could hand in any digest.
 */
export interface DrivenWalkedPage {
  /** The declared provider key, copied verbatim from what the brief printed. */
  readonly path: string;
  /** The address the browser settled on, which a redirect may have changed. */
  readonly url: string;
  readonly title: string;
  readonly calls: readonly { readonly name: string; readonly paramNames: readonly string[]; readonly body: unknown }[];
  /** A local PNG the session wrote, or `null` when it took none. */
  readonly screenshotPath: string | null;
  /**
   * Why this page has no picture, when it has none — `kit/pageWalk.ts`'s own field name, for its own reason.
   *
   * Reached and PHOTOGRAPHED are different outcomes, and the difference is only useful if the second one
   * can say why. MEASURED: the app-management console refuses capture through the extension
   * route entirely (`Cannot access a chrome-extension:// URL of different extension`, three attempts), and
   * that is a fact about the route rather than about the page — a bare "no picture" would have read as a
   * walk that could not be bothered.
   */
  readonly screenshotMissingBecause: string | null;
  readonly observedAt: string;
}

/** One completed walk: the workspace it ran in, the pages it read, and the ones it could not. */
export interface DrivenSession {
  readonly workspaceId: string;
  readonly pages: readonly DrivenWalkedPage[];
  readonly unreachable: readonly UnreachablePage[];
}

/** The document a walk hands back, validated field by field. */
const SESSION = strictForm({
  pages: z.array(
    strictForm({
      calls: z.array(strictForm({ body: z.unknown(), name: z.string(), paramNames: z.array(z.string()) })),
      observedAt: z.string(),
      path: z.string(),
      screenshotMissingBecause: z.string().min(1).nullable(),
      screenshotPath: z.string().min(1).nullable(),
      title: z.string(),
      url: z.string(),
    }),
  ),
  unreachable: z.array(strictForm({ path: z.string(), reason: z.string() })),
  workspaceId: z.string(),
});

/**
 * Parse a walk document.
 *
 * @param json the document
 * @param source named in the refusal, so a reader knows which file did not parse
 * @returns the session, or every reason it is not one
 */
export function parseDrivenSession({ json, source }: { json: string; source: string }): Result<DrivenSession> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause: unknown) {
    return err(slackAtlasErrorLines({ error: SlackAtlasErrors.sessionNotJson({ cause, source }) }));
  }
  const parsed = SESSION.safeParse(raw);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${source}: ${issue.path.join(".")} ${issue.message}`));
  }
  return ok(parsed.data);
}
