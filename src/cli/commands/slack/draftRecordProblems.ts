/**
 * `slack draft record`'s flag checks that are about WHICH row the park is — its thread, the rows it re-cuts, and their
 * yes. Split out of `./draftCore.ts`, which assembles the options, along that seam. Pure.
 */
import { carriesWords } from "../../../outbound/slack/carriesWords.js";
import { SLACK_TS } from "../../../outbound/slack/draftRegister.js";
import { whySaysThreadReply } from "../../../outbound/slack/draftThreadWhy.js";
import { machineIdsIn } from "../../../pages/machineIds.js";
import type { DraftRecordOptions } from "./draftCore.js";

/** A whole minted draft id, as `./draftRun.ts` mints one. */
const MINTED_DRAFT_ID = /^sd-[0-9a-f]{8}$/u;

/**
 * Every way a record's thread is wrong: a `--thread-ts` that is not a Slack `ts`, or a `--why` that says
 * thread reply with no `--thread-ts` at all.
 *
 * The second is the incident caught at its source: two rows whose why said THREAD REPLY were
 * parked top-level and released into their channels under their name. It is a caller refusal rather than a
 * hatch because it is always satisfiable — name the thread, or reword a why that is not about one.
 *
 * @returns one sentence per problem, empty when the thread is coherent
 */
export function threadProblems({ threadTs, why }: { threadTs: string | undefined; why: string | undefined }): string[] {
  if (threadTs !== undefined) {
    if (SLACK_TS.test(threadTs)) {
      return [];
    }
    return [
      `--thread-ts ${threadTs} is not a Slack ts (seconds.microseconds, e.g. 1790145643.664469) — take it ` +
        "from the thread root's permalink: p1790145643664469 is 1790145643.664469",
    ];
  }
  if (why !== undefined && whySaysThreadReply({ why })) {
    return [
      "slack draft record: --why says this is a THREAD reply, but no --thread-ts names the thread, so it " +
        "would park top-level and release into the channel. Pass --thread-ts <root ts>, or reword the why.",
    ];
  }
  return [];
}

/**
 * The flags whose words the Queue card prints, and the two it draws side by side in its `what`, in the card's order.
 * A hold checks the same flags, though it drops `--meaning-changed`: no flag the parser accepts carries an id.
 */
export const RECORD_CARD_PROSE = {
  drawnTogether: ["meaning-changed", "why"],
  flags: ["why", "meaning-changed"],
} as const;

/** A URL in prose, which the card gate skips: the card's own `URL_IN_PROSE`. */
const URL_IN_PROSE = /https?:\/\/\S+/g;

/**
 * Every raw machine id in a flag whose words the Queue card prints to them — `--why` and `--meaning-changed` on a
 * record, `--why` on a hold. The card's own gate (`site/lib/machineIdForm.ts`) refuses such a card, and a refused
 * card is withheld from their Queue, so the words are refused here instead, while the session still holds them. A `--why` that names its source call by id leaves the card opening blank in front of them.
 *
 * The card draws `--meaning-changed` and `--why` in one sentence run, joined by a space, so a flag ending "after the
 * call" before a `--why` opening on a bare hex id names `call <id>` though neither flag does alone.
 * `drawnTogether` names those flags in the card's order, and an id only their join forms is refused too.
 *
 * @param values the parsed string flags, keyed without their dashes
 * @param flags which of them the card prints, in the order the refusal names them
 * @param drawnTogether the flags the card draws adjacently, in its order — the join is checked beside each alone
 * @returns one sentence per id found, in flag order and then the join's, empty when every flag reads as prose
 */
export function machineIdProblems({
  values,
  flags,
  drawnTogether = [],
}: {
  values: Readonly<Record<string, string>>;
  flags: readonly string[];
  drawnTogether?: readonly string[];
}): string[] {
  const found = new Set<string>();
  const alone = flags.flatMap((flag) => {
    const text = values[flag];
    if (text === undefined) {
      return [];
    }
    const ids = idsOutsideUrls({ text });
    ids.forEach((id) => found.add(id));
    return ids.map(
      (id) => `--${flag} names "${id}" by its machine id, which the Queue card prints to them and refuses — ${NAME_IT}`,
    );
  });
  const present = drawnTogether.filter((flag) => values[flag] !== undefined);
  const joined = idsOutsideUrls({ text: present.map((flag) => values[flag]!.trim()).join(" ") });
  const across = joined.filter((id) => !found.has(id));
  const flagNames = present.map((flag) => `--${flag}`).join(" and ");
  return [
    ...alone,
    ...across.map(
      (id) => `${flagNames} together name "${id}" where the card joins them, and it refuses that — ${NAME_IT}`,
    ),
  ];
}

