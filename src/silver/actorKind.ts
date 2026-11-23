/**
 * Actor-kind classification — **who produced THIS record**: a person typing, a machine posting, or a
 * machine posting under a person's name.
 *
 * This is the record-level companion to {@link ./accountKind}, and the two answer different questions on
 * purpose. `accountKind` labels an ACCOUNT in the people directory, from hydrated member rows. This labels
 * the ACTOR behind one activity record, from the fields that record actually carries. A ranked to-do list
 * needs the second: before a card says "three reviewers asked for changes" or quotes a thread's own
 * confirmation, something has to establish that a person was on the other end.
 *
 * It exists because the same mistake was made twice in one evening on the same list, and both times the
 * account-level classifier could not have caught it:
 *
 *  - A Slack message quoted as a thread's own confirmation was `subtype: "bot_message"`. A bronze record of
 *    that shape has `author` **undefined** — there is no id to look up, so `classifyAccount` never runs.
 *  - A list said "three reviewers asked for changes"; all three `CHANGES_REQUESTED` were `coderabbitai`.
 *
 * The second is the structural one, and it is worth stating exactly because it is invisible from the
 * account side. GitHub's REST API spells an App's login `coderabbitai[bot]`, and
 * {@link ./accountKind.hasBotLoginSuffix} is built on that suffix — but the review leg reads GraphQL
 * (`reviews(first:100){nodes{author{login} …}}`, `src/corpus/github/activityQueries.ts`), where `login` is the
 * bare `coderabbitai`. Measured on this corpus: **no GitHub bronze record carries a `[bot]` author at all**
 * (`author` values containing `[bot]` across every window read: zero),
 * so on records that rule fires never. An App is also not an org member, so it has no member row to carry
 * `profile.bot` either — among dozens of GitHub member rows, neither `coderabbitai` nor
 * `github-advanced-security` appears, while between them they wrote about a third of the reviews in that window.
 *
 * Reproduce both: `node -e 'require("node:readline").createInterface({input:require("node:fs")
 * .createReadStream(process.argv[1])}).on("line",l=>{const d=JSON.parse(l);if(d.kind==="review")
 * console.log(d.author)})' $SLOPWEAVER_HOME/corpus/bronze/github/<window>.jsonl | sort -u`
 * and `grep -c '\[bot\]' $SLOPWEAVER_HOME/corpus/members/github.jsonl`.
 *
 * **The durable fix ships alongside this.** `src/corpus/github/activityQueries.ts` now selects
 * `author { login __typename }` on every review, comment and timeline actor, so GraphQL answers `Bot` or
 * `User` outright — no name list, no suffix convention, no member row needed. It works from the first
 * refresh after this lands; records already in bronze do not carry it, so existing history stays
 * `unattributed` until those items are re-ingested. That is a note, not a blocker: a history re-ingest is
 * expensive and the classifier is honest without it.
 *
 * **The default is inverted against `accountKind`, deliberately.** There, an unmatched account defaults to
 * `person`, because the cost of a false positive is erasing a real teammate from the directory. Here the
 * costs run the other way: naming a machine as a person on a card is the failure this module was created
 * to stop, and it already happened twice. So an actor this module cannot place is `unattributed` — never
 * `human` — and a surface may not describe an unattributed actor as a person. That is not a disagreement
 * with `accountKind`; it is the same evidence read by a consumer with opposite error costs.
 *
 * Pure — no I/O, no clock, no network.
 */
import type { CorpusRecord } from "../corpus/types.js";
import { isRecord } from "../lib/parsers.js";
import type { AccountClassification } from "./accountKind.js";
import { hasBotLoginSuffix } from "./accountKind.js";

