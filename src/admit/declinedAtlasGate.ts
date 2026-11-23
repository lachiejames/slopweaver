/**
 * The gate that refuses to send an answer which lists an atlas as unseen while that atlas is published,
 * graded ANSWERABLE, and one local command away.
 *
 * ## The measured failure
 *
 * A question in the owner's own DM asked what it would take to get one compliance control passing. The
 * posted answer's `couldNotSee` list carried, verbatim,
 * _"the jumpcloud and google admin atlases, so i can't say where else a password rule is already
 * enforced"_. On that install, `slopweaver atlas doctor` graded both of those atlases ANSWERABLE, and
 * `slopweaver atlas jumpcloud read --kind policies --query password` returned stored rows. The turn had
 * declined two atlases it could have read with one zero-network command, and its own provenance footer
 * says it loaded no skill and ran no `route plan`. Reproduce the grading half on any install:
 *
 * ```bash
 * slopweaver atlas doctor
 * ```
 *
 * ## Why a gate rather than a line in the brief
 *
 * `./skillLoadGate.ts`'s header carries the measurement that settles this: the brief was changed to render
 * the ranked skill candidates and 31 of 43 dispatched worker turns (72%) still held no skill at all. Advice
 * on this path does not move outcomes. Doctrine rule 7's shape is that the form REFUSES a violation, so
 * this joins `../live/turn/answerPreflight.ts`'s deterministic list — run once before a reviewer is opened
 * and again at the door.
 *
 * ## The criterion, and why the literal word "atlas" is part of it
 *
 * A blind spot fires only when it names a platform this install grades ANSWERABLE **and** carries the word
 * `atlas`/`atlases`. The word is not decoration. The same failing answer's `couldNotSee` list also held
 * _"no screenshot of the vanta control page: control-evidence reads the manage api only, and i didn't run
 * the browser walk that fills vanta's other channel"_ — a completely honest blind spot about a surface
 * nobody walked, while `vanta` grades `ANSWERABLE` too. A bare platform-name criterion refuses
 * that correct sentence. The word separates the two on real text, with nothing tuned.
 *
 * **The escape is stated rather than closed.** A composer writing "jumpcloud, so i can't say" is not caught
 * here. That is accepted: a gate that never false-refuses is the only kind that survives contact, and the
 * class this catches is the one that was actually measured.
 *
 * ## Why the roster arrives as DATA
 *
 * Grading loads entities. MEASURED:`time slopweaver atlas doctor --json`
 * took 11.878s over 37 atlases, `atlas doctor jumpcloud` alone 6.897s. Running that sweep at pre-flight
 * AND again at the door would add roughly 24 seconds to every turn and would be overridden into
 * irrelevance. So the work splits: {@link atlasesNamedInBlindSpots} is pure and touches nothing, naming
 * only the platforms a blind spot actually mentions, and the effectful shell
 * (`../live/turn/declinedAtlasReadings.ts`) grades just those. An answer naming no atlas — the
 * overwhelmingly common case — costs no I/O at all.
 *
 * ## Its one blind spot, named rather than discovered
 *
 * A reading the shell could not produce — a store that threw rather than refusing — arrives absent, and an
 * absent reading yields no finding. That is deliberate in the honest direction (a refusal is evidence the
 * blind spot was true), but it does mean a grading this gate never SAW reads the same as a dark atlas.
 */

import type { AnswerFormAnswer } from "../outbound/assistant/answerForm.js";
import type { DoorFinding, DoorGate } from "./types.js";

/**
 * The override token that waives this gate, recorded by the door whenever it is used.
 *
 * @internal — named here so the value has one home; the hatch row and the tests quote it rather than
 *   re-spelling it.
 */
export const DECLINED_ATLAS_OVERRIDE = "answer.declined-atlas:v1";

/**
 * What the shell graded for one atlas a blind spot named — restated structurally so this module imports no
 * atlas code and stays testable with a literal, exactly as `../route/atlasReading.ts` does.
 */
export interface DeclinedAtlasReading {
  /** The registry's own platform slug, e.g. `google-admin`. */
  readonly platform: string;
  /** Whether `atlas/kit/answerable.ts` graded this generation `answerable`. */
  readonly answerable: boolean;
  /** Every kind name the graded generation declares, so a blind spot about a KIND can discharge itself. */
  readonly kinds: readonly string[];
}

/**
 * Lowercase the text and reduce every run of non-alphanumerics to one space, padded at both ends, so a
 * name can be looked for with word boundaries already built in.
 */