/** How every machine-id refusal ends: what to write instead. */
const NAME_IT = 'name it by what it was doing ("their call this morning", "the recut they asked for") and drop the id';

/**
 * Every machine id in prose outside a URL — the card draws a URL as a link and allows an id behind it
 * (`site/lib/machineIds.ts`), so this refuses no more.
 *
 * @param text the prose a card would print
 * @returns the ids, each once
 */
function idsOutsideUrls({ text }: { text: string }): readonly string[] {
  return machineIdsIn({ text: text.replace(URL_IN_PROSE, " ") });
}

/**
 * The rows `--supersedes` names, in the caller's order — `--media`'s own comma syntax, empty when the flag is absent.
 *
 * @param value the `--supersedes` value as typed, if any
 * @returns the draft ids as typed, blanks dropped
 */
export function supersededIdsOf({ value }: { value: string | undefined }): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Every way a `--supersedes` list is wrong: a flag naming no id at all, an entry that is not a draft id, or one
 * named twice. An empty value is refused rather than read as absent — `--supersedes "$OLD"` with `$OLD` unset
 * would otherwise park a second cut and leave the old one held.
 *
 * @param given whether the flag was passed at all, empty or not
 * @param supersedes the ids as parsed
 * @returns one sentence per problem, empty when the flag is absent or every entry is a distinct draft id
 */
export function supersedesProblems({ given, supersedes }: { given: boolean; supersedes: readonly string[] }): string[] {
  if (given && supersedes.length === 0) {
    return ["--supersedes names no draft id — pass the held row(s) this one re-cuts, or drop the flag"];
  }
  const problems = supersedes
    .filter((id) => !MINTED_DRAFT_ID.test(id))
    .map((id) => `--supersedes ${id} is not a draft id (sd- and eight hex digits, e.g. sd-1a2b3c4d)`);
  const repeated = new Set(supersedes.filter((id, index) => supersedes.indexOf(id) !== index));
  for (const id of repeated) {
    problems.push(`--supersedes names ${id} twice — name each held row once`);
  }
  return problems;
}

/**
 * Every way the approval flags are wrong: either one given blank, or both at once — a row cannot carry their yes and
 * declare that its words no longer have it.
 *
 * @param values the parsed string flags
 * @returns one sentence per problem, empty when the flags are coherent
 */
export function approvalProblems({ values }: { values: Readonly<Record<string, string>> }): string[] {
  const problems: string[] = [];
  const approved = values["approved"];
  const meaningChanged = values["meaning-changed"];
  // The register reads both by `carriesWords`, so a flag it would read as blank is refused here, not written.
  if (approved !== undefined && !carriesWords({ text: approved })) {
    problems.push("--approved names no anchor — pass the talk-call:, talk:, call: or transcript: anchor of their yes");
  }
  if (meaningChanged !== undefined && !carriesWords({ text: meaningChanged })) {
    problems.push("--meaning-changed says nothing — name what changed since they approved the row it re-cuts");
  }
  if (approved !== undefined && meaningChanged !== undefined) {
    problems.push(
      "--approved and --meaning-changed cannot both be given: one says they said yes, the other that it lapsed",
    );
  }
  return problems;
}

/**
 * The approval flags as record options, each only when given.
 *
 * @param values the parsed string flags, already checked by {@link approvalProblems}
 * @returns `approved` and `meaningChanged`, each present only when its flag was passed
 */
export function approvalOptionsOf({
  values,
}: {
  values: Readonly<Record<string, string>>;
}): Pick<DraftRecordOptions, "approved" | "meaningChanged"> {
  const approved = values["approved"];
  const meaningChanged = values["meaning-changed"];
  return {
    ...(approved === undefined ? {} : { approved: approved.trim() }),
    ...(meaningChanged === undefined ? {} : { meaningChanged: meaningChanged.trim() }),
  };
}

/**
 * Why a recording's three required flags refuse: each one absent or blank.
 *
 * @returns one reason per missing flag, empty when all three are given
 */
export function requiredRecordProblems({
  channel,
  formSource,
  why,
}: {
  channel: string | undefined;
  formSource: string | undefined;
  why: string | undefined;
}): string[] {
  const errors: string[] = [];
  if (channel === undefined || channel.trim() === "") {
    errors.push("slack draft record needs --channel <id>");
  }
  if (formSource === undefined || formSource.trim() === "") {
    errors.push("slack draft record needs --form <json|->: a parked draft is a typed form, never a raw body");
  }
  if (why === undefined || why.trim() === "") {
    errors.push(
      "slack draft record needs --why <text>: a row they cannot read without opening it is one they will not open",
    );
  }
  return errors;
}
