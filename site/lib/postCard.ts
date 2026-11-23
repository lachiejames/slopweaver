/**
 * The queue card for a Slack message parked for the owner's yes — under their own name, or a finding as the bot — and,
 * while Codex's draft sits beside it, the A-or-B the owner picks. Every option is a command rather than a button: it
 * would go out as the owner, so nobody else can decide to send it.
 */

import {
  ACT_BADGE,
  asQuestion,
  type BriefingCard,
  type CardAct,
  type CardHeadPerson,
  type CardHow,
  type CardOption,
  foldedText,
  localPagesIn,
  peopleVerbOf,
  readable,
  saidText,
} from "./queueCard";

/** A message parked for the owner's yes, as the draft register holds one — under their own name, or a finding as the bot. */
export interface PostRecord {
  readonly id: string;
  /**
   * Who it goes out as: `me`, or `bot` for a finding shared top-level into a channel. Absent
   * reads as the owner, the register's contract before a bot row could be parked.
   */
  readonly actor?: "me" | "bot" | undefined;
  /** What it does, as `slack draft record --act` declared it — `undefined` on a row recorded without one. */
  readonly act: Exclude<CardAct, "question"> | undefined;
  /**
   * Who it is addressed to, by member id (`./slackPeople.ts` `draftDestination`): the DM peer, else its person
   * mentions — resolved by the caller, since this module reads no roster.
   */
  readonly people: readonly CardHeadPerson[];
  /** Where it lands and what it answers, in one plain line (`./slackPeople.ts` `draftContextInWords`). */
  readonly context: string | undefined;
  /**
   * Who it is to and where, from its preposition — `to Kyle in a direct message`, `in #dev` — named off the
   * roster by the caller (`./slackPeople.ts` `addressedInWords`), since this module reads no roster.
   */
  readonly addressed: string;
  /** The `--why` line the recorder was given: what this draft is for. */
  readonly why: string;
  /** The whole message as plain text — the payload's own notification fallback. */
  readonly text: string;
  /** Who the message would notify, as a reader names them — a person's name where the roster holds one. */
  readonly mentions: readonly string[];
  /** Voice findings that did not refuse. The owner's to judge, so the card carries them. */
  readonly advisory: readonly string[];
  /** What the owner's approval binds: the destination, the identity, the thread and the exact bytes. */
  readonly digest: string;
  /**
   * The message a thread reply goes under, in words (`./slackPeople.ts` `draftParentInWords`), or `undefined`
   * for a top-level post — a reply must never read as a channel post.
   */
  readonly parent: string | undefined;
  /** How it goes out, as `slack draft list --json` decided: the command, or the re-record it needs instead. */
  readonly release:
    { readonly kind: "send"; readonly command: string } | { readonly kind: "re-record"; readonly why: string };
  /**
   * What the card leads with: the receipts the row brings, why it needs none, or what was tried for one it lacks
   * (`../components/live/draftReceipts.ts`, via the caller). A card that makes a
   * claim with no receipt never reaches the owner unsaid.
   */
  readonly receiptsLine: string;
  /** What the card says next once a session judged the owner's words on it (`./postJudgement.ts`, via the caller). */
  readonly judgementLine?: string | undefined;
  /**
   * Present while Codex's draft sits beside this one and the owner has chosen neither: the card asks
   * which, and neither can be sent until the owner says. `originalBy` names who wrote A, `model` what wrote B, and
   * `question` asks it in those same words, so a card never calls an undetected composer Claude. `dropsReceipts` is
   * the list's verdict that B links nowhere while A links to its receipt, so B is shown but not offered.
   */
  readonly choice?:
    | {
        readonly originalBy: string;
        readonly model: string;
        readonly question: string;
        readonly dropsReceipts: boolean;
      }
    | undefined;
  /** True while Codex's draft beside this one is owed and not yet drawn: a release refuses until it is shown. */
  readonly codexOwed?: boolean | undefined;
}

/**
 * A post card's options while the owner chooses between the original and Codex's draft: either pick waits for their yes to
 * send, so choosing is never sending.
 */
function postChoiceOptions({
  choice,
  post,
}: {
  choice: NonNullable<PostRecord["choice"]>;
  post: PostRecord;
}): readonly CardOption[] {
  const pick = ({ variant }: { variant: "original" | "codex" }): CardHow => ({
    command: `slopweaver slack draft pick ${post.id} --variant ${variant} --anchor <where the owner chose>`,
    kind: "elsewhere",
    where: "a session, off your words",
  });
  return [
    {
      how: pick({ variant: "original" }),
      letter: "A",
      sentence: `Choose ${choice.originalBy} draft: it waits for your yes to send.`,
    },
    choice.dropsReceipts
      ? {
          how: {
            command: `slopweaver slack draft record … --supersedes ${post.id}`,
            kind: "elsewhere",
            where: "a session, re-cutting Codex's wording with A's link in it",
          },
          letter: "B",
          sentence:
            "Prefer Codex's words? It drops the link A brings, so it is re-cut with the link before you can choose it.",
        }
      : {
          how: pick({ variant: "codex" }),
          letter: "B",
          sentence: "Choose Codex's draft: its words replace A's and wait for your yes.",
        },
    { how: { kind: "silence" }, letter: "C", sentence: "Leave both parked while you read them; nothing is sent." },
  ];
}

/**
 * Option A of a post card: send it with the verb the register chose, or re-record a row neither verb will send —
 * the register's own `why` says how, since a row parked top-level for a thread and a finding parked as the owner in a
 * channel each re-record differently.
 */