function normalised({ text }: { text: string }): string {
  return ` ${text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/** Whether `needle`, normalised the same way, appears as a whole word sequence inside `haystack`. */
function namesWord({ haystack, needle }: { haystack: string; needle: string }): boolean {
  return haystack.includes(normalised({ text: needle }));
}

/** Whether this blind spot is talking about an atlas at all. */
function mentionsAnAtlas({ spot }: { spot: string }): boolean {
  const text = normalised({ text: spot });
  return text.includes(" atlas ") || text.includes(" atlases ");
}

/**
 * Which registered atlas platforms a set of blind spots names — the PURE selector the shell grades from.
 *
 * Zero I/O by construction: it reads the platform list it is handed and the strings the answer already
 * carries. Only a blind spot that also says `atlas`/`atlases` counts, for the reason this module's header
 * gives, so an answer naming no atlas hands the shell an empty list and costs nothing to check.
 *
 * @param blindSpots the answer's own `couldNotSee.blindSpots`
 * @param platforms every platform this build registers, from `atlas/registry.ts`'s `atlasPlatforms()`
 * @returns the named platforms, in registry order and without repeats
 */
export function atlasesNamedInBlindSpots({
  blindSpots,
  platforms,
}: {
  blindSpots: readonly string[];
  platforms: readonly string[];
}): readonly string[] {
  const atlasSpots = blindSpots.filter((spot) => mentionsAnAtlas({ spot })).map((spot) => normalised({ text: spot }));
  return platforms.filter((platform) => atlasSpots.some((spot) => namesWord({ haystack: spot, needle: platform })));
}

/** Every answerable platform this one blind spot declines without naming a kind of it. */
function declinedIn({
  spot,
  readings,
}: {
  spot: string;
  readings: readonly DeclinedAtlasReading[];
}): readonly DeclinedAtlasReading[] {
  const text = normalised({ text: spot });
  return readings.filter((reading) => {
    if (!reading.answerable || !namesWord({ haystack: text, needle: reading.platform })) {
      return false;
    }
    return !reading.kinds.some((kind) => namesWord({ haystack: text, needle: kind }));
  });
}

/**
 * Every blind spot that declines an atlas this install can actually read.
 *
 * One finding per blind spot rather than per platform: a reader fixes one bullet at a time, and the
 * measured failure put both atlases in a single sentence. Returned as a LIST rather than the first
 * failure, for the reason `./answerQualityGate.ts` gives — a composer learning about the next problem only
 * after another round trip is the loop the typed forms exist to avoid.
 *
 * A blind spot that also names one of the atlas's own declared KINDS is cleared. "the jumpcloud atlas's
 * policies kind has never synced" is a different claim from "the jumpcloud atlas", and only the second is
 * the one being caught — jumpcloud grades answerable as a whole while its `policies` kind reports
 * `never-synced`, so that state has to stay sayable. The discharge is checkable against the generation the
 * shell already loaded, never against a free-text `read` label the same composer authored.
 *
 * @param answer the composed answer about to be sent
 * @param readings one grading per platform the selector named; a platform absent here is not checked
 * @returns every finding that stands; empty when no blind spot declines a readable atlas
 *
 * @internal — exported so a test can assert the findings without composing a whole door request.
 */
export function declinedAtlasFindings({
  answer,
  readings,
}: {
  answer: AnswerFormAnswer;
  readings: readonly DeclinedAtlasReading[];
}): readonly DoorFinding[] {
  const findings: DoorFinding[] = [];
  for (const spot of answer.grounding.evidence.couldNotSee.blindSpots) {
    if (!mentionsAnAtlas({ spot })) {
      continue;
    }
    const declined = declinedIn({ readings, spot });
    if (declined.length === 0) {
      continue;
    }
    const named = declined.map((reading) => reading.platform);
    findings.push({
      code: "ANSWER_DECLINES_READABLE_ATLAS",
      correction:
        `run \`slopweaver atlas ${named[0]} read --query <the words this ask uses>\` (and the same for any` +
        ` other atlas in that bullet), then answer from what it holds — or, if a particular KIND is what you` +
        ` could not see, say the kind rather than the atlas`,
      override: DECLINED_ATLAS_OVERRIDE,
      severity: "warn",
      summary:
        `this blind spot says the ${named.join(" and ")} atlas${named.length > 1 ? "es" : ""} could not be` +
        ` seen, and every one of them is published and grades ANSWERABLE on this install — a local read` +
        ` away, with no network call`,
    });
  }
  return findings;
}

/**
 * The gate, bound to the readings the shell graded.
 *
 * @param answer the composed answer about to be sent
 * @param readings one grading per platform the answer's blind spots named
 * @returns a `DoorGate` closing over both
 */
export function declinedAtlasGate({
  answer,
  readings,
}: {
  answer: AnswerFormAnswer;
  readings: readonly DeclinedAtlasReading[];
}): DoorGate {
  return () => declinedAtlasFindings({ answer, readings });
}
