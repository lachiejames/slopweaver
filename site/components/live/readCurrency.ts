/**
 * The strict reader for the recorded `handover currency` reading, the tick's or the Queue opening's
 * (`src/handover/currency.ts`). A row any field
 * of which will not read drops the WHOLE document rather than the row: a card missing from a reading reads "not in
 * the last check", and a reader that quietly lost rows would print that over cards the check did read.
 */
import { type Bag, bags, isBag, str, strings, sub } from "../../lib/bag";
import {
  type CurrencyCardRow,
  type CurrencyDone,
  type CurrencyFact,
  type CurrencyPullRequest,
  type CurrencyReading,
  type CurrencySaid,
  type CurrencyWord,
  OWNER_RULING_DONE_KIND,
  type SaidCut,
} from "../../lib/cardCurrency";
import { CURRENCY_PROOF_KINDS } from "../../lib/prProof";
import { readStanding, readStandingSources, type Schema } from "./readCurrencyStanding";
import { type Reading, readingOf } from "./reading";

/** The word sources and filings the reading may carry. */
const SOURCES: readonly CurrencyWord["source"][] = ["chair", "voice", "relay"];
const FILINGS: readonly CurrencyWord["filed"][] = ["here", "unfiled"];
const CUTS: readonly SaidCut[] = ["none", "start", "end"];

/**
 * Whether a reply's link is a Slack message link — the one producer string a card's always-visible line prints,
 * as the way to open the owner's reply, so anything else is a defect in the reading rather than a line to show the owner.
 *
 * The grammar is matched over the string's own bytes rather than a parsed URL, so nothing a parser would decode or
 * set aside — a userinfo, a port, a fragment, a percent-encoding — can ride along in the string the line prints.
 *
 * @param url the reading's permalink
 * @returns true for an https message link on a Slack workspace host, carrying at most Slack's own thread keys
 */
function isSlackPermalink({ url }: { url: string }): boolean {
  return SLACK_PERMALINK.test(url);
}

/** A Slack message link, optionally threaded: the whole string, byte for byte. */
const SLACK_PERMALINK =
  /^https:\/\/(?:[a-z0-9-]+\.)+slack\.com\/archives\/[A-Z0-9]+\/p\d+(?:\?thread_ts=\d+\.\d+(?:&cid=[A-Z0-9]+)?)?$/u;

/**
 * One done-check.
 *
 * @param bag the `done` object
 * @returns the check, or `undefined` when it will not read
 */
function readDone({ bag }: { bag: Bag }): CurrencyDone | undefined {
  const kind = str({ bag, key: "kind" });
  if (kind === OWNER_RULING_DONE_KIND) {
    return { kind };
  }
  if (kind === "replied") {
    const atIso = str({ bag, key: "atIso" });
    const permalink = str({ bag, key: "permalink" });
    if (atIso === undefined || permalink === undefined || !isSlackPermalink({ url: permalink })) {
      return undefined;
    }
    return { atIso, kind, permalink };
  }
  if (kind === "not-yet") {
    const readAtIso = str({ bag, key: "readAtIso" });
    return readAtIso === undefined ? undefined : { kind, readAtIso };
  }
  if (kind === "could-not-check") {
    const why = str({ bag, key: "why" });
    return why === undefined ? undefined : { kind, why };
  }
  if (kind === "declared-not-run") {
    const checks = strings({ bag, key: "checks" });
    return checks === undefined ? undefined : { checks, kind };
  }
  return undefined;
}

/**
 * One word the owner said since.
 *
 * @param bag the word object
 * @returns the word, or `undefined`
 */
function readWord({ bag }: { bag: Bag }): CurrencyWord | undefined {
  const atIso = str({ bag, key: "atIso" });
  const pointer = str({ bag, key: "pointer" });
  const source = SOURCES.find((each) => each === str({ bag, key: "source" }));
  const filed = FILINGS.find((each) => each === str({ bag, key: "filed" }));
  if (atIso === undefined || pointer === undefined || source === undefined || filed === undefined) {
    return undefined;
  }
  return { atIso, filed, pointer, source };
}

/**
 * The ruling the owner gave on a question before it was asked again in the same words (`src/handover/currency.ts`).
 *
 * @param bag the `sameQuestionRuling` object
 * @returns the ruling's instant and pointer, or `undefined` when either will not read
 */
function readSameQuestionRuling({ bag }: { bag: Bag }): NonNullable<CurrencyCardRow["sameQuestionRuling"]> | undefined {
  const atIso = str({ bag, key: "atIso" });
  const pointer = str({ bag, key: "pointer" });
  if (atIso === undefined || Number.isNaN(Date.parse(atIso)) || pointer === undefined || pointer === "") {
    return undefined;
  }
  return { atIso, pointer };
}

/**
 * One card's row.
 *
 * @param bag the row object
 * @returns the row, or `undefined`
 */