function postSendOption({ post }: { post: PostRecord }): CardOption {
  if (post.release.kind === "re-record") {
    return {
      how: {
        command: `slopweaver slack draft drop ${post.id} --note "re-recorded: <the new row's id>"`,
        kind: "elsewhere",
        where: "a session, after re-recording it as the reason says",
      },
      letter: "A",
      sentence: `Re-record it, then drop this row: ${post.release.why}`,
    };
  }
  const who = post.actor === "bot" ? "as the bot" : "under your own name";
  const goes = post.parent === undefined ? `the message posts ${who}` : `the reply goes into the thread ${who}`;
  return {
    how: { command: post.release.command, kind: "elsewhere", where: "a session, through the door" },
    letter: "A",
    sentence: `Send it as it stands: ${goes}.`,
  };
}

/**
 * A post card's title: WHAT it sends and as whom, never who it is to — the people row names them by id, and a name
 * written into the title is the one a chip landed in the middle of.
 *
 * @returns `Send this bump as you?`, or on a row with no act `Post this as you?` / `Reply with this as the bot?`
 */
export function postTitle({ post }: { post: Pick<PostRecord, "act" | "actor" | "parent"> }): string {
  const as = post.actor === "bot" ? "as the bot" : "as you";
  if (post.act !== undefined) {
    return asQuestion({ text: `Send this ${ACT_BADGE[post.act].toLowerCase()} ${as}` });
  }
  if (post.parent === undefined) {
    return asQuestion({ text: `Post this ${as}` });
  }
  return asQuestion({ text: `Reply with this ${as}` });
}

/**
 * The card for a message parked under the owner's own name.
 *
 * It would go out as the owner, so nobody else can decide to send it, and every option below is a command rather than a
 * button for exactly that reason. The card says nothing about why it is the owner's: that is implied, and saying it reads
 * as robotic.
 *
 * @param post the parked draft
 * @returns the card
 */
export function postCard({ post }: { post: PostRecord }): BriefingCard {
  const mentions = post.mentions.filter((mention) => saidText({ text: mention }) !== undefined);
  const notifies =
    mentions.length === 0 ? "It tags nobody." : `It tags ${String(mentions.length)}: ${mentions.join(", ")}.`;
  return {
    head: { act: post.act, context: post.context, people: post.people, peopleVerb: peopleVerbOf({ act: post.act }) },
    ifSilent: "Nothing is sent. The draft stays parked and the channel hears nothing from you.",
    lean: undefined,
    options: post.choice === undefined ? postOptions({ post }) : postChoiceOptions({ choice: post.choice, post }),
    commands: [],
    examples: undefined,
    pages: localPagesIn({ text: post.why }),
    problem: undefined,
    stakes: undefined,
    question: post.choice === undefined ? postTitle({ post }) : post.choice.question,
    subject: post.addressed,
    what: foldedText({
      text: [
        sentenceOf({ text: post.receiptsLine }),
        post.judgementLine,
        ...choiceSentences({ choice: post.choice, codexOwed: post.codexOwed === true, original: "A" }),
        post.parent === undefined ? undefined : `It replies ${post.parent}.`,
        post.release.kind === "re-record" ? `It cannot be sent as parked: ${post.release.why}` : undefined,
        saidText({ text: readable({ text: post.why }) }),
        notifies,
        "Nothing has been sent: the recorder parked it here.",
      ]
        .filter((part) => part !== undefined)
        .join(" "),
    }),
    kind: "briefing",
    whyYou: undefined,
  };
}

/**
 * What a card says about Codex's draft beside the original: the choice the owner owes, that B drops A's receipt, or that B
 * has not arrived. One wording for the post card, which letters the two drafts, and for an ask or hand card that
 * absorbed the draft's post card (`./queueDraftOwnership.ts`), whose letters are its own options — so it names the
 * original by who wrote it instead.
 *
 * @param choice the choice the owner owes, when one is owed
 * @param codexOwed whether Codex's draft is still being written
 * @param original how the card names the original: `A`, or the writer's possessive ("Claude's draft")
 * @returns the sentences, empty when there is nothing to choose and nothing coming
 */
export function choiceSentences({
  choice,
  codexOwed,
  original,
}: {
  choice: PostRecord["choice"];
  codexOwed: boolean;
  original: string;
}): readonly string[] {
  const out: string[] = [];
  if (choice !== undefined) {
    const pick = original === "A" ? "choose one" : "say which one goes";
    out.push(
      `Codex drafted the same message blind to ${original}, on ${choice.model}; ${pick} before either can be sent.`,
    );
    if (choice.dropsReceipts) {
      out.push(`Codex's draft drops the link ${original} brings as its receipt.`);
    }
  }
  if (codexOwed) {
    out.push("Codex's draft beside this one has not arrived yet, and this one is not sent before both are shown.");
  }
  return out;
}

/** A line closed with a full stop, unless it already ends a sentence — so it reads as one beside the next. */
function sentenceOf({ text }: { text: string }): string {
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

/** A post card's options once nothing is left to choose: send it, discard it, or leave it parked. */
function postOptions({ post }: { post: PostRecord }): readonly CardOption[] {
  return [
    postSendOption({ post }),
    {
      how: {
        command: `slopweaver slack draft drop ${post.id} --note "<why>"`,
        kind: "elsewhere",
        where: "a session",
      },
      letter: "B",
      sentence: "Discard it: nothing is posted and the row is resolved.",
    },
    {
      how: { kind: "silence" },
      letter: "C",
      sentence: "Leave it parked while you read it; the whole message is on this panel.",
    },
  ];
}
