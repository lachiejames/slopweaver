/**
 * Which strings of an outbound artifact are AUTHORED PROSE the voice rules are allowed to read.
 *
 * ## The measured gap this closes
 *
 * About one in a hundred of the owner's sent Slack messages carries an em-dash despite a hard rule (one
 * harvest, cross-checked against thousands of dictations), and nearly all of them are agent-authored posts sent
 * under the owner's account: drip-fed DM briefs, PR round-ups, board posts, dashboard titles. The rule was never the
 * problem and neither was the matcher. Measured on this tree with `yarn tsx` over `authoredProseOf`, all
 * three of the leaked strings survive stripping with their em-dash intact:
 *
 * ```
 * "Velocity — Delivery by Team (PR #N)" -> "Velocity — Delivery by Team (PR  )"
 * "the bot — live board"                 -> "the bot — live board"
 * "• Customer App — slow API endpoints p95 by resource" -> unchanged
 * ```
 *
 * Nothing ever handed them to the checker. The bot lane had no voice check at ALL, and the as-me walker read
 * `run.type === "text"` only — so a typed link's LABEL, which a composer authors as surely as a paragraph,
 * was never prose on either lane. So this module is about WHICH FIELDS are walked, and
 * `../voice/exactRules.ts`'s stripping is deliberately untouched: each of its exemptions carries its own
 * measured incident, and widening them re-opens the sentence-welding defect.
 *
 * ## What is deliberately NOT prose
 *
 * A link's URL, a citation's URL, a media path, a mention key, a group handle and a metadata event type. None
 * is authored voice and every one of them is full of technical text — walking them in would warn on every
 * bot send, and a gate that always fires is a gate that gets overridden without being read.
 */
import { allRunsOf, noFoldSequences } from "../artifact/runs.js";
import type { InlineRun, SlackBotArtifact, UpdateArtifact } from "../artifact/types.js";
import type { AnswerFormAnswer } from "../assistant/answerForm.js";
import { groundingAuthoredProse } from "../assistant/groundingRefs.js";
import type { PollArtifact } from "../slack/pollForm.js";
import { type AuthoredProse, authoredProseOf } from "./exactRules.js";

/**
 * The authored prose of ONE run sequence: every text span the composer wrote, plus every link's LABEL.
 *
 * Three runs are skipped, each for its own stated reason. A `code` span is typed code, which
 * `authoredProseOf` also strips inline. A `quoted` span is somebody else's words carried verbatim — a
 * monitor's title, a ticket's subject — which `../artifact/types.ts` already defines as exempt from the voice
 * rules, and `../artifact/runSchema.ts` refuses on a composed form so a composer cannot mark its own prose as
 * somebody else's. A mention, group, broadcast or citation run carries no authored words at all.
 *
 * @param runs one sequence of inline runs, in render order
 * @param path the caller-owned location prefix, so a finding names the field it was written in
 * @returns the authored prose regions of that sequence, each with its own indexed path
 */
export function runSequenceProse({
  runs,
  path,
}: {
  runs: readonly InlineRun[];
  path: string;
}): readonly AuthoredProse[] {
  return runs.flatMap((run, index) => {
    if (run.type === "text" && run.code !== true && run.quoted !== true) {
      return authoredProseOf({ path: `${path}.runs[${String(index)}]`, text: run.text });
    }
    if (run.type === "link") {
      return authoredProseOf({ path: `${path}.runs[${String(index)}].label`, text: run.label });
    }
    return [];
  });
}

/**
 * Every authored prose region of a card, in render order: its intro, its TL;DR, its above-the-fold index,
 * then its detail sub-blocks.
 *
 * `tldr` and `intro` are BARE STRINGS rather than run sequences, and they are where the measured leak's
 * dashboard-title class lands — a card's TL;DR is the line a reader meets first. `detail` goes through
 * {@link allRunsOf}, which already fans out paragraphs, bullets, bulletless lists and table cells, so a
 * detail shape added later is walked here the moment it joins that function rather than being silently
 * unchecked. `citations` and `primaryLink` carry URLs and are not walked; a citation's own label text is
 * chrome the composer does not author.
 */
function cardProse({ artifact }: { artifact: UpdateArtifact }): readonly AuthoredProse[] {
  // A destructured default rather than a `??`: the absent case is a card with no day-one intro, which is
  // every card but a scheduled post's first firing, and this is the spelling `no-silent-fallback` asks for.
  const { intro = [] } = artifact;
  return [
    ...intro.flatMap((line, index) => authoredProseOf({ path: `intro[${String(index)}]`, text: line })),
    ...authoredProseOf({ path: "tldr", text: artifact.tldr }),
    ...artifact.index.flatMap((runs, index) => runSequenceProse({ path: `index[${String(index)}]`, runs })),
    ...runSequenceProse({ path: "detail", runs: allRunsOf({ detail: artifact.detail }) }),
  ];
}

/**
 * Every authored prose region of a BOT send, whichever of the two forms it is.
 *
 * One enumeration rather than a fan-out at each caller, for the reason `../artifact/runs.ts`'s own header
 * records: a region a walker forgets is a region no rule ever reads, and that is precisely how this lane came
 * to have no voice check at all.
 *
 * @param artifact the validated bot artifact
 * @returns the prose regions the exact rules may inspect, each naming the field it came from
 */