function readRow({ bag, schema }: { bag: Bag; schema: Schema }): CurrencyCardRow | undefined {
  const key = str({ bag, key: "key" });
  const sinceBag = sub({ bag, key: "since" });
  const floorIso = optionalStr({ bag, key: "floorIso" });
  const askedIso = optionalStr({ bag, key: "askedIso" });
  const done = readOptional({ bag, key: "done", read: readDone });
  const fact = readOptional({ bag, key: "fact", read: readFact });
  const ruled = readOptional({ bag, key: "sameQuestionRuling", read: readSameQuestionRuling });
  if (
    key === undefined ||
    sinceBag === undefined ||
    floorIso === "invalid" ||
    askedIso === "invalid" ||
    done === "invalid" ||
    fact === "invalid" ||
    ruled === "invalid"
  ) {
    return undefined;
  }
  // An older reading is ask-only: every row carries its done-check and none a fact. A schema-2 row always says its fact.
  if (schema === "legacy" ? done === undefined || fact !== undefined : fact === undefined) {
    return undefined;
  }
  const gaps = strings({ bag: sinceBag, key: "gaps" });
  const wordBags = bags({ bag: sinceBag, key: "words" });
  if (gaps === undefined || wordBags === undefined) {
    return undefined;
  }
  const words = wordBags.map((each) => readWord({ bag: each }));
  const standing = readStanding({ schema, sinceBag });
  if (words.some((word) => word === undefined) || standing === undefined) {
    return undefined;
  }
  return {
    ...(askedIso === undefined ? {} : { askedIso }),
    ...(done === undefined ? {} : { done }),
    ...(fact === undefined ? {} : { fact }),
    ...(ruled === undefined || schema !== 3 ? {} : { sameQuestionRuling: ruled }),
    floorIso,
    key,
    since: {
      gaps,
      ...(standing === "absent" ? {} : { standing }),
      words: words.filter((word) => word !== undefined),
    },
  };
}

/**
 * A string field that may be absent: present and not a string is a defect, never an absent field.
 *
 * @param bag the object
 * @param key the field
 * @returns the string, `undefined` when absent, or `"invalid"`
 */
function optionalStr({ bag, key }: { bag: Bag; key: string }): string | undefined | "invalid" {
  if (bag[key] === undefined) {
    return undefined;
  }
  const value = str({ bag, key });
  if (value === undefined) {
    return "invalid";
  }
  return value;
}

/**
 * An object field that may be absent, read by its own reader: present and unreadable is a defect.
 *
 * @param bag the object
 * @param key the field
 * @param read the field's reader
 * @returns the value, `undefined` when absent, or `"invalid"`
 */
function readOptional<T>({
  bag,
  key,
  read,
}: {
  bag: Bag;
  key: string;
  read: (args: { bag: Bag }) => T | undefined;
}): T | undefined | "invalid" {
  if (bag[key] === undefined) {
    return undefined;
  }
  const inner = sub({ bag, key });
  const value = inner === undefined ? undefined : read({ bag: inner });
  if (value === undefined) {
    return "invalid";
  }
  return value;
}

/**
 * One card's fact verdict.
 *
 * @param bag the `fact` object
 * @returns the verdict, or `undefined` when it will not read
 */
function readFact({ bag }: { bag: Bag }): CurrencyFact | undefined {
  const kind = str({ bag, key: "kind" });
  if (kind === "confirmed") {
    const atIso = str({ bag, key: "atIso" });
    const by = str({ bag, key: "by" });
    if (atIso === undefined || by === undefined || Number.isNaN(Date.parse(atIso))) {
      return undefined;
    }
    return { atIso, by, kind };
  }
  if (kind === "not-confirmed") {
    const why = str({ bag, key: "why" });
    const unread = optionalStr({ bag, key: "unread" });
    if (why === undefined || unread === "invalid") {
      return undefined;
    }
    return unread === undefined ? { kind, why } : { kind, unread, why };
  }
  return undefined;
}

/**
 * The owner's words by pointer. Absent on a reading recorded before the tick carried them, which reads as no words — every
 * row then says where it was said without quoting it. Present and malformed is a defect, and drops the document.
 *
 * @param document the reading's document
 * @returns the words, `undefined` when absent, or `"invalid"`
 */
function readSaid({ document }: { document: Bag }): Readonly<Record<string, CurrencySaid>> | undefined | "invalid" {
  if (document["said"] === undefined) {
    return undefined;
  }
  const bag = sub({ bag: document, key: "said" });
  if (bag === undefined) {
    return "invalid";
  }
  const said: Record<string, CurrencySaid> = {};
  for (const [pointer, value] of Object.entries(bag)) {
    if (!isBag(value)) {
      return "invalid";
    }
    const text = str({ bag: value, key: "text" });
    const cut = CUTS.find((each) => each === str({ bag: value, key: "cut" }));
    if (text === undefined || text.length === 0 || cut === undefined) {
      return "invalid";
    }
    said[pointer] = { cut, text };
  }
  return said;
}

