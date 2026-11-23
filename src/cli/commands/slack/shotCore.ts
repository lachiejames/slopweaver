/**
 * The PURE half of `slopweaver slack shot` — photograph a Slack CONVERSATION as their own client renders it.
 *
 * ## Why a Slack verb rather than `browser shot`
 *
 * `browser shot` refuses every doored provider by construction (`../browser/shotCore.ts`'s
 * `classifyShotTarget`), and Slack is doored. That refusal is correct and stays: a session reaching for a
 * picture of Slack's web client instead of `slack read-thread` is reaching past the door. This verb is the
 * other half of the same rule — *a `slopweaver` verb driving their browser IS the door* (doctrine rule 3) —
 * and it exists for the one question no Slack API answers at all:
 *
 * > does this message RENDER with a "Show more" fold in their client?
 *
 * `conversations.history` returns the blocks we sent. It says nothing about what Slack's own client draws
 * from them, and the fold is drawn by the client. So the only instrument that can answer is a photograph of
 * the rendered message (`docs/browser-route/proof-and-capture-verbs.md`), and the only browser that may take
 * one is their (`docs/browser-route.md`).
 *
 * ## It is narrower than `browser shot`, not wider
 *
 * Three narrowings, each mechanical rather than advisory:
 *
 *  1. **The target must be a Slack MESSAGE permalink**, parsed by `../../../live/slack/permalink.ts` — the
 *     same parser `slack read-thread` trusts. A workspace admin page, a search URL or a settings page is
 *     refused by name, so this verb cannot become a general Slack browser.
 *  2. **The lease is two origins and no more**: the permalink's own workspace origin, and
 *     {@link SLACK_CLIENT_ORIGIN}, which is where Slack's own redirect lands. Anywhere else — a sign-in
 *     form, an identity provider — returns `off-lease-origin` rather than a photograph of it.
 *  3. **The call set is navigate-and-photograph**, `../../../browser/pageTransport.ts`'s closed set. No
 *     click, no typed text, no page script — so the missed-click incident's shape is not
 *     available here at any price, which is the whole reason a picture of Slack is safe to take this way.
 *
 * ## What a picture from here can and cannot settle
 *
 * It settles what the message looked like AT THE WIDTH IT WAS PHOTOGRAPHED AT, in the window the relay
 * opened, which is not necessarily the window they read in. The owner's own account of the fold names
 * "the number of blocks that you put into a message and having the sidebar" together, so a width is part
 * of the question rather than a display preference — and this verb cannot set one, because the transport's
 * closed call set has no viewport control and resizing their real browser is not something a capture should
 * do. What it can do is refuse to be quoted as more than it is: {@link renderSlackShotReport} always prints
 * the reminder that the picture is one layout's answer, never every layout's.
 *
 * No fs, no clock, no network, no browser here; `./shotRun.ts` does every read and every write.
 */
import { err, ok } from "../../../lib/result.js";
import { parseSlackThreadPermalink } from "../../../live/slack/permalink.js";
import { parseFlags } from "../../parseFlags.js";
import { SlackArgumentErrors, type SlackParsed, slackArgumentErrorLines } from "./argumentErrors.js";

/** How long the client is given to render before it is photographed, when the caller states none. */
export const SLACK_SHOT_DEFAULT_SETTLE_MS = 8_000;

/**
 * The longest settle a caller may ask for.
 *
 * Matches `browser shot`'s own ceiling for the same reason: above the transport's visit timeout the client
 * is killed mid-capture and the reason a session reports is the kill rather than the page.
 */
export const SLACK_SHOT_MAX_SETTLE_MS = 60_000;

/**
 * Where Slack's own web client lives, and therefore where a conversation is actually photographed.
 *
 * MEASURED, and it is why this verb does not simply open the permalink it was handed. A
 * `<workspace>.slack.com/archives/…` link is an INTERSTITIAL: it renders a page whose job is to hand the
 * conversation to the desktop app and then get out of the way, and through the relay it closed the tab
 * mid-navigation — `page.goto: Target page, context or browser has been closed`, reported as
 * `session-lost`. The client route below has no interstitial, so it is what {@link slackClientUrl} builds
 * and what the lease is taken on.
 *
 * Reproduce the failure: point an earlier build of this verb at an `/archives/` link and read the outcome.
 */
export const SLACK_CLIENT_ORIGIN = "https://app.slack.com";

