/**
 * The asker's own question, made safe to QUOTE into a plain-string card field. Pure — a leaf that reads
 * nothing and resolves names only from the map it is handed.
 *
 * ## The defect this closes
 *
 * Three notice cards quote the question verbatim into a plain string: `./answer.ts`'s `turnHeldForm`,
 * `./failureForm.ts`'s `failureTldr` and `./blockedForm.ts`'s `blockedTldr` all build a `tldr`, and
 * `./progressCard.ts` and `../listen/capture.ts` both build a `TodoStep.detail`. A `tldr` is gated —
 * `../../outbound/artifact/schema.ts` runs `rawMarkupIssuesOfText` over it, which REFUSES every raw-markup span a plain string carries, because a
 * plain string holds no typed run for one to become. So a question containing `<@U0SYN000002>` made the
 * whole card unpostable, and the bot could not answer BECAUSE of markup in the asker's own message.
 * Measured on a real ask whose stored text carries three of them.
 *
 * Reproduce the refusal on any tree without this module in the path:
 *
 * ```
 * yarn tsx -e 'import { turnFailureForm } from "./src/live/turn/failureForm.js"; import { updateArtifactSchema } from "./src/outbound/artifact/schema.js"; console.log(updateArtifactSchema.safeParse(turnFailureForm({ cause: "broke", modelId: "o", question: "<@U1> hi", reason: "x" }).artifact).success)'
 * ```
 *
 * Why the markup is there at all: `../listen/mention.ts` normalises `<@U123>` to `@(U123)` on the SOCKET
 * path, but the ask-lifecycle register (`../ask/store.ts`'s `ensureCapturedAskLifecycle`) stores Slack's own
 * `text`, so a brief built from that path keeps the raw form.
 *
 * ## Built on the GATE's own scanner, deliberately
 *
 * {@link questionForPlainField} finds its spans with `scanRawMarkup`, which is the function the gate itself
 * runs. That is what makes "the card parses" a property rather than a coincidence — a second regex would be
 * free to disagree with the one that refuses.
 *
 * `../../corpus/slack/visibleProse.ts`'s `resolveSlackMarkup` is the other resolver in this tree and it is
 * NOT this one, for three reasons worth stating so the next reader does not merge them: it carries its own
 * independent `<([^<>]+)>` pattern with no bare-URL arm at all, so extending it would leave half this class
 * standing; its fallbacks are deliberately the opposite of these (see below); and it is fed `SlackNameMaps`
 * built at the Slack fetch edge, which the live turn has no access to. What the two share is the part that
 * would actually drift — and here that is the scanner, which this module imports rather than copies.
 *
 * ## The fallback is the ID, never a generic
 *
 * `resolveSlackMarkup` answers `@user` on a miss because it writes STORED CORPUS TEXT, where an opaque
 * `Uxxxx` is noise a retrieval index carries forever. A notice card is the opposite case: the reader is
 * working out what the asker actually said, and the id they can paste into `slopweaver slack` is strictly
 * more use than "somebody was tagged". `./taskLabel.ts` already states that doctrine for the label it
 * builds — showing an id is honest where guessing a name would not be — and this follows it.
 *
 * `./taskLabel.ts`'s `strippedAddressing` keeps its own job and is not replaced: it drops the LEADING
 * `@(id)` run of the NORMALISED form, and the two helpers compose at the call sites.
 */
import { type RawMarkupSpan, scanRawMarkup } from "../../outbound/artifact/typedRuns.js";

/**
 * The URL schemes `isConvertibleUrl` (`../../outbound/artifact/typedRuns.ts`) is willing to treat as a link,
 * and therefore the exact prefixes whose removal turns a URL back into prose the gate accepts.
 *
 * Longest-first so `https://` is never half-matched by a `http://` test.
 */
const CONVERTIBLE_SCHEMES: readonly string[] = ["https://", "http://", "mailto:"];

/**
 * A URL with its scheme removed, so it reads whole to a human and carries no link the gate must refuse.
 *
 * Not a SHORTENING, which is why it owes no note under `./answer.ts`'s "every shortening is REPORTED"
 * doctrine: the host, the path and the fragment all survive, and the scheme is not something a reader uses.
 */
function schemeless({ url }: { url: string }): string {
  const scheme = CONVERTIBLE_SCHEMES.find((candidate) => url.toLowerCase().startsWith(candidate));
  if (scheme === undefined) {
    return url;
  }
  return url.slice(scheme.length);
}

