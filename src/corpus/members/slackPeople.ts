/**
 * The Slack name roster — who a `U…` id is, for a surface that would otherwise print the id.
 *
 * A parked draft reading `you (U0SYN000001)` and `@U0SYN000003` leaves the reader unsure what a user ID resolves
 * to. Member bronze has held every Slack member's name since the first
 * hydrate; this is the projection that hands a caller the name for the ids it is about to draw. Pure: rows in,
 * entries out. Unlike `./avatars.ts` it keeps a member with no picture, because a name needs no picture.
 */

import { isRecord } from "#lib/parsers.js";

import { trustedJoinEmail } from "./email.js";
import { type OrgFacts, orgFactsFor } from "./orgChart.js";
import { EMPTY_ORG_CHART, type OrgChart } from "./orgChartIndex.js";
import type { MemberBronzeRow } from "./types.js";

/** One Slack member, as a surface names them. */
export interface SlackPerson {
  /** The Slack user id — `U…` or `W…` — which is what a draft or a message carries. */
  readonly nativeId: string;
  /** The display name member bronze holds, when the platform gave one. */
  readonly name: string | undefined;
  readonly handle: string | undefined;
  readonly bot: boolean;
  /**
   * Whether Slack says they have left — the profile's `active` is `false`. A surface draws them the way Slack does,
   * greyed with "(deactivated)" on hover, rather than as a colleague who can still answer.
   */
  readonly deactivated: boolean;
  /**
   * The 72px picture Slack draws beside their messages and in a DM header (profile pictures make a
   * surface easier to react to and more platform native). Absent when member
   * bronze holds none, and the surface then draws initials rather than a borrowed face.
   */
  readonly avatarUrl: string | undefined;
  /**
   * Their role as their own Slack profile states it — the hover card's position line (the card shows
   * a profile picture, a name and a position at the company). Absent when the profile says nothing.
   */
  readonly title: string | undefined;
  /**
   * Whether no other current human Slack member's names hold their first name as any word, so a board row naming
   * only "Rosa" can be read as naming them. Two Kyles, or a Kyle and a Mr Kyle, and it is evidence of neither.
   */
  readonly firstNameUnique: boolean;
  /**
   * Whether no other current human Slack member goes by their display name or a name starting with it, so a row
   * naming it whole can be read as naming them.
   */
  readonly nameUnique: boolean;
  /**
   * Where they sit in the organisation — title, team, org unit and Vanta groups — joined off the Google directory
   * and the Vanta atlas by their trusted email (`./orgChart.ts`). Absent when their address is not trusted or
   * neither store holds it.
   */
  readonly org: OrgFacts | undefined;
}

/**
 * The first word of a display name, lowercased — what a relayed row calls somebody. `undefined` for no name.
 *
 * @returns the first name, or nothing
 */
function firstNameOf({ name }: { name: string | undefined }): string | undefined {
  const first = name?.trim().split(/\s+/u)[0];
  if (first === undefined || first.length === 0) {
    return undefined;
  }
  return first.toLowerCase();
}

/**
 * Slack's own system members, `USLACKBOT` (Slackbot) and `USLACK` (Slack). Slack reports each `is_bot: false`, so
 * the bot flag alone keeps them people. `grep -c '"sourceId":"USLACK' $SLOPWEAVER_HOME/corpus/members/slack.jsonl`.
 */
const SLACK_SYSTEM_IDS: ReadonlySet<string> = new Set(["USLACKBOT", "USLACK"]);

/** Whether a member is a person still in the workspace — the ones a first name could mean. */
function isCurrentHuman({ row }: { row: MemberBronzeRow }): boolean {
  const system = SLACK_SYSTEM_IDS.has(row.identity.nativeId);
  return row.profile.bot !== true && row.profile.active !== false && !system;
}

/**
 * Where a member sits in the org chart. A bot or Slack's own system member is nobody's employee, so it joins
 * nothing even when its address is one a person holds.
 *
 * @returns their facts, or nothing
 */
function orgOf({ row, orgChart }: { row: MemberBronzeRow; orgChart: OrgChart }): OrgFacts | undefined {
  if (row.profile.bot === true || SLACK_SYSTEM_IDS.has(row.identity.nativeId)) {
    return undefined;
  }
  return orgFactsFor({ active: row.profile.active !== false, chart: orgChart, email: trustedJoinEmail({ row }) });
}

/** A profile title with its whitespace trimmed, or nothing for a blank one — Slack stores `""` for "not set". */
function titleOf({ row }: { row: MemberBronzeRow }): string | undefined {
  const title = row.profile.title?.trim();
  if (title === undefined || title.length === 0) {
    return undefined;
  }
  return title;
}