export function botArtifactProse({ artifact }: { artifact: SlackBotArtifact }): readonly AuthoredProse[] {
  if (artifact.kind === "no-fold") {
    return noFoldSequences({ artifact }).flatMap((runs, index) =>
      runSequenceProse({ path: `no-fold[${String(index)}]`, runs }),
    );
  }
  return cardProse({ artifact });
}

/**
 * Every authored prose region of the bot's ANSWER form — its lead, its above-the-fold index, then its body.
 *
 * The same three regions {@link botArtifactProse} walks on a card, under this form's own field names, and
 * the reason it is a second function rather than a conversion is that `answerForm.ts` is a separate
 * vocabulary that happens to share a shape: converting one into the other to reuse a walker would mint
 * exactly the adapter `../../cli/commands/slack/run.ts` records a Codex review catching a dropped field in.
 *
 * ## The grounding IS walked, and it is where the violations actually were
 *
 * Its evidence labels, blind spots and reasons render to the reader in the Details fold as `rich_text` like
 * everything else, and they are composed sentences rather than provenance. Measured: five of
 * eight voice violations in one posted answer were in that trail and NONE was in the lead — an answer whose
 * visible half is in voice and whose fold is not still reads as two authors. The enumeration is
 * `../assistant/groundingRefs.ts`'s `groundingAuthoredProse` rather than a second walk here, because that
 * file already owns which grounding strings a reader sees and a forgotten region is a region no rule reads.
 *
 * `citations`, `images`, `documents` and every url are still not walked. Each is a path or a machine value
 * rather than authored voice, and this module's header says why walking them would make the gate fire on
 * every send.
 *
 * @param answer the parsed `answer` arm about to be posted
 * @returns the prose regions the exact rules may inspect, each naming the field it came from
 */
export function answerProse({ answer }: { answer: AnswerFormAnswer }): readonly AuthoredProse[] {
  return [
    ...authoredProseOf({ path: "lead", text: answer.lead }),
    ...answer.index.flatMap((runs, index) => runSequenceProse({ path: `index[${String(index)}]`, runs })),
    ...runSequenceProse({ path: "body", runs: allRunsOf({ detail: answer.body }) }),
    ...groundingAuthoredProse({ grounding: answer.grounding }).flatMap((prose) =>
      authoredProseOf({ path: prose.path.join("."), text: prose.text }),
    ),
  ];
}

/**
 * A poll's own authored strings: the question, the reason it is being asked, and every option label.
 *
 * Every one renders as visible text on a card in a channel, and all three are composed word for word by the
 * same session that composes a post. The ballot's appended "none of these" option is NOT here — the form
 * appends it rather than taking it from an author, so nobody wrote it and no rule can ask anyone to change
 * it. Mentions carry no authored words, exactly as on a card.
 *
 * @param artifact the validated poll about to be posted
 * @returns the prose regions the exact rules may inspect, each naming the field it came from
 */
export function pollProse({ artifact }: { artifact: PollArtifact }): readonly AuthoredProse[] {
  return [
    ...authoredProseOf({ path: "question", text: artifact.question }),
    ...authoredProseOf({ path: "why", text: artifact.why }),
    ...artifact.options.flatMap((option, index) =>
      authoredProseOf({ path: `options[${String(index)}]`, text: option }),
    ),
  ];
}

/**
 * A canvas's authored body, as one prose region.
 *
 * Unlike every other lane here the body is raw markdown rather than typed runs, so there is nothing to walk
 * and nothing to skip: the whole string is what the author wrote and the whole string is what a reader
 * opens. `authoredProseOf` still strips its own exemptions out of it (a fenced code span, a bare URL), which
 * is why this is not simply the string handed to the matcher. The TITLE is walked beside it — a canvas's
 * title is the line every reader meets first, and the measured leak's own dashboard-title class is exactly
 * that shape.
 *
 * @param markdown the canvas body about to be created or replaced
 * @param title the canvas's own heading, absent on a replace that leaves it alone
 * @returns the prose regions the exact rules may inspect, each naming the field it came from
 */
export function canvasProse({
  markdown,
  title,
}: {
  markdown: string;
  title: string | undefined;
}): readonly AuthoredProse[] {
  const titled = title === undefined ? [] : authoredProseOf({ path: "title", text: title });
  return [...titled, ...authoredProseOf({ path: "markdown", text: markdown })];
}

/**
 * A channel create's own authored strings: its purpose and its topic.
 *
 * Neither is a message, which is exactly why this walker is easy to forget — and both are composed
 * sentences that sit permanently in the workspace under whoever minted the channel, where a reader meets
 * them long after the session that wrote them is gone. The channel NAME is deliberately not here: it is a
 * Slack slug constrained to lowercase, digits and hyphens, already judged by `judgeChannelName`, and running
 * vocabulary rules over a slug warns on technical text the author had no freedom to word differently.
 *
 * @param purpose the channel's stated purpose, absent when the create sets none
 * @param topic the channel's topic line, absent when the create sets none
 * @returns the prose regions the exact rules may inspect, each naming the field it came from
 */
export function channelProse({
  purpose,
  topic,
}: {
  purpose: string | undefined;
  topic: string | undefined;
}): readonly AuthoredProse[] {
  const purposed = purpose === undefined ? [] : authoredProseOf({ path: "purpose", text: purpose });
  const topiced = topic === undefined ? [] : authoredProseOf({ path: "topic", text: topic });
  return [...purposed, ...topiced];
}