/** The validated invocation. */
export interface SlackShotOptions {
  /** The permalink, normalised by the parser. */
  readonly url: string;
  /** The conversation the permalink names, carried so the report says which one it photographed. */
  readonly channel: string;
  /** The message timestamp the permalink addressed. */
  readonly messageTs: string;
  readonly out: string;
  readonly settleMs: number;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** Where a capture ended up, named — never a silence. Mirrors `browser shot`'s own outcome vocabulary. */
export type SlackShotOutcome =
  /** Bytes came back and were written to `--out`. */
  | "photographed"
  /** The message was reached and described, but the browser returned no PNG for it. */
  | "reached-not-photographed"
  /** The permalink could not be loaded at all. */
  | "navigation-failed"
  /** Nothing was attached: no consent token, no recorded profile, or another walk holds the relay. */
  | "relay-unavailable"
  /** The browser went away mid-capture. */
  | "session-lost"
  /** The page settled somewhere that is neither the workspace nor the Slack client — typically a sign-in. */
  | "off-lease-origin"
  /** The address was not a Slack message permalink, so nothing was opened. */
  | "not-a-message-permalink"
  /** `--out` is inside a git checkout, where a commit could carry the picture into a pull request; nothing was opened. */
  | "output-in-checkout";

/** What one capture attempt produced, as the verb reports it. */
export interface SlackShotReport {
  readonly outcome: SlackShotOutcome;
  readonly url: string;
  /** The conversation the permalink named, or `null` when the address never parsed. */
  readonly channel: string | null;
  /** The message timestamp the permalink addressed, or `null` when the address never parsed. */
  readonly messageTs: string | null;
  /** Where the browser actually settled, when it settled anywhere. */
  readonly finalUrl: string | null;
  readonly title: string | null;
  readonly statusCode: number | null;
  /** The file the picture was written to, or `null` when no picture exists. */
  readonly path: string | null;
  readonly bytes: number | null;
  /** Why there is no picture, or `null` when there is one. */
  readonly because: string | null;
}

/** The parsed target of a shot: what to open, and which message it is. */
export interface SlackShotTarget {
  readonly url: string;
  readonly channel: string;
  readonly messageTs: string;
}

/**
 * Whether the address is a Slack MESSAGE permalink this verb may open.
 *
 * @param url the raw `<permalink>` argument
 * @returns the canonical permalink, conversation and timestamp, or why the address is not one
 */
export function classifySlackShotTarget({ url }: { url: string }): SlackParsed<SlackShotTarget> {
  const parsed = parseSlackThreadPermalink({ permalink: url });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.shotTargetRefused({ detail: parsed.error.message }));
  }
  const { workspace, channel, addressedTs } = parsed.value;
  return ok({
    channel,
    messageTs: addressedTs,
    url: `${workspace}/archives/${channel}/p${addressedTs.replace(".", "")}`,
  });
}

/**
 * The client route that renders a CONVERSATION at its newest messages.
 *
 * The workspace id is resolved at RUNTIME from the Slack `org` structure row rather than written down
 * here: a per-install id in a constant is the configuration-discipline half of this repository's hygiene
 * rule ("tools in the codebase, state outside it"), and this repository is shared.
 *
 * **It is the conversation, not the message, and that is MEASURED rather than a simplification.** The
 * per-message route `/client/<workspace>/<channel>/p<ts>` was tried twice, with the team id
 * and again with the enterprise id, and both times the client redirected to `/activity-inbox` and
 * photographed THAT — a successful capture of the wrong thing, which is the one failure a screenshot proof
 * cannot survive. The conversation route landed correctly on the first attempt and is what ships.
 *
 * What follows is the verb's honest contract rather than a caveat: the picture shows the conversation's
 * NEWEST messages. A message that has scrolled out of that view is not in it, and this verb takes no
 * scroll — so the way to photograph a message is to photograph the conversation just after posting it,
 * which is exactly the shape a render proof wants anyway.
 *
 * @param workspaceId the id the client settles on, from `slackClientWorkspaceId` in `atlas/slackApi/clientRoots.ts`
 * @param channel the conversation the permalink named
 * @returns the absolute client URL that opens that conversation
 */
export function slackClientUrl({ workspaceId, channel }: { workspaceId: string; channel: string }): string {
  return `${SLACK_CLIENT_ORIGIN}/client/${workspaceId}/${channel}`;
}

/**
 * The origins one shot's relay lease binds it to.
 *
 * Two rather than one, because the CLIENT route is what is opened while the PERMALINK is what the caller
 * named, and a lease that omits either turns an ordinary redirect into an `off-lease-origin` refusal that
 * reads as a security event and is really a missing entry.
 *
 * @param url the canonical permalink the caller named
 * @returns the workspace origin and the Slack client origin, in that order
 */
export function slackShotOrigins({ url }: { url: string }): readonly string[] {
  return [new URL(url).origin, SLACK_CLIENT_ORIGIN];
}

/**
 * Validate the settle a shot was asked for.
 *
 * @param raw the raw `--settle` value, or `undefined` when none was passed
 * @returns the milliseconds to render for, or why the value is not one
 */
function validSettleMs({ raw }: { raw: string | undefined }): SlackParsed<number> {
  if (raw === undefined) {
    return ok(SLACK_SHOT_DEFAULT_SETTLE_MS);
  }
  if (!/^\d+$/.test(raw)) {
    return err(SlackArgumentErrors.settleNotWhole({ got: raw }));
  }
  const value = Number(raw);
  if (value > SLACK_SHOT_MAX_SETTLE_MS) {
    return err(SlackArgumentErrors.settleTooLong({ got: raw, max: SLACK_SHOT_MAX_SETTLE_MS }));
  }
  return ok(value);
}

