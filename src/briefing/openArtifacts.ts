/**
 * THE RANKED OPEN-ARTIFACT INDEX — every page a session has left open on the owner, ordered, and each one
 * marked with whether the owner's own later steer has already taken it out.
 *
 * ## The purpose
 *
 * With many artifacts open in different tabs, the owner cannot tell which to react to first, because some of
 * their earlier steering invalidated some of them. The react-now section of the fleet briefing points to every
 * open artifact with a link to each, so the owner never has to guess where to look next.
 *
 * ## The mark is DERIVED, and that is the whole mechanism
 *
 * A validity mark a composer types is one that can read `valid` on a page the owner's own steer already
 * settled — the same class as a composer-written freshness claim, which `../outbound/briefing/stamp.ts` exists
 * to stop. So every mark here comes out of the LOCK-IN LEDGER (`../sessionStart/lockIn.ts`), which is where a
 * ruling the owner gave already lands, keyed by identity or by the anchor URL a supervisor was holding.
 * Nothing in this file guesses, and nothing reads a page's content to infer what happened to it.
 *
 * ## Why the lock-in ledger and not a new register
 *
 * Because `../sessionStart/standing.ts` already calls a held lock-in row a RULING and already answers the
 * hard half — when a ruling stops applying. {@link ../sessionStart/lockIn.resolutionHolds} lapses a
 * resolution the moment the thing it was given against moves, which is exactly the right semantics here: a
 * steer given against version one of a page does not govern the version a session republished afterwards.
 * A second register would have to re-derive that, and would disagree with the owner's own list about what
 * they had already answered.
 *
 * Pure — no I/O, no clock. The caller reads the ledger and supplies `nowIso`.
 */

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import type { BriefingArtifactValidity, BriefingOpenArtifact } from "../outbound/briefing/types.js";
import { isLocalPageUrl, localPageSlug, pageIdentity } from "../pages/url.js";
import type { LockInState } from "../sessionStart/lockIn.js";
import { foldLockInLedger, parseLockInRows, resolutionHolds } from "../sessionStart/lockIn.js";
import { anchorsIn } from "../sessionStart/standing.js";
import { type BriefingError, BriefingErrors, briefingErrorLines } from "./errors.js";
import { isMarkdownSubjectUrl } from "./markdownSubject.js";

/**
 * One open page, before it is ranked or marked — what a sweep can see about it without judging it.
 *
 * `updatedIso` is what a ruling LAPSES against, and it is deliberately separate from `landedIso`. A page
 * first opened and later republished landed at the first instant for the purpose of ordering the owner's tabs,
 * and moved at the second for the purpose of deciding whether a steer given between the two still governs it.
 * Collapsing them would either lose the ordering or hold a ruling over a page that has since been rewritten.
 */
export interface OpenArtifactReading {
  /** The page's own name, as the owner would recognise it. */
  readonly label: string;
  readonly url: string;
  /** One sentence: what the session that opened it wants from the owner. */
  readonly ask: string;
  /** When it first landed in front of the owner. */
  readonly landedIso: string;
  /** When it last moved. Defaults to `landedIso` for a page nobody has republished. */
  readonly updatedIso?: string | undefined;
}

/** Every outcome that ends a page rather than merely commenting on it. */
const CLOSING_OUTCOMES: ReadonlySet<string> = new Set(["dropped", "rejected"]);

/**
 * The page a closing ruling pointed at, when its note named one.
 *
 * Supersession is READ off the ruling, never inferred from two pages being about similar things. A note
 * naming another artifact URL is the owner saying where the live version went; a note naming none is the owner
 * settling part of this page, which is a different mark. Similarity may nominate, it may never conclude — the
 * same ruling `../judgement/ownerDirective.ts` records about correction matching, binding here for the reason
 * it gives there: a mark that fired on a topic match would put words in the owner's mouth about a page they
 * never saw.
 *
 * The anchor must be an ADDRESS rather than any anchor at all, because `../sessionStart/standing.ts` also
 * extracts `owner/repo#number` references and a pull request is not where the live version of a page went.
 * Local pages count as addresses for the same reason they count everywhere else: a page is a file, so a
 * note saying the live version moved to one names a `file://` address, and a
 * test for `http` alone would drop every supersession the fleet can actually record.
 *
 * @param state the held resolution
 * @param selfUrl the artifact the ruling was recorded against, which never supersedes itself
 * @returns the superseding page's address, or undefined when the ruling named none
 */