/**
 * The Slack picture one row carries, at the size Slack draws beside a message: the projected 72px field, else the
 * larger `avatarUrl` every row since the projection began has kept — the same face, scaled down by the browser.
 *
 * Never the raw `users.list` member's own `image_72`. Member bronze passes `raw` through the long-digit-run pass
 * (`./redact.ts`), and a Slack avatar's path carries a thirteen-digit file id, so every stored raw URL reads
 * `…/<date>/[number]_6a43…_72.jpg` and draws nothing. MEASURED on this install:
 * `grep '"sourceId":"U0SYN000006"' $SLOPWEAVER_HOME/corpus/members/slack.jsonl | tail -1 | jq .raw.profile.image_72`.
 * The projected `profile` fields are not passed through it, which is why they hold the whole address.
 *
 * @param row one Slack member row
 * @returns the URL, or `undefined` when the row holds no picture
 */
function slackAvatar72({ row }: { row: MemberBronzeRow }): string | undefined {
  if (row.profile.avatar72Url !== undefined) {
    return row.profile.avatar72Url;
  }
  return row.profile.avatarUrl;
}

/**
 * Every Slack member's current row, by id — the one appended last (see {@link slackPeopleFor}).
 *
 * @returns the rows, by member id
 */
function latestSlackRows({ rows }: { rows: readonly MemberBronzeRow[] }): ReadonlyMap<string, MemberBronzeRow> {
  const latest = new Map<string, MemberBronzeRow>();
  for (const row of rows) {
    if (row.source !== "slack") {
      continue;
    }
    // A row whose key and identity disagree is not evidence of the id's name — and, read last, it is still
    // the member's current row, so it withdraws the name an older row gave rather than leaving it standing.
    if (row.sourceId !== row.identity.nativeId) {
      latest.delete(row.sourceId);
      continue;
    }
    latest.set(row.identity.nativeId, row);
  }
  return latest;
}

/**
 * A Slack member id. Member bronze also holds rows keyed by a display name (`"Quinn"`, `"Rosa Lindqvist"`), each a
 * second copy of somebody a real id already names — counted, they made every one of those first names look shared.
 * MEASURED: 32 such keys on this install, `jq -r 'select(.sourceId | test("^[UW][A-Z0-9]+$") | not) |
 * .sourceId' $SLOPWEAVER_HOME/corpus/members/slack.jsonl | sort -u | wc -l`.
 */
const MEMBER_ID = /^[UW][A-Z0-9]+$/u;

/** Where the raw `users.list` member holds a name somebody could be called by, beside the display name. */
const RAW_NAME_PATHS: readonly (readonly string[])[] = [
  ["real_name"],
  ["first_name"],
  ["display_name"],
  ["profile", "real_name"],
  ["profile", "first_name"],
  ["profile", "display_name"],
];

/**
 * A string the raw member carries at `path`, trimmed and lowercased, when it is a non-empty one.
 *
 * @returns the text, or nothing
 */
function rawName({ raw, path }: { raw: unknown; path: readonly string[] }): string | undefined {
  let value = raw;
  for (const key of path) {
    if (!isRecord(value)) {
      return undefined;
    }
    value = value[key];
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim().toLowerCase();
}

/**
 * Every name a member goes by, lowercased: the display name member bronze keeps, and the real, first and display
 * names the raw member holds. A display name is often a handle (`nickmazitelli`), so it alone hid the first name a
 * row would use. MEASURED: 524 member ids on this install have a row whose display name opens on another
 * word than its real name, `jq -r 'select((.identity.name // "" | ascii_downcase | split(" ")[0]) != (.raw.real_name
 * // "" | ascii_downcase | split(" ")[0])) | .sourceId' $SLOPWEAVER_HOME/corpus/members/slack.jsonl | sort -u | wc -l`.
 *
 * @returns the names, once each
 */
function namesOf({ row }: { row: MemberBronzeRow }): readonly string[] {
  const names = new Set<string>();
  const display = row.identity.name?.trim().toLowerCase();
  if (display !== undefined && display.length > 0) {
    names.add(display);
  }
  for (const path of RAW_NAME_PATHS) {
    const name = rawName({ path, raw: row.raw });
    if (name !== undefined) {
      names.add(name);
    }
  }
  return [...names];
}

/**
 * Every name each current person in the workspace goes by — members counted by their Slack id only.
 *
 * @returns the names, by member id
 */
function currentNames({
  latest,
}: {
  latest: ReadonlyMap<string, MemberBronzeRow>;
}): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const [id, row] of latest) {
    if (MEMBER_ID.test(id) && isCurrentHuman({ row })) {
      out.set(id, namesOf({ row }));
    }
  }
  return out;
}

/**
 * How many current people each word of a name could mean — a person counted once per word any of their names
 * holds, anywhere in it. A first name that is somebody else's surname is shared: "Lucas" alone is as much Chris Lucas
 * as Lucas Salim.
 *
 * @returns the count, by lowercased word
 */
function nameWordCounts({ names }: { names: ReadonlyMap<string, readonly string[]> }): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const own of names.values()) {
    const words = new Set(own.flatMap((name) => name.split(/\s+/u)).filter((word) => word.length > 0));
    for (const word of words) {
      const seen = counts.get(word);
      counts.set(word, seen === undefined ? 1 : seen + 1);
    }
  }
  return counts;
}