/**
 * Resolve `slack shot`'s flags, accumulating every rejection rather than stopping at the first.
 *
 * @param url the raw permalink argument
 * @param out the raw `--out` value
 * @param settle the raw `--settle` value
 * @param json whether machine-readable output was asked for
 * @param home the state home override, when one was passed
 * @returns the validated invocation, or every rejection
 */
export function resolveSlackShotOptions({
  url,
  out,
  settle,
  json,
  home,
}: {
  url: string | undefined;
  out: string | undefined;
  settle: string | undefined;
  json: boolean;
  home: string | undefined;
}): SlackParsed<SlackShotOptions> {
  const problems: string[] = [];
  let target: SlackShotTarget | null = null;
  let settleMs = SLACK_SHOT_DEFAULT_SETTLE_MS;
  if (url === undefined) {
    problems.push(
      "`slack shot` needs a message permalink, e.g. https://acme.slack.com/archives/C123/p1785114398557099",
    );
  } else {
    const classified = classifySlackShotTarget({ url });
    if (classified.isErr()) {
      problems.push(...slackArgumentErrorLines({ error: classified.error }));
    } else {
      target = classified.value;
    }
  }
  if (out === undefined) {
    problems.push("`slack shot` needs --out <file.png>, the path the picture is written to");
  } else if (!out.endsWith(".png")) {
    problems.push(`--out takes a .png path, got '${out}'`);
  }
  const resolvedSettle = validSettleMs({ raw: settle });
  if (resolvedSettle.isErr()) {
    problems.push(...slackArgumentErrorLines({ error: resolvedSettle.error }));
  } else {
    settleMs = resolvedSettle.value;
  }
  if (problems.length > 0 || target === null || out === undefined) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: problems }));
  }
  return ok({
    channel: target.channel,
    home,
    json,
    messageTs: target.messageTs,
    out,
    settleMs,
    url: target.url,
  });
}

/**
 * Render a report for a reader.
 *
 * The outcome is named on its own line in every arm, including the successful one, because the whole point
 * of the verb is that a composer can quote which state its capture leg reached. The successful arm also
 * carries the one-layout caveat, so a picture cannot be quoted as a claim about every client.
 *
 * @param report what the attempt produced
 * @returns the lines to print
 */
export function renderSlackShotReport({ report }: { report: SlackShotReport }): readonly string[] {
  const lines = [`slack shot: ${report.outcome} — ${report.url}`];
  if (report.channel !== null && report.messageTs !== null) {
    lines.push(`  message ${report.channel} ${report.messageTs}`);
  }
  if (report.finalUrl !== null && report.finalUrl !== report.url) {
    lines.push(`  settled on ${report.finalUrl}`);
  }
  if (report.title !== null && report.title !== "") {
    lines.push(`  title: ${report.title}`);
  }
  if (report.path !== null && report.bytes !== null) {
    lines.push(`  wrote ${String(report.bytes)} byte(s) to ${report.path}`);
    lines.push(
      "  this is ONE layout's answer — the window the relay opened, at its own width, with whatever " +
        "sidebar it drew. Quote it as that, never as every client.",
    );
    lines.push("  it shows the conversation's NEWEST messages; nothing scrolled, so an older message is not in it.");
  }
  if (report.because !== null) {
    lines.push(`  ${report.because}`);
  }
  return lines;
}

/**
 * Every flag `slack shot` accepts, as the help/flag ratchet reads them.
 *
 * Declared here beside the parser rather than in the shell, so the advertised set and the accepted set come
 * from one list — the drift this ratchet exists to catch is a flag the usage promises and the parser
 * refuses, or the reverse.
 */
export const SLACK_SHOT_FLAG_NAMES: readonly string[] = ["--out", "--settle", "--json", "--home"];

/**
 * Parse `slack shot`'s whole argv tail — the permalink positional and every flag — into a validated
 * invocation.
 *
 * Pure, and in the CORE rather than the shell for the reason this repository's other verbs put it here: the
 * shell should hold no decisions, and "is this argv acceptable" is the decision a test most wants to make
 * without a browser anywhere near it.
 *
 * @param rest the verb's own argv tail
 * @returns the validated invocation, or every rejection
 */
export function parseSlackShotArgs({ rest }: { rest: readonly string[] }): SlackParsed<SlackShotOptions> {
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: ["json"], string: ["out", "settle", "home"] },
  });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, positionals } = parsed.value;
  if (positionals.length > 1) {
    return err(SlackArgumentErrors.shotPositionalCount({ count: positionals.length }));
  }
  const stringFlag = ({ name }: { name: string }): string | undefined => {
    const value = values[name];
    return typeof value === "string" ? value : undefined;
  };
  return resolveSlackShotOptions({
    home: stringFlag({ name: "home" }),
    json: values["json"] === true,
    out: stringFlag({ name: "out" }),
    settle: stringFlag({ name: "settle" }),
    url: positionals[0],
  });
}
