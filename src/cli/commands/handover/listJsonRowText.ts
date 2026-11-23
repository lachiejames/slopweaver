/**
 * What `handover list --json` reads off a row's own authored TEXT: the capped summary, its Slack anchor and the
 * pull requests it names. Split from `listJson.ts` along that seam, because each of the three reads the UNCUT
 * text before the cap can reach it, and the document module only assembles their answers. The cap's
 * measurement is `listJson.ts`'s § "The summary cap". It also reads what a card says it came from: the owner's words,
 * the row's origin, a finding's observer and why the card is in front of the owner.
 */
import type { BoardModel } from "../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { HisWords } from "../../../handover/hisWords.js";
import type { HisWordsSteer } from "../../../handover/hisWordsSteers.js";

/**
 * The character cap on a row's `summary`, and the whole reason the document is megabytes rather than
 * tens of megabytes — see `listJson.ts`'s § "The summary cap" for the measurement that chose it.
 *
 * 320 characters is about two sentences: enough for a row to be recognisable in a list, short enough that
 * an authored field cannot dominate the document. The doc behind every row is whole on disk and `path` is
 * on every row, so the cut text is always one read away — but "nothing is lost" would be too strong, which
 * is why {@link BoardJsonRow.summaryAnchor} exists and {@link BoardJsonDocument.summaryTruncation} is
 * published rather than the cap being applied quietly.
 */
export const BOARD_SUMMARY_CHARS = 320;

/**
 * A Slack permalink, greedy to the end of its query — the same shape `site/lib/slackLink.ts` reads, spelled
 * here too because `site/` is a separate project that imports nothing from `src/`.
 */
const SLACK_PERMALINK = /https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[A-Z0-9]+\/p[0-9]+(?:\?[A-Za-z0-9_.=&]+)?/;

/** What prose puts after a link and Slack never does. */
const TRAILING_PROSE = /[).,:;!?]+$/;

/**
 * The row's Slack anchor, read off the FULL summary before the cap can reach it.
 *
 * Separate from the capped text rather than a reason to widen the cap: the anchor is rarely near the front
 * of a summary, so a prefix keeps the wrong 320 characters. MEASURED over the 2,677 docs on
 * one machine — 129 summaries carried a permalink and 106 of those sat past character 320, so the cap
 * alone removed the thread from five rows in six that had one.
 *
 * @param summary the doc's own front-matter field, uncut
 * @returns the first permalink, trimmed of the punctuation prose wraps it in, or `undefined`
 */
export function summaryAnchorOf({ summary }: { summary: string | undefined }): string | undefined {
  if (summary === undefined) {
    return undefined;
  }
  const match = SLACK_PERMALINK.exec(summary);
  if (match === null) {
    return undefined;
  }
  return match[0].replace(TRAILING_PROSE, "");
}

/**
 * A row's summary as the document carries it: the authored field, cut to {@link BOARD_SUMMARY_CHARS} — back to the
 * last whitespace when the cap falls inside a word, because a cut inside the number of a pull request URL (a truncated number after `…/pull/`) or inside
 * `QQQQ-134` after `QQQQ-1` is itself a valid reference, and the console draws it as a link to a pull request or
 * ticket the doc never named. A summary with no whitespace before the cap is one word longer than any reference, and is cut at the cap.
 * The published tally still counts the cap, so a cut may keep up to one word fewer than it says.
 *
 * A doc with no summary keeps `undefined` rather than becoming an empty string — the two are different
 * facts about a doc, and coalescing them is the silent substitution the repo gates against.
 *
 * @param summary the doc's own front-matter field
 * @returns the capped summary, or `undefined` when the doc declared none
 */
export function cappedSummary({ summary }: { summary: string | undefined }): string | undefined {
  if (summary === undefined) {
    return undefined;
  }
  if (summary.length <= BOARD_SUMMARY_CHARS) {
    return summary;
  }
  const cut = summary.slice(0, BOARD_SUMMARY_CHARS);
  if (/\s/u.test(summary.charAt(BOARD_SUMMARY_CHARS))) {
    return cut;
  }
  const lastSpace = cut.search(/\s\S*$/u);
  if (lastSpace === -1) {
    return cut;
  }
  return cut.slice(0, lastSpace);
}

/** A GitHub pull-request URL, to the number and no further — a `/files` suffix names the same request. */
const PR_URL = /https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/[0-9]+/g;