function supersededByUrl({ state, selfUrl }: { state: LockInState; selfUrl: string }): string | undefined {
  const note = state.note;
  if (note === undefined) {
    return undefined;
  }
  return anchorsIn({ text: note }).find(
    (anchor) => anchor !== selfUrl && (anchor.startsWith("http") || isLocalPageUrl({ url: anchor })),
  );
}

/** An artifact page's own id inside a `claude.ai/code/artifact/<id>` address. */
const ARTIFACT_URL = /\/artifact\/(?<id>[0-9a-f-]{8,36})/;

/** How many characters of a UUID the short form keeps — the same eight this repo prints a session ref as. */
const SHORT_ID_LENGTH = 8;

/**
 * Every key the ledger might have recorded a ruling about this page under, in the order they are tried.
 *
 * MEASURED against the operator's real ledger (reproduce with
 * `grep artifact: ~/.slopweaver/ledgers/session-start/lock-in.jsonl`): of 102 rows standing, the rows about
 * artifact pages were
 * keyed by the page's full UUID (`artifact:<uuid>`) and by its eight-character short form (`artifact:<8 hex>`),
 * never as the page's URL. A lookup on the URL alone found NEITHER, so every page would
 * have rendered `still valid` while a ruling about it sat in the file. That is the exact failure this whole
 * index exists to close, and it is invisible until the real ledger is read.
 *
 * All three are EXACT key lookups, never a prefix scan or a similarity test. The short form is the eight
 * leading characters this repo already prints a session ref as, so it is a convention the ledger observably
 * uses rather than a guess about what a recorder might have meant.
 *
 * ## A LOCAL page is the same mechanism on a different address
 *
 * Every page is a local file, and the regex below matches only `/artifact/<id>`, so a page at a
 * `file://` address would fall through to the bare URL, match nothing in the ledger, and
 * {@link artifactValidity} would answer `valid`. A page the owner's own steer had already settled would
 * read as still open — the exact failure this index exists to close.
 *
 * So a local page tries its URL and then `page:<slug>` (`../pages/url.ts`). There is deliberately no short
 * form beside it: the eight-character artifact alias exists because a UUID is unreadable and the real ledger
 * was MEASURED carrying both spellings, and neither is true of a slug, which is already the readable name.
 * Inventing one would be the guess this function's own header refuses to make.
 *
 * Exported because `./openPageDrop.ts` asks the same ledger whether a page is settled, and a second key list
 * would be the copy that drifts.
 *
 * @param url the page's address
 * @returns the keys to try, most specific first
 */
export function ledgerKeys({ url }: { url: string }): readonly string[] {
  const slug = localPageSlug({ url });
  if (slug !== undefined) {
    return [url, pageIdentity({ slug })];
  }
  const id = ARTIFACT_URL.exec(url)?.groups?.["id"];
  if (id === undefined) {
    return [url];
  }
  return [url, `artifact:${id}`, `artifact:${id.slice(0, SHORT_ID_LENGTH)}`];
}

/**
 * The ledger's word about one page, looked up under every key a recorder uses for it.
 *
 * Three keys rather than one, and {@link ledgerKeys} carries the measurement that made it three. The shape
 * is `../sessionStart/lockIn.resolutionFor`'s — try the identity, then the anchor — widened by what the real
 * file turned out to hold.
 *
 * @param states the folded lock-in ledger
 * @param url the page's address
 * @returns the most recent resolution naming it under any of its keys, or undefined
 */
function rulingFor({
  states,
  url,
}: {
  states: ReadonlyMap<string, LockInState>;
  url: string;
}): LockInState | undefined {
  for (const key of ledgerKeys({ url })) {
    const state = states.get(key);
    if (state !== undefined) {
      return state;
    }
  }
  return undefined;
}

/**
 * The name a superseding page goes by, falling back to its address.
 *
 * A URL is a checkable fact and a label is a courtesy, so the fallback is the URL rather than an invented
 * name: a supersession that could not find its replacement among the open pages still says exactly where to
 * go, which is the half the owner needs.
 *
 * @param readings every open page this sweep found
 * @param url the superseding page's address
 * @returns its label when the sweep saw it, otherwise the address itself
 */