/**
 * What produced one record.
 *
 * `machine-as-person` is its own kind rather than a flavour of `machine` because the two want opposite
 * handling and collapsing them loses a real distinction. Slopweaver's own as-me lane posts under the
 * owner's Slack identity: measured over one window, four messages carry the OWNER's own
 * `author` (a member row with `profile.bot: false` and a trusted email — a real person) together with a
 * `raw.bot_id`, and their text is the reviewer-chasing the list itself proposes. Counting those as the
 * owner having typed something is wrong, and so is discarding them: a chase genuinely went out, which is
 * exactly what a silence threshold has to know about. So they are neither `human` nor `machine`.
 *
 * @internal the public contract for the ranking, exported ahead of the consumer that reads it.
 */
export type ActorKind = "human" | "machine" | "machine-as-person" | "unattributed";

/**
 * A record's actor, plus the exact rule(s) that decided it — so a filter is never a black box.
 *
 * @internal the public contract for the ranking, exported ahead of the consumer that reads it.
 */
export interface ActorClassification {
  readonly kind: ActorKind;
  /** The rules that fired, sorted. Empty only for an `unattributed` actor with nothing to report. */
  readonly reasons: readonly string[];
  /**
   * The human identity a machine post was made under. Present ONLY for `machine-as-person`, where the
   * distinction between "who it reads as" and "what sent it" is the whole point.
   */
  readonly onBehalfOf?: string;
}

/**
 * The Slack `subtype` that marks a message posted by an app through the bot lane. Slack leaves `user`
 * unset on one, which is why the projected record's `author` is undefined and an account lookup has
 * nothing to lean on.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const SLACK_BOT_MESSAGE_SUBTYPE = "bot_message";

/**
 * The type GitHub gives an App account. `author { __typename }` answers `Bot` or `User` on the GraphQL leg
 * and `user.type` answers the identical pair on the REST one, which is the only signal here that needs
 * neither a name list nor a naming convention to hold. One constant serves both because GitHub spells the
 * VALUE the same way on each; only the field it hangs off differs.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const GITHUB_BOT_TYPENAME = "Bot";

/**
 * The GraphQL type GitHub gives a human account. Read as positive evidence of a person, exactly as
 * `Bot` is read as positive evidence of a machine — it is the same field with the same authority, and
 * using only half of it was a measured mistake. On one window of the busier repo, 14 of 17 review authors
 * were real teammates that no member row could place (GitHub member hydration resolves no email
 * without SAML SSO), so a card would have refused to name any of them. `__typename: "User"` names all 14.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const GITHUB_USER_TYPENAME = "User";

/** A `raw` string field, when it is present and non-empty. Pure. */
function rawString({
  raw,
  field,
}: {
  raw: Readonly<Record<string, unknown>> | undefined;
  field: string;
}): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = raw[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The `__typename` off a GitHub record's nested `author` object, when the projection captured one. Pure. */
function githubAuthorTypename({ raw }: { raw: Readonly<Record<string, unknown>> | undefined }): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const author = raw["author"];
  return isRecord(author) ? rawString({ field: "__typename", raw: author }) : undefined;
}

/**
 * The `type` off a GitHub REST hit's nested `user` object — the same answer as `author.__typename`, from the
 * other leg. Pure.
 *
 * The GraphQL activity query never reaches a `pr` or `issue` record: those are projected from the REST
 * issue-search hit ({@link ../corpus/github/fetch}), which selects no `author` at all and spells the account
 * kind `user.type` instead. Measured over hundreds of thousands of GitHub bronze records: every
 * one of the tens of thousands of `pr` rows carries no `__typename`, while `user.type` answers on over half
 * of them — a few percent `Bot` and the rest `User`. Reading only the GraphQL half left a third of the GitHub corpus with no account evidence at all.
 */
function githubUserType({ raw }: { raw: Readonly<Record<string, unknown>> | undefined }): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const user = raw["user"];
  return isRecord(user) ? rawString({ field: "type", raw: user }) : undefined;
}