/**
 * One pull request's proof verdict.
 *
 * @param bag the pull request object
 * @returns the verdict, or `undefined` when it will not read
 */
function readPullRequest({ bag }: { bag: Bag }): CurrencyPullRequest | undefined {
  const identity = str({ bag, key: "identity" });
  const rowSlugs = strings({ bag, key: "rowSlugs" });
  const proof = sub({ bag, key: "proof" });
  if (identity === undefined || rowSlugs === undefined || proof === undefined) {
    return undefined;
  }
  const kind = str({ bag: proof, key: "kind" });
  if (kind === "requested-and-met") {
    return { identity, proof: { kind }, rowSlugs };
  }
  if (kind === "requested-and-unmet") {
    const gap = str({ bag: proof, key: "gap" });
    const named = strings({ bag: proof, key: "missing" });
    if (gap === undefined || gap.length === 0 || named === undefined) {
      return undefined;
    }
    const missing = named.map((each) => CURRENCY_PROOF_KINDS.find((one) => one === each));
    if (missing.length === 0 || missing.some((each) => each === undefined)) {
      return undefined;
    }
    return { identity, proof: { gap, kind, missing: missing.filter((each) => each !== undefined) }, rowSlugs };
  }
  if (kind === "body-unread") {
    const why = str({ bag: proof, key: "why" });
    return why === undefined ? undefined : { identity, proof: { kind, why }, rowSlugs };
  }
  return undefined;
}

/**
 * The pull requests the owner asked for proof on. Absent on a reading recorded before the tick read their bodies, which reads
 * as no verdict on any card. Present and malformed drops the document: a verdict quietly lost reads as a card whose
 * proof is not missing.
 *
 * @param document the reading's document
 * @returns the verdicts, `undefined` when absent, or `"invalid"`
 */
function readPullRequests({ document }: { document: Bag }): readonly CurrencyPullRequest[] | undefined | "invalid" {
  if (document["pullRequests"] === undefined) {
    return undefined;
  }
  const prBags = bags({ bag: document, key: "pullRequests" });
  if (prBags === undefined) {
    return "invalid";
  }
  const read = prBags.map((each) => readPullRequest({ bag: each }));
  if (read.some((each) => each === undefined)) {
    return "invalid";
  }
  return read.filter((each) => each !== undefined);
}

/**
 * The whole document, or `undefined` when any part of it will not read.
 *
 * @param document what the reading carries
 * @returns the reading's value
 */
export function readCurrency(document: unknown): CurrencyReading | undefined {
  if (!isBag(document)) {
    return undefined;
  }
  const schema = schemaOf({ document });
  if (schema === undefined) {
    return undefined;
  }
  const checkedIso = str({ bag: document, key: "checkedIso" });
  const readFromIso = str({ bag: document, key: "readFromIso" });
  const sources = sub({ bag: document, key: "sources" });
  const rowBags = bags({ bag: document, key: "rows" });
  if (checkedIso === undefined || readFromIso === undefined || sources === undefined || rowBags === undefined) {
    return undefined;
  }
  const chair = str({ bag: sources, key: "chair" });
  const relays = str({ bag: sources, key: "relays" });
  const voice = str({ bag: sources, key: "voice" });
  const standing = readStandingSources({ schema, sources });
  const rows = rowBags.map((each) => readRow({ bag: each, schema }));
  const said = readSaid({ document });
  const pullRequests = readPullRequests({ document });
  if (
    chair === undefined ||
    relays === undefined ||
    voice === undefined ||
    standing === "invalid" ||
    rows.some((row) => row === undefined) ||
    said === "invalid" ||
    pullRequests === "invalid"
  ) {
    return undefined;
  }
  return {
    checkedIso,
    ...(schema === "legacy" ? {} : { schemaVersion: schema }),
    ...(pullRequests === undefined ? {} : { pullRequests }),
    readFromIso,
    rows: rows.filter((row) => row !== undefined),
    ...(said === undefined ? {} : { said }),
    sources: { chair, relays, voice, ...(standing === "absent" ? {} : { standing }) },
  };
}

/**
 * Which shape the document is: no version is the older, ask-only reading, 2 a row per card kind, 3 one that also read
 * the owner's standing guidance. Any other version is not one this reads.
 *
 * @param document the reading's document
 * @returns the shape, or `undefined` for a version this does not read
 */
function schemaOf({ document }: { document: Bag }): Schema | undefined {
  const version = document["schemaVersion"];
  if (version === undefined) {
    return "legacy";
  }
  if (version === 2 || version === 3) {
    return version;
  }
  return undefined;
}

/**
 * The last recorded reading of `handover currency`.
 *
 * @returns the reading, or `undefined`
 */
export function readCurrencyReading(payload: unknown): Reading<CurrencyReading> | undefined {
  return readingOf({ payload, read: readCurrency });
}
