/**
 * The gate `handover ask`, `handover correct` and `handover register` put in front of a question's TEXT: it must
 * lead with the ask the owner is being asked to answer, and every pull request it names must carry its link.
 * `register` judges only a row that waits on the owner's word ({@link registerAlignmentVerdict}).
 *
 * ## Why this exists
 *
 * A card whose heading is a statement leaves the owner asking what it wants of them, and a pull request named
 * by number with no URL leaves the board publishing no `prUrls`, so the card draws no link. Both are
 * properties of the text a verb is handed, so the verb refuses.
 *
 * ## The three criteria, and why each is exactly this
 *
 * - **The lead asks.** The drawer's heading is `leadQuestion` in `site/lib/queueCardAsk.ts`: the first of the
 *   first TWO sentences that ends in `?`, else the first sentence as written. So a question whose first two
 *   sentences ask nothing becomes a heading that tells the owner something. {@link LEAD_SENTENCES} is that same two.
 * - **A named pull request carries its URL, in the question itself.** The card draws a pull request as its
 *   number, the number the link (`site/lib/inlineCitations.ts`), and resolves that number from the question's
 *   own URLs and `prUrls` — which `handover list --json` scrapes from the doc summary, the question and the
 *   reason only, never from `--problem`, `--options` or `--lean`. So a link placed anywhere else leaves the
 *   number on the card linking nowhere, and the question is the one field this verb owns that reaches it.
 *
 * - **The heading says what a thing is before it names its code.** A bare code such as a control number tells
 *   the owner nothing. A code in the same two sentences sits in parentheses after its meaning
 *   (`../briefing/untranslatedCode.ts`, the criterion the hand register's headline shares). MEASURED: 119 of 869
 *   distinct recorded question leads failed it.
 *
 * - **The heading leads with the discussion, never a pull request.** The same two sentences may not open on a
 *   pull request or ask the owner to approve, review, merge or land a fix (`../briefing/pullRequestLead.ts`,
 *   shared with `hand post`'s headline and every Slack send's first block); a pull request named further in,
 *   linked, is still drawn. Like the hand and Slack doors it has NO hatch: it is a hold the `unaligned-card`
 *   hatch does not clear, because the rule names no exception and a reword that opens on the evidence is always
 *   possible.
 *
 * - **A command of the owner's sits on lines of its own.** The card lifts a paragraph of the owner's commands out
 *   of the prose into copy blocks (`./commandParagraphs.ts`, mirrored by `site/lib/askCommands.ts`); one buried
 *   inside a sentence is drawn as text the owner cannot copy, so commands to run belong in copy blocks. After the
 *   lift, the prose may not name one
 *   (`../hand/commandInProse.ts`'s `proseCommand`, the hand register's same criterion); a mention of a command the
 *   lifted lines already run is their explanation, and passes. It lifts BEFORE it scans, because a `sudo /bin/sh -c`
 *   line is a command by that criterion wherever it sits.
 *
 * - **A picture is attached, never named.** The owner wants an image on the queue card itself. A
 *   picture file named in the question, the shape or a reconfirm's still-real line is refused
 *   (`./cardImage.ts`), pointing at `handover shot`, which attaches it with a box on what to read. The heading
 *   gate is {@link cardAlignmentVerdict}; every other field is {@link cardProseVerdict}.
 *
 * MEASURED over every `question` and `question-corrected` event in `$SLOPWEAVER_HOME/runs`: 531 of
 * 703 led with no `?` in their first two sentences and 253 named a pull request by number without its URL.
 * Of 25 sampled unlinked hits every one was a real pull request except `PR3`, a stack position — which is
 * why the `PR` spelling needs a space and every number at least two digits. Repro: the scan in the PR body.
 *
 * ## A POLICY refusal, with a hatch
 *
 * Nothing here is a failure of fact: the text would record fine. It is the standing rule saying no, so it is
 * the four-line shape `.claude/rules/error-handling.md` requires, off the `unaligned-card` row. The fix a
 * refusal asks for is always a reword — lead with the question, paste the URL — so the hatch is for the
 * genuine exceptions only, and a card recorded through it is headed by its statement as written. The PR-led heading
 * is the one problem outside it: a hold whose first line says the hatch does not clear it.
 *
 * Pure: no filesystem, no clock. The caller supplies the text and the environment.
 */

