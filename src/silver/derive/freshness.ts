/**
 * The FRESHNESS CONTRACT for derived state, pure half.
 *
 * ## The class this exists for
 *
 * A derived artefact (silver, a registration, a checkout, a board verdict) is built FROM a source and then
 * carries no record of what that source held at the time. So no consumer can tell "stale" from "fine"
 * cheaply, and the ones that can only warn. Measured: bronze was ingested while the
 * identity roster had been derived two days earlier, and every `slack post` printed a STALE warning and sent
 * anyway — a colleague who joined in those two days could not be mentioned, and the message went out
 * regardless.
 *
 * The contract is three rules, and this module is the first two:
 *
 * 1. **A derived artefact records the source watermark it was built from** — {@link FreshnessStamp}, written
 *    beside the artefact by whatever derives it.
 * 2. **A consumer compares watermarks before use** — {@link deriveFreshness}, a pure comparison cheap enough
 *    to run on every send.
 * 3. **On stale there are exactly two sanctioned behaviours** — {@link freshnessAction} picks between them:
 *    JIT refresh when the refresh is deterministic, local and bounded, and a LOUD REFUSAL naming the exact
 *    command when it is remote, expensive, or needs a person. "Warn and proceed" is not a third option for
 *    anything that affects what gets sent.
 *
 * "Stale" is measured against the moment a send was ASKED FOR, not against the moment it is checked:
 * {@link settledForAsk} treats movement after a derive that observed its sources at or after the ask as
 * concurrent with the send, so an ingest running in another workspace cannot hold every send for its whole
 * length.
 *
 * ## Why the witness is bytes and a cursor, not an mtime
 *
 * The signal this replaced compared two mtimes, which made every no-op refresh look like a change: refresh
 * rewrites a window file whether or not it found anything, so the roster read as STALE on runs that had
 * ingested nothing at all. A witness of (resume cursor, file count, total bytes) is stable across a refresh
 * that added nothing and moves the moment one adds something.
 *
 * The stated limit, since a freshness signal that hides its own blind spot is the thing being fixed: an edit
 * that replaces bronze content with a byte-identical-length rewrite, leaving the cursor and the file count
 * alone, is invisible here. A real digest would catch it and would cost a full read of every bronze file on
 * every send, which is not a price a mention resolution can pay.
 *
 * ## Why the comparison is per-SOURCE and not per-DOOR
 *
 * A 2.4 MB gmail ingest took the `slack post --as me` door offline: gmail moved the shared
 * stamp, the roster read stale, and the door refused. The obvious reading is that freshness should be scoped
 * to what the DOOR reads — Slack for a Slack send — and that reading is WRONG. A door does not read a
 * source; it reads the roster, and the roster is cross-source by construction: an `email` or `handle` link
 * carried by a GitHub or Linear ingest is exactly how a Slack id acquires a second addressable key. Scoping
 * to the door would silence the signal in the case it exists for.
 *
 * The real question is narrower and mechanical: **which sources can move the roster at all?** That is a
 * property of the derive pipeline, and it is already decided — an identity is minted only from an author
 * with its source's native-id SHAPE (`../nativeIdShape.isNativeIdShaped`), and gmail has no such shape at
 * all, deliberately: bronze scrubs every address on the way in, so a mail record's author is a display name
 * and nothing under that source is ever a key. `calendar` is excluded on exactly that argument, since its
 * author is the organiser's display name or address local part (`../../corpus/personName.ts`) and an
 * address reaching it is scrubbed the same way. `gold` is refused at the same door for being synthetic.
 * Neither has a member roster lane either. So {@link ROSTER_SOURCES} is the answer: compare the sources
 * that can change the artefact, and no others. A gmail ingest gating a Slack send was never a conservative
 * choice — it was a false positive with no case behind it.
 *
 * The other trigger that morning is untouched, and correctly so: a change to the AUTHORITATIVE override roster
 * (then a 362B → 610B edit to its file; now a new revision of its store row) still invalidates
 * unconditionally, through {@link FreshnessObservation.overrideRevision}.
 */