function labelFor({ readings, url }: { readings: readonly OpenArtifactReading[]; url: string }): string {
  const sibling = readings.find((reading) => reading.url === url);
  if (sibling === undefined) {
    return url;
  }
  return sibling.label;
}

/**
 * When one page last moved. A page nobody has republished carries no `updatedIso`, and the last time it
 * moved is the time it landed.
 */
function lastMovedIso({ reading }: { reading: OpenArtifactReading }): string {
  const { updatedIso } = reading;
  if (updatedIso === undefined) {
    return reading.landedIso;
  }
  return updatedIso;
}

/**
 * Whether the owner's own steer has taken one page out, and if so how.
 *
 * A ruling that no longer HOLDS produces `valid` rather than a stale mark, which is the behaviour that makes
 * the index trustworthy through a republish: a session that rewrites its page in response to the owner's steer gets
 * its page back, with the mark cleared, without anyone having to remember to clear it.
 *
 * @param reading the page, as a sweep saw it
 * @param siblings every open page this sweep found, read only to name a superseding page
 * @param states the folded lock-in ledger
 * @param nowIso the run's own instant, which is what expires a `defer`
 * @returns the mark, derived
 */
export function artifactValidity({
  reading,
  siblings,
  states,
  nowIso,
}: {
  reading: OpenArtifactReading;
  /** Every other open page this sweep found, so a supersession can name the replacement rather than its URL. */
  siblings: readonly OpenArtifactReading[];
  states: ReadonlyMap<string, LockInState>;
  nowIso: string;
}): BriefingArtifactValidity {
  const state = rulingFor({ states, url: reading.url });
  if (state === undefined) {
    return { mark: "valid" };
  }
  const whenIso = lastMovedIso({ reading });
  if (!resolutionHolds({ nowIso, state, whenIso })) {
    return { mark: "valid" };
  }
  const byUrl = CLOSING_OUTCOMES.has(state.outcome) ? supersededByUrl({ selfUrl: reading.url, state }) : undefined;
  if (byUrl !== undefined) {
    return { by: labelFor({ readings: siblings, url: byUrl }), byUrl, mark: "superseded" };
  }
  return { mark: "partly-ruled", outcome: state.outcome, ruledIso: state.resolvedAtIso };
}

/**
 * How urgently one page wants opening, lowest first. The ranking is BY VALIDITY: the owner needs to know which
 * one to react to first and be sure it is still worth the time.
 *
 * A page nothing has ruled on outranks one the owner has partly answered, which outranks one another page
 * replaced. A superseded page stays ON the index rather than being dropped, because absence is never done — the
 * same call `../sessionStart/lockIn.suppression` makes about an approved row, and the reason the index carries
 * marks instead of a filter: the owner sees that a tab is dead, rather than wondering where it went.
 */
function validityOrder({ validity }: { validity: BriefingArtifactValidity }): number {
  if (validity.mark === "valid") {
    return 0;
  }
  return validity.mark === "partly-ruled" ? 1 : 2;
}

/**
 * Rank every open page and mark each one, producing the index the react-now block renders.
 *
 * Ordered by validity first and then by `landedIso` NEWEST first inside each band. Newest first because the
 * pages the owner asks about are the ones that appeared recently, and the one not yet seen is the one a session
 * is waiting on. Ties break on `url` so the order is total and two runs over the same reading produce the same
 * page.
 *
 * @param readings every open page a sweep found, in any order
 * @param states the folded lock-in ledger
 * @param nowIso the run's own instant
 * @returns the ranked index, numbered from 1 with no gaps
 */
export function rankOpenArtifacts({
  readings,
  states,
  nowIso,
}: {
  readings: readonly OpenArtifactReading[];
  states: ReadonlyMap<string, LockInState>;
  nowIso: string;
}): readonly BriefingOpenArtifact[] {
  return readings
    .map((reading) => ({ reading, validity: artifactValidity({ nowIso, reading, siblings: readings, states }) }))
    .toSorted((left, right) => {
      const byValidity = validityOrder({ validity: left.validity }) - validityOrder({ validity: right.validity });
      if (byValidity !== 0) {
        return byValidity;
      }
      const byLanded = right.reading.landedIso.localeCompare(left.reading.landedIso);
      return byLanded === 0 ? left.reading.url.localeCompare(right.reading.url) : byLanded;
    })
    .map((marked, index) => ({
      ask: [{ kind: "text" as const, text: marked.reading.ask }],
      label: marked.reading.label,
      landedIso: marked.reading.landedIso,
      rank: index + 1,
      // Carried rather than dropped. A card projected from this row needs both instants — `landedIso` is the
      // age the owner recognises and this is what a ruling lapses against — so `./openPageCards.ts` has an
      // instant to give a card an age from.
      ...(marked.reading.updatedIso === undefined ? {} : { updatedIso: marked.reading.updatedIso }),
      url: marked.reading.url,
      validity: marked.validity,
    }));
}