import { pullRequestLead, pullRequestLeadReason } from "../briefing/pullRequestLead.js";
import { untranslatedCodeReason, untranslatedCodes } from "../briefing/untranslatedCode.js";
import { proseCommand } from "../hand/commandInProse.js";
import { literalSegmentWords, ownerHandsCommand } from "../hand/runnableLiteral.js";
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";

import { cardHeading, cardLead, LEAD_SENTENCES } from "./cardHeading.js";
import { askHtmlProblems } from "./cardHtml.js";
import { askImageProblems } from "./cardImage.js";
import { commandParagraphs } from "./commandParagraphs.js";
import { NAMED_NUMBER } from "./namedNumber.js";

/**
 * The environment variable that records a question this gate refuses.
 *
 * A LITERAL rather than `hatchEnvVar({ suffix })`: `escape-hatch` in `yarn lint` checks that a row's named
 * reader mentions its own key, and a name assembled at runtime is one no static scan can see.
 */
export const UNALIGNED_CARD_HATCH = "SLOPWEAVER_ALLOW_UNALIGNED_CARD";

/** A GitHub pull-request or issue URL, captured to its number — the link that makes a named number clickable. */
const LINKED_NUMBER = /https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/(?:pull|issues)\/(\d+)/gu;

/**
 * Every way one question's text fails to line up with the card drawn from it, empty when it does.
 *
 * A plain list rather than a typed union: the behaviour IS the multiplicity — a question can lead with a
 * statement and name three unlinked pull requests at once, and the refusal names every one
 * (`.claude/rules/error-handling.md` § "When NOT to introduce a union").
 *
 * @param question the question text a verb is about to record
 * @returns one sentence per problem, in the order a refusal prints them
 */
export function cardAlignmentProblems({ question }: { question: string }): readonly string[] {
  const problems: string[] = [];
  const lead = cardLead({ question });
  if (!lead.some((sentence) => sentence.endsWith("?"))) {
    problems.push(
      `neither of its first ${String(LEAD_SENTENCES)} sentences ends in "?", so the card's heading would TELL the owner ` +
        "something rather than ask — open on the one question the owner is being asked to answer",
    );
  }
  const codes = untranslatedCodes({ text: lead.join(" ") });
  if (codes.length > 0) {
    problems.push(`its heading ${untranslatedCodeReason({ codes })}`);
  }
  problems.push(...prLeadProblems({ question }));
  const linked = new Set([...question.matchAll(LINKED_NUMBER)].map((match) => match[1]));
  const named = new Set<string>();
  for (const match of question.matchAll(NAMED_NUMBER)) {
    const [whole, hashed, spelled] = match;
    const number = [hashed, spelled].find((group) => group !== undefined);
    if (number === undefined || linked.has(number) || named.has(number)) {
      continue;
    }
    named.add(number);
    problems.push(
      `it names "${whole}" with no link — paste the pull request's github.com URL into the question itself, ` +
        "because the card links a pull request's number from the question and never from the shape",
    );
  }
  const buried = buriedCommand({ question });
  if (buried !== undefined) {
    problems.push(
      `it names "${buried}" — a command only the owner's hands run — inside a sentence, where the card draws it as text the ` +
        "owner cannot copy: put the whole command on a line of its own, a blank line above and below, so the card draws " +
        "it as a copy block (one command per line)",
    );
  }
  return problems;
}

/**
 * The one problem no hatch clears: a heading that leads with a pull request. Read off the opening sentence and the
 * sentence the card actually heads with — the first of the lead to ask, as `leadQuestion` in `site/lib/queueCardAsk.ts`
 * picks it — so a background first sentence cannot hide a PR-led heading.
 */
function prLeadProblems({ question }: { question: string }): readonly string[] {
  const lead = cardLead({ question });
  const prLead = [lead[0], cardHeading({ lead })]
    .filter((sentence) => sentence !== undefined)
    .map((sentence) => pullRequestLead({ text: sentence }))
    .find((phrase) => phrase !== undefined);
  return prLead === undefined ? [] : [`its heading ${pullRequestLeadReason({ phrase: prLead })}`];
}

/**
 * The words naming a command of the owner's that the question buries in prose, once its command paragraphs are lifted.
 *
 * @param question the question text a verb is about to record
 * @returns the quoted words, or `undefined` when every command of the owner's sits on lines of its own
 */
function buriedCommand({ question }: { question: string }): string | undefined {
  const lifted = commandParagraphs({ text: question });
  const carried = new Set(
    lifted.commands.flatMap((literal) =>
      literalSegmentWords({ literal }).flatMap((words) => {
        const row = ownerHandsCommand({ words });
        return row === undefined ? [] : [row.id];
      }),
    ),
  );
  return proseCommand({ carried, text: lifted.prose })?.phrase;
}