import { absentAs } from "#lib/absent.js";
import { type CorpusSource } from "../../corpus/types.js";
import { ALL_CORPUS_SOURCES, ROSTER_SOURCES } from "../../integrations/corpusSources.js";
import { parseJson } from "../../lib/jsonParse.js";
import { isRecord } from "../../lib/parsers.js";
import { revisionLabel, type StampedRevision, stampedRevision } from "./stampedRevision.js";

// `ROSTER_SOURCES`: the sources whose witness can move the DERIVED ROSTER, and therefore the only ones a staleness
// check compares, derived from the manifests that say `identityRoster` plus the local `self` row. Every other source is
// still WITNESSED in the stamp — that is a record of what derive read — it simply cannot make the roster stale on its
// own. See the module doc for the ruling and the mechanism;
// `../../__tests__/unit/silver/derive/freshness/rosterSources.test.ts` pins each exclusion to the resolver that makes
// it true, so a source that later gains a native-id shape fails the test rather than silently losing its gate.
export { ROSTER_SOURCES };

/** The cheap, content-shaped witness of what one source held when derive read it. */
export interface SourceWitness {
  /** The stored resume cursor (`corpus/watermarks/<source>.json`), or null when the source has none. */
  readonly cursorIso: string | null;
  /** How many bronze files that source had. */
  readonly bronzeFiles: number;
  /** Their total size in bytes. */
  readonly bronzeBytes: number;
  /** The size of `corpus/members/<source>.jsonl` — the member roster lane, which ages independently. */
  readonly memberBytes: number;
  /** The size of `corpus/structures/<source>.jsonl`. */
  readonly structureBytes: number;
}

/** A witness of a source that has nothing on disk at all. */
export const EMPTY_WITNESS: SourceWitness = {
  bronzeBytes: 0,
  bronzeFiles: 0,
  cursorIso: null,
  memberBytes: 0,
  structureBytes: 0,
};

/** Everything derive reads, witnessed. Compared field-for-field against the stamp beside the artefact. */
export interface FreshnessObservation {
  /**
   * The revision of the human override roster — the store's `identity-roster` row (`../identityRoster.ts`) — that
   * derive also consumes; null when no row exists. The STAMPED side has a third value, see
   * {@link FreshnessStamp.overrideRevision}.
   */
  readonly overrideRevision: number | null;
  /**
   * The size of the sync-author denylist derive filters records through (`corpus/syncExclusion.ts`). Witnessed
   * for `silverCurrency` (`./currency.ts`) alone: a send's {@link deriveFreshness} does not compare it.
   */
  readonly exclusionBytes: number;
  /**
   * The whole tree derive's reader walks — the same recursive `.jsonl` scan over the same resolved root, so a
   * `--corpus` override, a nested file or a directory no source owns are all witnessed. Null on a stamp written
   * before this field existed. Witnessed for `silverCurrency` (`./currency.ts`) alone, like {@link exclusionBytes}.
   */
  readonly corpus: CorpusWitness | null;
  readonly sources: Readonly<Record<CorpusSource, SourceWitness>>;
}

/** What derive's corpus reader would walk: which root, and every `.jsonl` file and unlistable path under it. */
export interface CorpusWitness {
  readonly root: string;
  readonly files: number;
  readonly bytes: number;
  readonly unreadable: number;
}

/** The observation as it is persisted beside the derived artefact, plus when it was taken and written. */
export interface FreshnessStamp extends Omit<FreshnessObservation, "overrideRevision"> {
  /** The roster revision derive consumed — see {@link StampedRevision} for why it has a third value. */
  readonly overrideRevision: StampedRevision;
  readonly version: 1;
  readonly derivedAtIso: string;
  /**
   * When derive took its source observation — read just BEFORE it, so never later than the real one. Null on
   * a stamp written before this field existed, which {@link settledForAsk} never settles.
   */
  readonly observedAtIso: string | null;
  /**
   * Every artefact this derive wrote, keyed by path, as `stat` saw it straight after the write. A file another
   * derive wrote later differs, so `silverCurrency` (`./currency.ts`) never vouches for a mixture. Null on a
   * stamp written before this field existed, or by a caller that wrote no artefacts.
   */
  readonly artefacts: Readonly<Record<string, ArtefactWitness>> | null;
}