/**
 * Whether a record's own payload shows a machine sent it, independent of who it is attributed to.
 *
 * Two Slack fields, and they catch very different populations rather than being belt-and-braces. Measured
 * on one window of over a thousand messages: `subtype: "bot_message"` covers **a few dozen**, while
 * a `raw.bot_id` with no such subtype covers **about half the window** — apps posting as their own bot USER, which carry a real `U…`
 * author and read as people at every other field. A classifier keyed on the subtype alone would place
 * 917 of 944 machine posts as human, so the subtype is the minority path here, not the main one.
 *
 * Reproduce: `grep -c '"subtype":"bot_message"' $SLOPWEAVER_HOME/corpus/bronze/slack/<window>.jsonl`.
 *
 * GitHub's `author.__typename` is deliberately NOT here — see {@link machineIdentityReasons} for why the
 * two are different questions.
 *
 * @param record the corpus record to inspect
 * @returns the machine-transport reasons that fired, sorted; empty when the payload shows none
 */
export function machineTransportReasons({ record }: { record: CorpusRecord }): readonly string[] {
  const raw = isRecord(record.raw) ? record.raw : undefined;
  const reasons: string[] = [];
  if (rawString({ raw, field: "subtype" }) === SLACK_BOT_MESSAGE_SUBTYPE) {
    reasons.push(`slack-subtype:${SLACK_BOT_MESSAGE_SUBTYPE}`);
  }
  if (rawString({ raw, field: "bot_id" }) !== undefined) {
    reasons.push("slack-bot-id");
  }
  return reasons.toSorted();
}

/**
 * Whether a record's own payload shows the AUTHOR ITSELF is a machine — a different question from
 * {@link machineTransportReasons}, and the distinction is load-bearing rather than tidy.
 *
 * A transport signal says a machine SENT this, which leaves open whose identity it wore: Slopweaver's
 * as-me lane sends under a real person's account, and that is the whole reason `machine-as-person` exists.
 * An identity signal says the account on the record is not a person at all, so there is no "on behalf of"
 * to carry and treating one as an as-me post would invent a person who was never involved.
 *
 * The signal is GitHub's own account type — `author.__typename` on the GraphQL leg, `user.type` on the REST
 * one. It is the authoritative one — no name list, no suffix convention, no member row — and it is what lets
 * an App review classify as `machine` rather than merely `unattributed`. Records written before
 * {@link ../corpus/github/activityQueries} began selecting `__typename` do not carry it, so that part of history
 * stays `unattributed` until those items are re-ingested; every refresh after this lands is correct. The
 * REST half needs no re-ingest at all: `user` is the verbatim search hit and has always carried `type`.
 *
 * Only the `Bot` half is an answer here. `User` is read by {@link classifyActor} as evidence of a PERSON,
 * and any other type GitHub may return (`Organization`, `Mannequin`, …) is deliberately neither — an
 * unrecognised type leaves the record `unattributed` rather than being forced into a guess.
 *
 * @param record the corpus record to inspect
 * @returns the machine-identity reasons that fired, sorted; empty when the payload shows none
 */
export function machineIdentityReasons({ record }: { record: CorpusRecord }): readonly string[] {
  const raw = isRecord(record.raw) ? record.raw : undefined;
  if (githubAuthorTypename({ raw }) === GITHUB_BOT_TYPENAME) {
    return [`github-typename:${GITHUB_BOT_TYPENAME}`];
  }
  if (githubUserType({ raw }) === GITHUB_BOT_TYPENAME) {
    return [`github-user-type:${GITHUB_BOT_TYPENAME}`];
  }
  return [];
}

/**
 * Classify the actor behind one record.
 *
 * The order is the rule. A machine IDENTITY signal settles it outright — the author is not a person, so
 * no later evidence can make one appear. Failing that, a machine TRANSPORT signal outranks the account
 * index, because the payload is evidence about this message while the index is evidence about an account,
 * and the as-me lane is precisely where a genuine person's account sends a machine's words. Only once both
 * are clean does the author's account decide, and an author no source can place stays `unattributed`
 * rather than being promoted to a person.
 *
 * @param record the corpus record whose actor is in question
 * @param index the member-row index INCLUDING its people ({@link ./accountKind.accountKindIndexAll})
 * @returns the actor kind, the rules that decided it, and — for an as-me post — whose identity it wore
 */