/**
 * Every pull request a row's own text names, each once, in the order it is named.
 *
 * Reads the UNCUT summary for {@link summaryAnchorOf}'s reason, and the question and reason beside it,
 * because which of the three carries the link is not a property a reader should have to know.
 *
 * @param parts the row's own strings, uncapped — absent ones simply contribute nothing
 * @returns the pull-request URLs, distinct
 */
export function prUrlsIn({ parts }: { parts: readonly (string | undefined)[] }): readonly string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (part === undefined) {
      continue;
    }
    for (const match of part.matchAll(PR_URL)) {
      const [url] = match;
      if (!out.includes(url)) {
        out.push(url);
      }
    }
  }
  return out;
}

/**
 * A finding's observer as the board publishes it: one session-id token, or nothing. `observedBy` falls back to the
 * session id in the environment, which can carry any text, so a value with whitespace in it is never published —
 * its card reads "a fleet session" rather than a shape someone typed into that variable
 * (`subprocess/cli/commands/handover/landingDispatchRegister.test.ts`).
 *
 * @param observedBy the row's `observedBy:` as the doc parsed it
 * @returns the value when it is one whitespace-free token, else `undefined`
 */
export function observerToken({ observedBy }: { observedBy: string | undefined }): string | undefined {
  if (observedBy === undefined || !/^\S+$/u.test(observedBy)) {
    return undefined;
  }
  return observedBy;
}

/**
 * One of the owner's further steers on a row, as the board publishes it — every one, a defect included, so the card says a
 * steer is there and will not read rather than drawing fewer of the owner's words as though they were all.
 */
export type BoardJsonSteer =
  | { readonly kind: "held"; readonly index: number; readonly quote: HisWords }
  | { readonly kind: "unread"; readonly index: number; readonly anchor: string; readonly why: string }
  | { readonly kind: "defect"; readonly index: number; readonly why: string };

/** One steer as the wire carries it. */
function steerOnWire({ steer }: { steer: HisWordsSteer }): BoardJsonSteer {
  const group = steer.group;
  if (group.kind === "held") {
    return { index: steer.index, kind: "held", quote: group.hisWords };
  }
  if (group.kind === "unread") {
    return { anchor: group.anchor, index: steer.index, kind: "unread", why: group.why };
  }
  return { index: steer.index, kind: "defect", why: group.why };
}

/**
 * The row's `bearsOn:` line, published only while it can still be true.
 *
 * It says how the owner's words bear on the question the row was REGISTERED with. A run parked on the owner asks its own
 * question off the journal, which the card then draws instead, so the registered line would say why a question
 * it was never written for is in front of the owner — withheld rather than published beside the wrong one.
 *
 * @param model the composed row
 * @returns the line, or `undefined` when the row carries none or a run is asking its own question
 */
function bearsOnOf({ model }: { model: Pick<BoardModel, "doc" | "run"> }): string | undefined {
  if (model.run.kind === "waiting-on-owner") {
    return undefined;
  }
  return model.doc.bearsOn;
}

/**
 * What a row publishes about where its card came from: the owner's words, or why they would not read or do not hold, the
 * row's origin, a finding's observer, and last why it is in front of the owner. The console's card leads with these
 * (`site/lib/queueCardSource.ts`).
 *
 * @param model the row as the board composed it
 * @returns the fields, each `undefined` when the row does not carry it
 */
export function cardSourceFields({ model }: { model: Pick<BoardModel, "doc" | "run"> }): {
  readonly bearsOn: string | undefined;
  readonly ownerWords: HisWords | undefined;
  readonly ownerWordsDefect: string | undefined;
  readonly ownerWordsUnread: string | undefined;
  readonly ownerWordsSteers: readonly BoardJsonSteer[];
  readonly observedBy: string | undefined;
  readonly origin: HandoverDoc["origin"];
  readonly registeredBy: string | undefined;
  readonly registeredRun: string | undefined;
} {
  const { doc } = model;
  const group = doc.hisWords;
  return {
    bearsOn: bearsOnOf({ model }),
    ownerWords: group.kind === "held" ? group.hisWords : undefined,
    ownerWordsDefect: group.kind === "defect" ? group.why : undefined,
    ownerWordsSteers: doc.hisWordsSteers.map((steer) => steerOnWire({ steer })),
    ownerWordsUnread: group.kind === "unread" ? group.why : undefined,
    observedBy: observerToken({ observedBy: doc.observedBy }),
    origin: doc.origin,
    registeredBy: observerToken({ observedBy: doc.registeredBy }),
    registeredRun: observerToken({ observedBy: doc.registeredRun }),
  };
}