/** One artefact file as written: its size and modification time, both exact. */
export interface ArtefactWitness {
  readonly bytes: number;
  readonly mtimeMs: number;
}

/** One input whose witness has moved since the stamp, and the human-readable reasons it has. */
interface SourceChange {
  /** The source name, or `identity roster` for the human override roster derive also reads. */
  readonly source: string;
  readonly reasons: readonly string[];
}

/**
 * Whether a derived artefact still reflects the source it was built from.
 *
 * `absent` and `stale` both mean "do not use this as-is"; they are separate because only `stale` can say
 * WHAT moved, and a consumer's message is better for naming it.
 */
export type DeriveFreshness =
  | { readonly kind: "fresh" }
  | { readonly kind: "absent"; readonly why: string }
  | { readonly kind: "stale"; readonly derivedAtIso: string; readonly changed: readonly SourceChange[] };

/** A verdict that has something to say — `fresh` excluded at the TYPE level, so no caller can ask a healthy
 * artefact for its advisory text and default the answer to an empty string. */
export type UnusableFreshness = Exclude<DeriveFreshness, { kind: "fresh" }>;

/**
 * An observation in which every source has nothing — what an empty home witnesses to.
 *
 * @returns the all-zero observation
 */
export function emptyObservation(): FreshnessObservation {
  return { corpus: null, exclusionBytes: 0, overrideRevision: null, sources: witnessMap({ of: () => EMPTY_WITNESS }) };
}

/**
 * Build the per-source witness map by calling `of` for each source.
 *
 * Written out key by key rather than folded from {@link ALL_CORPUS_SOURCES}, because the literal is what
 * makes the compiler enforce that every source has a witness — a fold produces a `Record` only by assertion,
 * and an assertion is exactly how a source silently ends up unwitnessed.
 *
 * @param of the witness for one source
 * @returns one witness per corpus source
 */
export function witnessMap({
  of,
}: {
  of: (source: CorpusSource) => SourceWitness;
}): Record<CorpusSource, SourceWitness> {
  return {
    calendar: of("calendar"),
    chatgpt: of("chatgpt"),
    fathom: of("fathom"),
    github: of("github"),
    gmail: of("gmail"),
    gold: of("gold"),
    linear: of("linear"),
    notion: of("notion"),
    "outlook-calendar": of("outlook-calendar"),
    self: of("self"),
    slack: of("slack"),
  };
}