/**
 * One string field of a decoded entry, or undefined when it is absent or is not a string.
 *
 * @param record the parsed entry
 * @param key the field to read
 * @returns the string, or undefined
 */
function stringField({ record, key }: { record: Record<string, unknown>; key: string }): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Decode one entry of the `--open-artifacts` document, or say why it could not be read.
 *
 * Every field is required and refused rather than defaulted, because each one is a fact a sweep holds and
 * this verb does not: a missing `landedIso` cannot be invented from the clock without claiming a page landed
 * now, and a missing `ask` would render a link with nothing said about it, which is the bookmark the
 * standing band's own rule already refuses.
 *
 * @param value one entry, as parsed JSON
 * @param index its position in the document, so a refusal names which entry
 * @returns the reading, or the operator-facing refusal
 */
function decodeReading({
  value,
  index,
}: {
  value: unknown;
  index: number;
}): Result<OpenArtifactReading, BriefingError> {
  if (!isRecord(value)) {
    return err(BriefingErrors.openArtifactEntryNotObject({ index }));
  }
  const label = stringField({ key: "label", record: value });
  const url = stringField({ key: "url", record: value });
  const ask = stringField({ key: "ask", record: value });
  const landedIso = stringField({ key: "landedIso", record: value });
  if (label === undefined || url === undefined || ask === undefined || landedIso === undefined) {
    return err(BriefingErrors.openArtifactFieldsMissing({ index }));
  }
  // NEVER A MARKDOWN DOCUMENT: a finding card's "page" must not be the finding's own handover doc. An entry
  // here is a page the owner reacts to, and the ranked band and the projected card both
  // read this url, so this is the one seam that covers both. The criterion and its words are
  // `./markdownSubject.ts`; the loop above collects every offender before refusing.
  if (isMarkdownSubjectUrl({ url })) {
    return err(BriefingErrors.openArtifactSubjectRefused({ index, url }));
  }
  const updatedIso = stringField({ key: "updatedIso", record: value });
  return ok({ ask, label, landedIso, url, ...(updatedIso === undefined ? {} : { updatedIso }) });
}

/**
 * Project the `--open-artifacts` document and the lock-in ledger into the ranked, marked index.
 *
 * The two inputs are separate on purpose. The document says what is OPEN, which only a sweep of the owner's
 * tabs knows; the ledger says what the owner RULED, which only the owner can have written. A composer supplying
 * both would be supplying its own verdict, which is exactly the untrustworthy arrangement this index replaces.
 *
 * @param document the parsed `--open-artifacts` file: an array of readings
 * @param ledgerText the raw `lock-in.jsonl` contents, empty when the home has none
 * @param nowIso the run's own instant
 * @returns the ranked index, or one refusal line per entry that could not be read
 */
export function projectOpenArtifacts({
  document,
  ledgerText,
  nowIso,
}: {
  document: unknown;
  ledgerText: string;
  nowIso: string;
}): Result<readonly BriefingOpenArtifact[], BriefingError> {
  if (!Array.isArray(document)) {
    return err(BriefingErrors.openArtifactDocumentNotArray());
  }
  const readings: OpenArtifactReading[] = [];
  const refusals: string[] = [];
  for (const [index, value] of document.entries()) {
    const decoded = decodeReading({ index, value });
    if (decoded.isErr()) {
      refusals.push(...briefingErrorLines({ error: decoded.error }));
      continue;
    }
    readings.push(decoded.value);
  }
  if (refusals.length > 0) {
    return err(BriefingErrors.openArtifactsRefused({ reasons: refusals }));
  }
  const states = foldLockInLedger({ rows: parseLockInRows({ text: ledgerText }) });
  return ok(rankOpenArtifacts({ nowIso, readings, states }));
}
