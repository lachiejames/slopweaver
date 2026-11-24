/**
 * The closed list of acts the console may take — beside `liveVerbs.ts`, `syncVerbs.ts`, `talkTools.ts` and
 * `storeReadVerbs.ts` (the Store page's parameterised reads), and the one that writes.
 *
 * The queue's panels APPROVE, so the console writes; the shape of the door does not move: every act here is one
 * `slopweaver` verb, run on this machine with a literal argv, and the only thing a request may supply is the value of
 * a SLOT this file declared — an id the register already holds, or words the page printed on the button. The
 * console takes no typed words, so a `text` slot carries fixed words a button or a select shows the owner before
 * they press it. There is no slot whose value is a verb, a flag or a path, so
 * the list is the whole of what the act route can run, and an unknown slug is a 404.
 *
 * What may never be a row here, and why: `turn`, `codex review`, `cmux spawn`, or anything that launches a model
 * (rule 2 — no headless model; a press on a web page is not a visible session), and any verb that reaches
 * a provider without the verb's own dry-run and refusal shown first. `github enqueue` is deliberately
 * absent for that second reason — it needs the repository and a dry-run report in front of the owner before a
 * press, which is owed and stated on the queue page. `gmail send` is absent because no
 * verb lists the owner's drafts yet. Both are capability work, not missing rows.
 *
 * ## The two mail rows: a draft in the owner's mailbox, dry run first
 *
 * The queue carries a mail-native preview whose Gmail draft is created only when the owner presses.
 * `gmail draft --board <slug> --expect <digest>` reaches Gmail, so it sits here under the rule above: the
 * mail preview presses the `--dry-run` row FIRST and shows what the verb composed — or its refusal — and
 * only a clean dry run enables the second press. Neither row sends anything; a draft reaches nobody until
 * `gmail send` is run with its own approval digest. The slots are a board SLUG and a DIGEST, both `id`
 * shaped: the mail itself never travels in a request, because the verb reads it off the row
 * (`src/cli/commands/gmail/boardDraft.ts`), so a press cannot draft a message nobody recorded.
 *
 * ## Another list exists, and it is deliberately not this one
 *
 * The console voice (`site/lib/talkToolsList.ts`) declares what a MODEL may call. It is a separate list
 * whose type has one relay arm and no generic write arm, so nothing in it can resolve to an act here.
 * Keeping them apart is the mechanism rather than a convention: a model tool that could reach this file
 * would let source text it reads induce a same-origin press, and the act route says in its own header that
 * its origin guard does not establish a human press. The voice's relay writer, `relay_steer`, reaches
 * `/api/talk/relay` only through `relayGate.ts`, which requires the owner's own words since the last relay and no
 * third-party read after them.
 */

import { plansActVerbs } from "./actVerbsPlans";
import { privateTermsActVerbs } from "./actVerbsPrivateTerms";
import { RAISE_USAGE_LIMIT_READS, RAISE_USAGE_LIMIT_SLUG } from "./planUsageLimit";
import { type BuiltArgv, fillSlots, type Slot } from "./slots";

/** One act the console may take. */
export interface ActVerb {
  /** The name the act route takes as `/api/act/<slug>`. */
  readonly slug: string;
  /** The argv after `slopweaver` — literal strings and declared slots, never built from a request. */
  readonly argv: readonly (string | Slot)[];
  /** How long the run may take before it is killed and reported as outcome-unknown. */
  readonly timeoutMs: number;
  /** The verb line as a reader would type it, with the slots shown as `<slot>`. */
  readonly title: string;
  /** The live-allowlist slug the page re-reads once the act has written. */
  readonly readsSlug: string;
}

/**
 * Who the ledger says recorded the act. `--by-session` is free text on every verb here; the console names
 * itself so a row it wrote can be told apart from one a session wrote.
 */
export const BY_SESSION = "work-console";

/** Ten seconds: every ledger act here appends one row and returns. */
const LOCAL_TIMEOUT_MS = 10_000;

/**
 * Thirty seconds for a reviewer approve, which appends its row and then parks the ask through `slack draft
 * record`: two Slack reads (`conversations.info`, `auth.test`) on the user token. A kill inside the ten a ledger
 * act gets would leave the pick recorded and the ask unparked, which is the state the press exists to end.
 */
const PARK_TIMEOUT_MS = 30_000;

/**
 * Forty seconds for a Gmail draft: a token refresh and one API write, with room for a slow network and
 * still inside the shape where silence means something is wrong.
 */
const GMAIL_TIMEOUT_MS = 40_000;

/** The candidate a workstreams press is about: an id the candidates document holds. */
const CANDIDATE: Slot = { shape: "id", slot: "candidate" };