/** What a verb should do with the question text it was handed. */
export type CardAlignmentVerdict =
  | { readonly kind: "ok" }
  /** Not recordable. `lines` is whole — the caller prints it and adds nothing. */
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/**
 * The verdict on one question's text, with the hatch applied.
 *
 * @param question the question text a verb is about to record
 * @param command the door being refused, as the owner would type it
 * @param env the process environment, for the hatch
 * @returns `ok`, or the whole refusal to print
 */
export function cardAlignmentVerdict({
  question,
  command,
  env,
}: {
  question: string;
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): CardAlignmentVerdict {
  const hatchless = prLeadProblems({ question });
  const problems = [
    ...cardAlignmentProblems({ question }).filter((problem) => !hatchless.includes(problem)),
    ...askImageProblems({ fields: [{ label: "the question", text: question }] }),
    ...askHtmlProblems({ fields: [{ label: "the question", text: question }] }),
  ];
  return alignmentVerdictOf({ command, env, hatchless, problems });
}

/**
 * The verdict on the rest of a card's prose — the shape's fields, a reconfirm's still-real line — judged only for
 * a picture named as text (`./cardImage.ts`) or an HTML file named rather than cited (`./cardHtml.ts`), the two
 * criteria here that are not about the heading. Same hatch: the class is the same,
 * text that does not line up with the card drawn from it.
 *
 * @param fields each field the card draws, with how a refusal names it
 * @param command the door being refused, as the owner would type it
 * @param env the process environment, for the hatch
 * @returns `ok`, or the whole refusal to print
 */
export function cardProseVerdict({
  fields,
  command,
  env,
}: {
  fields: readonly { readonly label: string; readonly text: string }[];
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): CardAlignmentVerdict {
  return alignmentVerdictOf({
    command,
    env,
    hatchless: [],
    problems: [...askImageProblems({ fields }), ...askHtmlProblems({ fields })],
  });
}

/**
 * The refusal over a list of problems, or `ok` when there are none. A `hatchless` problem is a HOLD that names its
 * missing hatch; every other problem is the four-line refusal off the `unaligned-card` row, cleared by its hatch.
 */
function alignmentVerdictOf({
  hatchless,
  problems,
  command,
  env,
}: {
  hatchless: readonly string[];
  problems: readonly string[];
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): CardAlignmentVerdict {
  const open = env[UNALIGNED_CARD_HATCH] === "1";
  const standing = open ? [] : problems;
  if (hatchless.length > 0) {
    return {
      kind: "refused",
      lines: [
        `${command} held: the card's heading leads with a pull request, and that rule has no hatch — ` +
          `${UNALIGNED_CARD_HATCH} does not clear it (a card never leads with a pull request).`,
        ...[...hatchless, ...standing].map((problem) => `  - ${problem}`),
        "NOTHING was recorded and the run is not paused, so reword the card to open on the evidence and the " +
          "question, and run the same command again.",
      ],
    };
  }
  if (standing.length === 0) {
    return { kind: "ok" };
  }
  const hatch = { ...hatchFor({ id: "unaligned-card" }), command };
  return {
    kind: "refused",
    lines: [
      hatchRefusal({ hatch }),
      ...problems.map((problem) => `  - ${problem}`),
      "NOTHING was recorded and the run is not paused, so reword the card and run the same command again.",
    ],
  };
}

/**
 * The verdict `handover register` puts on its `--ask`, which is the card's title on a row that waits on the owner's
 * word. A dispatch row, or a finding with no shape, asks the owner nothing, so it is never judged here.
 *
 * @param ask the `--ask` text the row will be headed by
 * @param env the process environment, for the hatch
 * @param waitsOnOwner whether the row waits on the owner's word — no `--dispatch`, and no `--finding` unless it is shaped
 * @returns `ok`, or the whole refusal to print
 */
export function registerAlignmentVerdict({
  ask,
  env,
  waitsOnOwner,
}: {
  ask: string;
  env: Readonly<Record<string, string | undefined>>;
  waitsOnOwner: boolean;
}): CardAlignmentVerdict {
  if (!waitsOnOwner) {
    return { kind: "ok" };
  }
  return cardAlignmentVerdict({ command: "slopweaver handover register", env, question: ask });
}