export function classifyActor({
  record,
  index,
}: {
  record: CorpusRecord;
  index: ReadonlyMap<string, AccountClassification>;
}): ActorClassification {
  const identity = machineIdentityReasons({ record });
  if (identity.length > 0) {
    return { kind: "machine", reasons: identity };
  }

  const transport = machineTransportReasons({ record });
  const author = record.author !== undefined && record.author.length > 0 ? record.author : undefined;
  if (author === undefined) {
    return transport.length > 0
      ? { kind: "machine", reasons: transport }
      : { kind: "unattributed", reasons: ["no-author"] };
  }

  const account = index.get(author.trim().toLowerCase());
  if (transport.length > 0) {
    return withTransport({ account, author, transport });
  }
  return withoutTransport({ account, author, record });
}

/**
 * The verdict for an author whose record carries a machine transport signal. Pure.
 *
 * A transport signal under an account the directory knows to be a real person is the as-me lane, and it
 * is the only place `machine-as-person` is produced. Under a bot's own account it is simply a machine —
 * naming it "on behalf of" a bot would invent a party that was never involved.
 *
 * @param transport the reasons {@link machineTransportReasons} produced, already non-empty
 * @returns the actor classification
 */
function withTransport({
  account,
  author,
  transport,
}: {
  account: AccountClassification | undefined;
  author: string;
  transport: readonly string[];
}): ActorClassification {
  if (account?.kind === "person") {
    return { kind: "machine-as-person", onBehalfOf: author, reasons: [...transport, "account:person"].toSorted() };
  }
  const machineReasons = account !== undefined && isMachineKind({ kind: account.kind }) ? account.reasons : [];
  return { kind: "machine", reasons: [...transport, ...machineReasons].toSorted() };
}

/**
 * The verdict for an author whose record shows no machine transport — the ordinary path, where the
 * author's own account and then GitHub's `__typename` decide. Pure.
 *
 * @param record needed only for its `raw`, where a captured `__typename` lives
 * @returns the actor classification
 */
function withoutTransport({
  account,
  author,
  record,
}: {
  account: AccountClassification | undefined;
  author: string;
  record: CorpusRecord;
}): ActorClassification {
  if (hasBotLoginSuffix({ value: author })) {
    return { kind: "machine", reasons: ["login-suffix"] };
  }
  if (account !== undefined && isMachineKind({ kind: account.kind })) {
    return { kind: "machine", reasons: account.reasons.toSorted() };
  }
  if (account?.kind === "person") {
    return { kind: "human", reasons: ["account:person"] };
  }
  // GitHub saying the author is a `User` is the same evidence, from the same field, as it saying `Bot`.
  // It is checked after the account index only so a directory hit keeps the richer reason.
  const raw = isRecord(record.raw) ? record.raw : undefined;
  if (githubAuthorTypename({ raw }) === GITHUB_USER_TYPENAME) {
    return { kind: "human", reasons: [`github-typename:${GITHUB_USER_TYPENAME}`] };
  }
  if (githubUserType({ raw }) === GITHUB_USER_TYPENAME) {
    return { kind: "human", reasons: [`github-user-type:${GITHUB_USER_TYPENAME}`] };
  }
  // An author with no member row and no structural signal — pre-`__typename` bronze, or a source that
  // offers no equivalent. A genuine external contributor lands here too, which is why this is a refusal to
  // guess rather than a verdict.
  return { kind: "unattributed", reasons: ["author-not-in-directory"] };
}

/** Whether the directory placed an account as something that is not a person. Pure. */
function isMachineKind({ kind }: { kind: AccountClassification["kind"] }): boolean {
  return kind === "bot" || kind === "integration";
}

/**
 * Whether a surface may name this actor as a person. The one question every card asks, given a name so no
 * caller re-derives it from the union and gets `unattributed` wrong.
 *
 * @param classification the actor classification to test
 * @returns true only for a `human` — an `unattributed` actor is explicitly not safe to describe as one
 */
export function namesAPerson({ classification }: { classification: ActorClassification }): boolean {
  return classification.kind === "human";
}