/** The register workstream a placing word names: an id the candidates document's `register` lists. */
const TARGET: Slot = { shape: "id", slot: "target" };

/**
 * One `workstreams` press that appends a ledger row: the verb, its flags and slots, then the console's own
 * `--via console --by-session work-console --json`, with the title read off the argv so the two cannot drift.
 *
 * @param args the flags and slots between the verb and the console's tail
 * @returns the row
 */
function workstreamsAct({
  args,
  slug,
  verb,
}: {
  args: readonly (string | Slot)[];
  slug: string;
  verb: string;
}): ActVerb {
  const argv = ["workstreams", verb, ...args, "--via", "console", "--by-session", BY_SESSION, "--json"];
  const line = argv.map((part) => (typeof part === "string" ? part : `<${part.slot}>`)).join(" ");
  return { argv, readsSlug: "workstream-candidates", slug, timeoutMs: LOCAL_TIMEOUT_MS, title: `slopweaver ${line}` };
}

/**
 * One Not now… answer on a hand step: its note comes down until the chosen time and the step stays open. One
 * act per answer rather than a choice slot, so the allowlist names every argv the console can run — never a
 * bare dismiss (`src/hand/snooze.ts` owns the choices).
 *
 * @param choice the snooze `--for` value
 * @returns the act
 */
function handSnooze({ choice }: { choice: "1h" | "3h" | "tomorrow" }): ActVerb {
  return {
    argv: ["hand", "snooze", { shape: "id", slot: "id" }, "--for", choice, "--by-session", BY_SESSION, "--json"],
    readsSlug: "hands",
    slug: `hand-snooze-${choice}`,
    timeoutMs: LOCAL_TIMEOUT_MS,
    title: `slopweaver hand snooze <id> --for ${choice} --by-session ${BY_SESSION} --json`,
  };
}

/**
 * "Come back to it" on any Queue card, or putting it back: one row appended to the owner's deferral ledger, which the
 * page orders by (`queue-deferred`). Two acts rather than a choice slot, so the allowlist names both argvs. The card's
 * register and id are two `id` slots because a card key's colon is no `id` shape; the verb joins them and refuses a
 * register the owner's Queue does not draw.
 *
 * @param restore whether the press puts the card back
 * @returns the act
 */
function queueDefer({ restore }: { restore: boolean }): ActVerb {
  const flag = restore ? ["--restore"] : [];
  const argv: readonly (string | Slot)[] = [
    "queue",
    "defer",
    "--kind",
    { shape: "id", slot: "kind" },
    "--id",
    { shape: "id", slot: "id" },
    ...flag,
    "--by-session",
    BY_SESSION,
    "--json",
  ];
  const line = argv.map((part) => (typeof part === "string" ? part : `<${part.slot}>`)).join(" ");
  return {
    argv,
    readsSlug: "queue-deferred",
    slug: restore ? "queue-restore" : "queue-defer",
    timeoutMs: LOCAL_TIMEOUT_MS,
    title: `slopweaver ${line}`,
  };
}

/**
 * What a hand step's Mark done records as `--did`, printed on the button. The console takes no typed words, so what
 * the owner did beyond that is said in the call's chat with the card open.
 */
export const HAND_DONE_WORDS = "done, marked on the console";

/** A hand step's Not now buttons, one per snooze act, in the native note's order and under its labels. */
export const HAND_SNOOZE_BUTTONS: readonly { readonly slug: string; readonly label: string }[] = [
  { label: "Not now: 1 hour", slug: "hand-snooze-1h" },
  { label: "3 hours", slug: "hand-snooze-3h" },
  { label: "Tomorrow", slug: "hand-snooze-tomorrow" },
];