/**
 * Whether `their` is `own` with a bracketed qualifier after it — `<name> (<qualifier>)` beside `<name>`. Slack's
 * convention for a person's second account in another workspace: prose naming the bare name names the account that
 * goes by it, and prose naming the qualified one names that one whole.
 *
 * @returns true for exactly `<own> (<qualifier>)`
 */
function isQualifiedCopy({ their, own }: { their: string; own: string }): boolean {
  if (!their.startsWith(`${own} (`) || !their.endsWith(")")) {
    return false;
  }
  const qualifier = their.slice(own.length + 2, -1);
  return qualifier.length > 0 && !/[()]/u.test(qualifier);
}

/**
 * Whether no other current person goes by `name` or by a name that starts with it — "Joseph O" is the start of
 * "Joseph O'Hara", so a row naming either is evidence of neither. A qualified second account ({@link isQualifiedCopy})
 * is the one exception. MEASURED: "Seth Tanner (<qualifier>)" (`U0SYN000024`, another workspace, seen only on
 * a message) left the Seth Tanner the whole org tags unchipped on every card, `jq -c 'select(.identity.name // "" |
 * startswith("Seth Tanner")) | [.sourceId, .identity.name]' $SLOPWEAVER_HOME/corpus/members/slack.jsonl | sort -u`.
 *
 * @returns true when `name` is theirs alone
 */
function nameIsTheirsAlone({
  id,
  name,
  names,
}: {
  id: string;
  name: string | undefined;
  names: ReadonlyMap<string, readonly string[]>;
}): boolean {
  const own = name?.trim().toLowerCase();
  if (own === undefined || own.length === 0 || !names.has(id)) {
    return false;
  }
  for (const [other, theirs] of names) {
    if (other !== id && theirs.some((their) => their.startsWith(own) && !isQualifiedCopy({ own, their }))) {
      return false;
    }
  }
  return true;
}

/**
 * The Slack members among `ids`, one entry each, in the order `ids` names them.
 *
 * Member bronze is append-only and deduplicated on content (`./store.ts`), so one member is many rows and the
 * one APPENDED LAST is their current state — the name Slack shows today. Read order decides it, not
 * `fetchedAtIso`: the bronze reader accepts any string there, and ordering by a parsed stamp only adds ways to
 * pick an older row. MEASURED: 5,835 Slack rows, every stamp canonical and none appended out of
 * order, so the two orders agree on this store (`node -e` over `$SLOPWEAVER_HOME/corpus/members/slack.jsonl`,
 * comparing each id's successive `fetchedAtIso`). Only `slack` rows are read — a Linear or Notion id that
 * happened to collide must never lend a Slack id its name. An id no row carries is left out rather than given a
 * placeholder: the caller draws the bare id, because an invented name on a draft the owner presses is the one thing
 * this must never do.
 *
 * @param rows the member bronze rows, any source, in the order they were read
 * @param ids the Slack user ids a caller is about to draw
 * @param orgChart the directory and Vanta stores each member's org facts are joined from
 * @returns the members found, in `ids` order
 */
export function slackPeopleFor({
  rows,
  ids,
  orgChart,
}: {
  rows: readonly MemberBronzeRow[];
  ids: readonly string[];
  orgChart: OrgChart;
}): readonly SlackPerson[] {
  const wanted = new Set(ids);
  if (wanted.size === 0) {
    return [];
  }
  // Every member's current row, not only the wanted ones: whether a first name is unique is a fact about the
  // whole workspace, which a roster narrowed to one card's ids cannot judge.
  const latest = latestSlackRows({ rows });
  const names = currentNames({ latest });
  const nameWords = nameWordCounts({ names });
  const out: SlackPerson[] = [];
  for (const id of wanted) {
    const row = latest.get(id);
    if (row === undefined) {
      continue;
    }
    const first = firstNameOf({ name: row.identity.name });
    out.push({
      avatarUrl: slackAvatar72({ row }),
      bot: row.profile.bot === true,
      deactivated: row.profile.active === false,
      firstNameUnique: first !== undefined && isCurrentHuman({ row }) && nameWords.get(first) === 1,
      handle: row.identity.handle,
      name: row.identity.name,
      nameUnique: nameIsTheirsAlone({ id, name: row.identity.name, names }),
      nativeId: row.identity.nativeId,
      org: orgOf({ orgChart, row }),
      title: titleOf({ row }),
    });
  }
  return out;
}

/**
 * Every Slack member in the workspace, one entry each, keyed only by a real member id — the roster a check judging
 * prose against every colleague reads. A row keyed by a display name is a second copy of somebody an id already
 * names ({@link MEMBER_ID}), so it is left out rather than counted as a second person going by that name.
 *
 * @param rows the member bronze rows, any source, in the order they were read
 * @returns every Slack member, without org facts
 */
export function slackRoster({ rows }: { rows: readonly MemberBronzeRow[] }): readonly SlackPerson[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.source === "slack" && MEMBER_ID.test(row.sourceId)) {
      ids.add(row.sourceId);
    }
  }
  return slackPeopleFor({ ids: [...ids], orgChart: EMPTY_ORG_CHART, rows });
}