/** A non-negative integer field of a persisted witness, or 0. */
function count({ raw, key }: { raw: unknown; key: string }): number {
  const value = isRecord(raw) ? raw[key] : undefined;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** One persisted witness, defaulting every field it is missing. */
function parseWitness({ raw }: { raw: unknown }): SourceWitness {
  const cursor = isRecord(raw) ? raw["cursorIso"] : undefined;
  return {
    bronzeBytes: count({ key: "bronzeBytes", raw }),
    bronzeFiles: count({ key: "bronzeFiles", raw }),
    cursorIso: typeof cursor === "string" ? cursor : null,
    memberBytes: count({ key: "memberBytes", raw }),
    structureBytes: count({ key: "structureBytes", raw }),
  };
}

/** A persisted corpus witness, or null when the stamp carries none — which `silverCurrency` rebuilds on. */
function parseCorpusWitness({ raw }: { raw: unknown }): CorpusWitness | null {
  if (!isRecord(raw) || typeof raw["root"] !== "string") {
    return null;
  }
  return {
    bytes: count({ key: "bytes", raw }),
    files: count({ key: "files", raw }),
    root: raw["root"],
    unreadable: count({ key: "unreadable", raw }),
  };
}

/** A persisted artefact record, or null when the stamp carries none. An entry that is not a witness is dropped. */
function parseArtefactWitnesses({ raw }: { raw: unknown }): Readonly<Record<string, ArtefactWitness>> | null {
  if (!isRecord(raw)) {
    return null;
  }
  const witnesses: Record<string, ArtefactWitness> = {};
  for (const [path, entry] of Object.entries(raw)) {
    if (isRecord(entry) && typeof entry["bytes"] === "number" && typeof entry["mtimeMs"] === "number") {
      witnesses[path] = { bytes: entry["bytes"], mtimeMs: entry["mtimeMs"] };
    }
  }
  return witnesses;
}

/**
 * Parse a persisted stamp. Tolerant of a missing field (it reads as zero, which reads as "moved" against any
 * real source and so fails toward re-deriving), strict about the two facts that make it a stamp at all: the
 * version and the timestamp.
 *
 * @param content the raw `freshness.json` text
 * @returns the stamp, or undefined when the file is not one
 */
export function parseFreshnessStamp({ content }: { content: string }): FreshnessStamp | undefined {
  const parsed = parseJson({ text: content });
  if (parsed.isErr() || !isRecord(parsed.value)) {
    return undefined;
  }
  const value = parsed.value;
  const derivedAtIso = value["derivedAtIso"];
  if (value["version"] !== 1 || typeof derivedAtIso !== "string" || derivedAtIso.length === 0) {
    return undefined;
  }
  const sources = isRecord(value["sources"]) ? value["sources"] : {};
  const observedAtIso = value["observedAtIso"];
  return {
    artefacts: parseArtefactWitnesses({ raw: value["artefacts"] }),
    corpus: parseCorpusWitness({ raw: value["corpus"] }),
    derivedAtIso,
    exclusionBytes: count({ key: "exclusionBytes", raw: value }),
    observedAtIso: typeof observedAtIso === "string" && observedAtIso.length > 0 ? observedAtIso : null,
    overrideRevision: stampedRevision({ stamp: value }),
    sources: witnessMap({ of: (source) => parseWitness({ raw: sources[source] }) }),
    version: 1,
  };
}

/** The human reasons one source's witness differs from what was stamped. Empty when it has not moved. */
function witnessDifferences({
  stamped,
  observed,
}: {
  stamped: SourceWitness;
  observed: SourceWitness;
}): readonly string[] {
  const reasons: string[] = [];
  if (stamped.cursorIso !== observed.cursorIso) {
    reasons.push(
      `resume cursor ${absentAs({ value: stamped.cursorIso, whenAbsent: "(none)" })} → ${absentAs({ value: observed.cursorIso, whenAbsent: "(none)" })}`,
    );
  }
  if (stamped.bronzeFiles !== observed.bronzeFiles || stamped.bronzeBytes !== observed.bronzeBytes) {
    reasons.push(
      `bronze ${String(stamped.bronzeFiles)} file(s)/${String(stamped.bronzeBytes)}B → ` +
        `${String(observed.bronzeFiles)} file(s)/${String(observed.bronzeBytes)}B`,
    );
  }
  if (stamped.memberBytes !== observed.memberBytes) {
    reasons.push(`member roster ${String(stamped.memberBytes)}B → ${String(observed.memberBytes)}B`);
  }
  if (stamped.structureBytes !== observed.structureBytes) {
    reasons.push(`structures ${String(stamped.structureBytes)}B → ${String(observed.structureBytes)}B`);
  }
  return reasons;
}

/**
 * Compare a derived artefact's stamp against a fresh observation of the same sources. Pure — both sides are
 * supplied already read.
 *
 * @param stamp the stamp written beside the artefact, or undefined when the artefact or its stamp is missing
 * @param observed what the sources hold now
 * @param artefactPresent whether the derived artefact itself is on disk
 * @returns the verdict
 */
export function deriveFreshness({
  stamp,
  observed,
  artefactPresent,
}: {
  stamp: FreshnessStamp | undefined;
  observed: FreshnessObservation;
  artefactPresent: boolean;
}): DeriveFreshness {
  if (!artefactPresent) {
    return { kind: "absent", why: "it has never been derived" };
  }
  if (stamp === undefined) {
    return { kind: "absent", why: "it carries no freshness stamp, so what it was derived from is unknowable" };
  }
  const changed = ROSTER_SOURCES.map((source) => ({
    reasons: witnessDifferences({ observed: observed.sources[source], stamped: stamp.sources[source] }),
    source,
  })).filter((change) => change.reasons.length > 0);
  const overrideMoved = stamp.overrideRevision !== observed.overrideRevision;
  if (changed.length === 0 && !overrideMoved) {
    return { kind: "fresh" };
  }
  return {
    changed: overrideMoved
      ? [
          ...changed,
          {
            reasons: [
              `override roster revision ${revisionLabel({ revision: stamp.overrideRevision })} → ` +
                revisionLabel({ revision: observed.overrideRevision }),
            ],
            source: "identity roster",
          },
        ]
      : changed,
    derivedAtIso: stamp.derivedAtIso,
    kind: "stale",
  };
}

/**
 * Settle a stale verdict whose every movement came AFTER this send was asked for.
 *
 * Freshness is relative to the ask. A derive that took its source observation at or after the moment a send
 * was asked for has seen every byte ingested before that moment, so what has landed since is concurrent with
 * the send — indistinguishable from an ingest landing a second after the post, which nothing would refuse.
 * Measured: an approved `slack post --as me --draft` was refused three times in twenty minutes,
 * each time straight after its own just-in-time derive, because a Notion refresh in another workspace kept
 * appending (notion bronze growing by hundreds of kilobytes between reads). Without this, no send resting on the roster
 * can go out for the whole length of any refresh.
 *
 * Who wrote the stamp does not matter — the observation instant does — so a concurrent derive by another
 * process settles too. Bronze is append-only, so a source whose bronze SHRANK since the stamp was rewritten
 * underneath it, and "derive saw everything" no longer follows: that stays stale. So does a stamp with no
 * `observedAtIso`, and an ask instant that does not parse.
 *
 * And so does an override roster at a different revision, whenever it was observed. Time cannot settle it: the
 * caller resolves people with ONE roster snapshot and witnesses its revision, so a stamp from another revision —
 * a concurrent derive over a newer roster, or a stamp written before revisions were witnessed at all — describes
 * an artefact the caller's roster did not build, however recently that stamp was taken.
 *
 * @param freshness the verdict {@link deriveFreshness} gave for this stamp and observation
 * @param stamp the stamp that verdict was computed from
 * @param observed the observation that verdict was computed from
 * @param askedAtIso when this send was asked for — read no earlier than the real ask
 * @returns `fresh` when the only movement is concurrent with this send, otherwise the verdict unchanged
 */
export function settledForAsk({
  freshness,
  stamp,
  observed,
  askedAtIso,
}: {
  freshness: DeriveFreshness;
  stamp: FreshnessStamp | undefined;
  observed: FreshnessObservation;
  askedAtIso: string;
}): DeriveFreshness {
  if (freshness.kind !== "stale" || stamp?.observedAtIso == null) {
    return freshness;
  }
  if (stamp.overrideRevision !== observed.overrideRevision) {
    return freshness;
  }
  const observedAfterAsk = Date.parse(stamp.observedAtIso) >= Date.parse(askedAtIso);
  const bronzeShrank = ROSTER_SOURCES.some(
    (source) =>
      observed.sources[source].bronzeFiles < stamp.sources[source].bronzeFiles ||
      observed.sources[source].bronzeBytes < stamp.sources[source].bronzeBytes,
  );
  return observedAfterAsk && !bronzeShrank ? { kind: "fresh" } : freshness;
}

/**
 * The one line that says what moved, for a log or a refusal.
 *
 * @param freshness the non-fresh verdict
 * @param artefact what the verdict is about — named so the line stands alone in a log
 * @returns the explanation, without the fix (the action supplies that)
 */
export function freshnessReason({
  freshness,
  artefact,
}: {
  freshness: UnusableFreshness;
  artefact: DerivedArtefact;
}): string {
  if (freshness.kind === "absent") {
    return `${artefact.name} cannot be trusted: ${freshness.why}`;
  }
  const moved = freshness.changed.map((change) => `${change.source} (${change.reasons.join("; ")})`).join(", ");
  return `${artefact.name} was built ${freshness.derivedAtIso} and its sources have moved since: ${moved}`;
}

/** How a derived artefact's source is re-read — the ONE input that decides JIT from refusal. */
type RefreshKind = "local-deterministic" | "remote-or-human";

/** A derived artefact under the contract: what it is, what refreshes it, and how expensive that is. */
export interface DerivedArtefact {
  readonly name: string;
  /** The exact command that refreshes it — printed verbatim by both a JIT log line and a refusal. */
  readonly command: string;
  readonly refresh: RefreshKind;
}

/**
 * The two sanctioned behaviours, and `proceed` for the case where staleness cannot change the outcome.
 * There is deliberately no `warn` member: a shape that cannot be represented cannot be sent.
 */
export type FreshnessAction =
  | { readonly kind: "proceed" }
  | { readonly kind: "jit"; readonly command: string; readonly line: string }
  | { readonly kind: "refuse"; readonly command: string; readonly line: string };

/**
 * Choose what a consumer does about a freshness verdict.
 *
 * `affectsOutput` is the whole reason `proceed` exists for a stale artefact: a card that mentions nobody is
 * not made wrong by a roster that has not seen this week's joiners, and refusing it would be the "fail closed
 * on something that could not have mattered" failure in the other direction.
 *
 * `refreshAttempted` is what stops the JIT arm from becoming a loop, and it is where "warn and proceed" would
 * otherwise creep back in. A just-in-time refresh that ran and did not make the artefact fresh has told you
 * something — the refresh is failing, or the source moved before this send was asked for and the derive did
 * not see it — and the answer to that is a refusal naming the command, not a third send against state nobody
 * trusts. Movement AFTER the ask is not that case: {@link settledForAsk} has already made it `fresh` before
 * a verdict reaches here.
 *
 * @param freshness the verdict from {@link deriveFreshness}
 * @param artefact what is stale, and what refreshes it
 * @param affectsOutput whether this consumer's output actually depends on the artefact
 * @param refreshAttempted whether this consumer has already run the just-in-time refresh
 * @returns proceed, refresh just-in-time, or refuse naming the fix
 */
export function freshnessAction({
  freshness,
  artefact,
  affectsOutput,
  refreshAttempted = false,
}: {
  freshness: DeriveFreshness;
  artefact: DerivedArtefact;
  affectsOutput: boolean;
  refreshAttempted?: boolean;
}): FreshnessAction {
  if (freshness.kind === "fresh" || !affectsOutput) {
    return { kind: "proceed" };
  }
  const reason = freshnessReason({ artefact, freshness });
  if (artefact.refresh === "local-deterministic" && !refreshAttempted) {
    return {
      command: artefact.command,
      kind: "jit",
      line: `${reason} — running \`${artefact.command}\` first (local, deterministic, no network)`,
    };
  }
  const already = refreshAttempted ? ` \`${artefact.command}\` has already run and did not make it fresh.` : "";
  return {
    command: artefact.command,
    kind: "refuse",
    line: `${reason} — refusing rather than sending against stale state.${already} Run \`${artefact.command}\`, then retry.`,
  };
}

/** The derived identity roster: local, deterministic, minutes — so its stale behaviour is JIT refresh. */
export const SILVER_ROSTER_ARTEFACT: DerivedArtefact = {
  command: "slopweaver derive",
  name: "the derived identity roster (corpus/silver/index/identities.json)",
  refresh: "local-deterministic",
};