/** Every act the console may take. */
export const ACT_VERBS: readonly ActVerb[] = [
  {
    argv: [
      "hand",
      "done",
      { shape: "id", slot: "id" },
      "--did",
      { shape: "text", slot: "did" },
      "--by-session",
      BY_SESSION,
      "--json",
    ],
    readsSlug: "hands",
    slug: "hand-done",
    timeoutMs: LOCAL_TIMEOUT_MS,
    title: `slopweaver hand done <id> --did <did> --by-session ${BY_SESSION} --json`,
  },
  handSnooze({ choice: "1h" }),
  handSnooze({ choice: "3h" }),
  handSnooze({ choice: "tomorrow" }),
  queueDefer({ restore: false }),
  queueDefer({ restore: true }),
  {
    argv: [
      "autonomy",
      "steer",
      { shape: "id", slot: "actionId" },
      "--steer",
      { shape: "text", slot: "steer" },
      "--by-session",
      BY_SESSION,
      "--json",
    ],
    readsSlug: "autonomy",
    slug: "autonomy-steer",
    timeoutMs: LOCAL_TIMEOUT_MS,
    title: `slopweaver autonomy steer <actionId> --steer <steer> --by-session ${BY_SESSION} --json`,
  },
  {
    argv: [
      "gmail",
      "draft",
      "--board",
      { shape: "id", slot: "slug" },
      "--expect",
      { shape: "id", slot: "digest" },
      "--dry-run",
    ],
    readsSlug: "board",
    slug: "gmail-draft-board-dry-run",
    timeoutMs: GMAIL_TIMEOUT_MS,
    title: "slopweaver gmail draft --board <slug> --expect <digest> --dry-run",
  },
  {
    argv: ["gmail", "draft", "--board", { shape: "id", slot: "slug" }, "--expect", { shape: "id", slot: "digest" }],
    readsSlug: "board",
    slug: "gmail-draft-board",
    timeoutMs: GMAIL_TIMEOUT_MS,
    title: "slopweaver gmail draft --board <slug> --expect <digest>",
  },
  // The reviewer row records the owner's approve of a suggested reviewer and SENDS NOTHING — it parks the ask to that
  // person on the owner's queue, and the send stays the owner's yes there. The repository slot is the bare name
  // (`acme-admin`): an `id` slot refuses a slash, and the verb resolves a bare name against the last landing reading
  // and refuses one naming two repositories. A decline carries the owner's words, so it is said in the call's chat
  // with the pull request open, never typed here.
  {
    argv: [
      "github",
      "reviewer",
      "pick",
      "--repo",
      { shape: "id", slot: "repo" },
      "--number",
      { shape: "count", slot: "number" },
      "--reviewer",
      { shape: "id", slot: "reviewer" },
      "--verdict",
      "approve",
      "--by-session",
      BY_SESSION,
      "--json",
    ],
    readsSlug: "reviewers",
    slug: "reviewer-approve",
    timeoutMs: PARK_TIMEOUT_MS,
    title: `slopweaver github reviewer pick --repo <repo> --number <number> --reviewer <reviewer> --verdict approve --by-session ${BY_SESSION} --json`,
  },
  // The owner's one word on a mined workstream candidate. Both slots are `id` shaped: the candidate is an id the candidates
  // document already holds, and the reaction is one of five kebab-case words the VERB refuses any other of
  // (`--as`, `src/cli/commands/workstreams/react.ts`), so no new slot shape is needed to keep the list closed. A yes
  // may add a discovery tile to the register; the page re-reads `workstreams` itself on a done yes.
  {
    argv: [
      "workstreams",
      "react",
      "--candidate",
      { shape: "id", slot: "candidate" },
      "--as",
      { shape: "id", slot: "reaction" },
      "--via",
      "console",
      "--by-session",
      BY_SESSION,
      "--json",
    ],
    readsSlug: "workstream-candidates",
    slug: "workstream-react",
    timeoutMs: LOCAL_TIMEOUT_MS,
    title: `slopweaver workstreams react --candidate <candidate> --as <reaction> --via console --by-session ${BY_SESSION} --json`,
  },
  // What DONE means for a candidate: one of the definitions it offers, by id, or all of them. The console presses one
  // BEFORE the yes it goes with, so the yes carries it onto the new tile. One in the owner's own words is said in the
  // call's chat.
  {
    argv: [
      "workstreams",
      "define",
      "--candidate",
      { shape: "id", slot: "candidate" },
      "--option",
      { shape: "id", slot: "option" },
      "--via",
      "console",
      "--by-session",
      BY_SESSION,
      "--json",
    ],
    readsSlug: "workstream-candidates",
    slug: "workstream-define-option",
    timeoutMs: LOCAL_TIMEOUT_MS,
    title: `slopweaver workstreams define --candidate <candidate> --option <option> --via console --by-session ${BY_SESSION} --json`,
  },
  // The conversation a candidate owes one person, PARKED on the owner's Queue and never sent. Both slots are ids: the opener
  // is the candidate's own, read by the verb, so no words travel in the request and a press cannot draft a message
  // the mine did not write. Parking goes through `slack draft record`'s Slack reads, hence the park timeout.
  {
    argv: [
      "workstreams",
      "loop-in",
      "--candidate",
      { shape: "id", slot: "candidate" },
      "--person",
      { shape: "id", slot: "person" },
      "--json",
    ],
    readsSlug: "workstream-candidates",
    slug: "workstream-loop-in",
    timeoutMs: PARK_TIMEOUT_MS,
    title: "slopweaver workstreams loop-in --candidate <candidate> --person <person> --json",
  },
  // The rest of the tile's reactions. A slot is never optional and a
  // flag is never a slot, so each combination of flags the verb takes is its own row: a placing word names a register
  // id, a not-mine names the register id that covers it, and an accept names an earlier steer off a select.
  workstreamsAct({
    args: ["--candidate", CANDIDATE, "--as", "same-as", "--same-as", TARGET],
    slug: "workstream-same-as",
    verb: "react",
  }),
  workstreamsAct({
    args: ["--candidate", CANDIDATE, "--as", "milestone-of", "--milestone-of", TARGET],
    slug: "workstream-milestone-of",
    verb: "react",
  }),
  workstreamsAct({
    args: ["--candidate", CANDIDATE, "--as", "outcome-of", "--outcome-of", TARGET],
    slug: "workstream-outcome-of",
    verb: "react",
  }),
  workstreamsAct({
    args: ["--candidate", CANDIDATE, "--as", "no", "--covered-by", TARGET],
    slug: "workstream-not-mine-covered",
    verb: "react",
  }),
  workstreamsAct({
    args: ["--candidate", CANDIDATE, "--as", "yes", "--steer", { shape: "text", slot: "steer" }],
    slug: "workstream-accept-steer",
    verb: "react",
  }),
  workstreamsAct({ args: ["--candidate", CANDIDATE, "--all"], slug: "workstream-define-all", verb: "define" }),
  workstreamsAct({
    args: ["--candidate", CANDIDATE, "--all", "--first", { shape: "id", slot: "option" }],
    slug: "workstream-define-all-first",
    verb: "define",
  }),
  // The Fleet page's raise (at a 30% limit the fleet stops rather than exceed it). One step up off
  // the limit the page drew, and `--from` names that limit so the verb refuses when the register has since moved —
  // a press drawn from an older reading can never lower a limit the owner raised elsewhere. The allowance is a literal: only a
  // weekly-window plan is ever `at-usage-limit`, a monthly-spend one is not measured and offers no raise. The verb
  // refuses any percent off the ten steps and any provider but the two.
  {
    argv: [
      "plans",
      "set-usage-limit",
      "--provider",
      { shape: "id", slot: "provider" },
      "--plan",
      { shape: "id", slot: "plan" },
      "--percent",
      { shape: "count", slot: "percent" },
      "--from",
      { shape: "count", slot: "from" },
      "--allowance",
      "weekly-window",
      "--json",
    ],
    readsSlug: RAISE_USAGE_LIMIT_READS,
    slug: RAISE_USAGE_LIMIT_SLUG,
    timeoutMs: LOCAL_TIMEOUT_MS,
    title:
      "slopweaver plans set-usage-limit --provider <provider> --plan <plan> --percent <percent> --from <from> --allowance weekly-window --json",
  },
  ...plansActVerbs({ localTimeoutMs: LOCAL_TIMEOUT_MS }),
  ...privateTermsActVerbs({ bySession: BY_SESSION, localTimeoutMs: LOCAL_TIMEOUT_MS }),
];