/**
 * Every Slack user id the question's raw markup carries, in document order with duplicates dropped.
 *
 * Exported because the caller resolves the names: this module is pure and the member index is a read.
 * `../askerNames.ts`'s door takes exactly this list.
 *
 * @param question the question as asked, markup and all
 * @returns the ids, in the order they first appear; empty when the question carries none
 */
export function slackUserIdsIn({ question }: { question: string }): readonly string[] {
  const seen = new Set<string>();
  scanRawMarkup({ text: question }).forEach((span) => {
    if (span.kind === "user") {
      seen.add(span.slackId);
    }
  });
  return [...seen];
}

/**
 * One raw-markup span as the prose a plain-string field may carry.
 *
 * Total over the span union, so a new kind fails to compile here rather than silently reaching the gate.
 */
function proseForSpan({ span, names }: { span: RawMarkupSpan; names: NameMap }): string {
  switch (span.kind) {
    case "user": {
      const name = names[span.slackId];
      if (name === undefined || name.length === 0) {
        return `@${span.slackId}`;
      }
      return `@${name}`;
    }
    case "channel": {
      // `raw` is `<#C123>` or `<#C123|general>`. Slack's own `|label` is a real channel name and beats the
      // id; with none, the id survives for the same reason a user's does.
      const [id = "", label] = span.raw.slice(2, -1).split("|");
      if (label === undefined || label.length === 0) {
        return `#${id}`;
      }
      return `#${label}`;
    }
    case "broadcast":
      return `@${span.range}`;
    case "usergroup":
      return `@${span.groupId}`;
    case "url":
      // The angle form's own `|label` is the author's words and beats the URL; `scanRawMarkup` has already
      // put it in `label`, defaulting it to the URL when there was none.
      return span.label === span.url ? schemeless({ url: span.url }) : span.label;
  }
}

/** Slack user id → the display name to show for them. Absent means the door could not resolve that id. */
type NameMap = Readonly<Record<string, string>>;

/** One rewrite pass: every span `scanRawMarkup` found in `text`, spliced back as its prose. */
function rewrittenOnce({
  text,
  spans,
  names,
}: {
  text: string;
  spans: readonly RawMarkupSpan[];
  names: NameMap;
}): string {
  const out: string[] = [];
  let cursor = 0;
  spans.forEach((span) => {
    out.push(text.slice(cursor, span.start), proseForSpan({ names, span }));
    cursor = span.start + span.raw.length;
  });
  out.push(text.slice(cursor));
  return out.join("");
}

/**
 * The question rewritten so every raw-markup span reads as prose a plain-string card field may hold.
 *
 * Byte-identical to its input when the question carries no markup, which is the property that keeps every
 * existing card exactly where it was.
 *
 * **Rewritten until the scanner finds nothing**, not once. A span's prose can itself be markup: an angle
 * link's `|label` is the author's words, and `<https://a.test|https://b.test>` rewrites to a bare URL the
 * gate refuses (found in review of the task-label change). Only the FIRST pass resolves
 * names: a later pass renders an id as the id, so every rewrite in it is strictly shorter than the span it
 * replaces and the loop ends — which it would not be guaranteed to if a resolved name could itself carry
 * markup.
 *
 * **Call this BEFORE any clamp.** Resolution changes visible width, and clamping first can cut `<@U0SYN…`
 * out of the middle of a token — which `scanRawMarkup` then does not match, so the gate passes while the
 * card shows a mangled id. That is a silent wrong, strictly worse than the loud refusal it replaces. Same
 * ordering rule `../../outbound/assistant/answerForm.ts`'s `typeAnswerFormMarkup` states for its own
 * conversion.
 *
 * @param question the question as asked, markup and all
 * @param names what each Slack user id in it should read as; an id absent from it renders as the id
 * @returns the question as prose, carrying no span `rawMarkupIssuesOfText` would refuse
 */
export function questionForPlainField({ question, names = {} }: { question: string; names?: NameMap }): string {
  let text = question;
  let passNames = names;
  for (let spans = scanRawMarkup({ text }); spans.length > 0; spans = scanRawMarkup({ text })) {
    text = rewrittenOnce({ names: passNames, spans, text });
    passNames = {};
  }
  return text;
}