/**
 * Resolve a slug off the URL to a row, or nothing.
 *
 * @param slug the name off the URL
 * @returns the row, or `undefined` for a slug the list does not hold
 */
export function actVerbFor({ slug }: { slug: string }): ActVerb | undefined {
  return ACT_VERBS.find((row) => row.slug === slug);
}

/**
 * The verb line a button prints beside itself — read off this list, never typed at the button.
 *
 * The command a reader is shown and the command the press actually runs have to be one fact. A slug this list
 * does not hold is NAMED, because a button with no line under it looks exactly like a button whose line
 * happened to be short.
 *
 * @param slug the act row the button presses
 * @returns the row's title, or a sentence saying no row carries that slug
 */
export function actLineFor({ slug }: { slug: string }): string {
  const verb = actVerbFor({ slug });
  if (verb === undefined) {
    return `NO ACT ROW NAMED ${slug}`;
  }
  return verb.title;
}

/**
 * Fill a row's slots from a request body, refusing anything that is not exactly the declared slots.
 *
 * The checking itself lives in `slots.ts` and is shared with the console voice's read tools; what stays here is
 * the act list's own subject line, so a refusal names the act rather than the mechanism.
 *
 * @param verb the row
 * @param slots the request's fields
 * @returns the argv, or the refusal
 */
export function buildActArgv({ verb, slots }: { verb: ActVerb; slots: Record<string, unknown> }): BuiltArgv {
  return fillSlots({ parts: verb.argv, subject: verb.slug, supplied: slots });
}
