/**
 * The derived-card-voice gate — runs the operator's OWN voice checker over every bot form kind's DERIVED
 * card, built from each of that kind's canonical fixtures.
 *
 * ## The class it closes, and why every schema already passing was not enough
 *
 * More schema shapes make a class of mistake impossible to AUTHOR rather than caught after the fact. The measured instance is the one no schema could have caught: a
 * card's TL;DR carried an em dash that was never in any field a caller filled. `deriveTldr` minted it, from a
 * separator hard-coded in this repository, AFTER the form schema, the derived-card schema and the door had
 * all passed the input. Every gate in the chain was green about text none of them had seen yet.
 *
 * So the subject here is not a field. It is the prose the CODE composes, and the only way to see it is to
 * derive a card and read it. That is what this gate does: every canonical form a kind declares, through the
 * real parser, into the real cells, through the real rules.
 *
 * The forms are PLURAL per kind because the derivation BRANCHES are the subject. `countSentence` writes three
 * wordings, and the alerts derivation's baseline sentence two. One
 * fixture per kind reads one of them and leaves the rest composing text no gate has seen — the same hole in
 * a smaller place, and the review of this gate's own first commit is what found it. The second thing that
 * review found is why a fixture may IMPORT the function it covers: the day-one `intro` is composed by
 * `../live/automation/firstFiring.ts`'s `defaultIntro`, lands above the fold like everything else, and was read
 * by nothing here until two fixtures called it. A fixture holding a COPY of those lines would have passed
 * while the function said something else.
 *
 * ## Two halves, and only one of them can run everywhere
 *
 * **The STRUCTURAL half runs anywhere**, needs no private configuration, and is a real refusal in CI: every
 * declared kind's fixture must still parse, and must still derive at least one region of prose. A fixture
 * that drifts out of its own schema, or is gutted until it provokes nothing, silently narrows the other half
 * to nothing — so it reddens here rather than going quiet.
 *
 * **The VOICE half needs the operator's private rules**, which live in `$SLOPWEAVER_HOME/profile.json` and
 * never in this repository. On a machine without them the gate says so in one line and exits 0. That is not
 * a hole invented here: `../hygiene/corpusScan.entry.ts` is the standing precedent, and `AGENTS.md`'s
 * toolchain section names the private denylist as the local-only lane for exactly this reason. That half is
 * also why this gate carries `offRepoState` in `./devLint.ts`'s plan and so runs in BOTH lanes: CI cannot
 * see the rules it reads, so the local `pre-push` lane is the only place the voice check exists at all.
 *
 * ## It mirrors the door's refusal boundary rather than inventing a stricter one
 *
 * Above the fold REFUSES and below the fold WARNS, which is what `cli/aboveFoldDoor.ts` already does on a
 * live send. The below-fold half is the rule that voice never hard blocks, and a lint
 * gate is not the place to quietly overturn it. The em dash this gate exists to catch was above the fold,
 * which is the half that refuses.
 *
 * Run it alone: `yarn lint --only derived-card-voice`.
 */
import {
  noFoldAboveFoldCells,
  updateArtifactAboveFoldCells,
  updateArtifactBelowFoldCells,
} from "../outbound/artifact/aboveFold.js";
import { BOT_FORM_KINDS, type BotFormKind } from "../outbound/artifact/botFormKinds.js";
import type { SlackBotArtifact } from "../outbound/artifact/types.js";
import { slackDeliveryErrorLines } from "../outbound/slack/deliveryErrors.js";
import { type AboveFoldCell, aboveFoldFindings, belowFoldFindings } from "../outbound/voice/aboveFold.js";
import type { ExactVoiceRule } from "../outbound/voice/exactRules.js";
import { readProfile } from "../profileStore.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusalLines } from "./refusal/render.js";

/** What the gate found about ONE of a form kind's canonical fixtures. */
export interface DerivedCardJudgement {
  /** The kind's discriminant, as its registry entry declares it. */
  readonly kind: string;
  /**
   * Why the fixture could not be judged at all — a parse violation, or a derivation that produced no prose.
   *
   * Non-empty means the other three fields are empty and say nothing: the gate had nothing to read.
   */
  readonly unjudgeable: readonly string[];
  /** How many prose regions the derived card produced, on both sides of its fold. */
  readonly regions: number;
  /** One line per voice rule that fired ABOVE the fold — the refusing half. */
  readonly refusals: readonly string[];
  /** One line per voice rule that fired BELOW the fold — the warning half. */
  readonly warnings: readonly string[];
}

/**
 * The prose regions one parsed artifact puts on each side of its fold.
 *
 * A no-fold message has no below-fold half and never will — that is what the form IS — so its whole body
 * goes to the above-the-fold rules, which is the strictest treatment any outbound shape gets and correctly
 * so. `../outbound/artifact/aboveFold.ts` owns both walks; this only picks which pair a kind uses.
 */
function cellsOfArtifact({ artifact }: { artifact: SlackBotArtifact }): {
  readonly above: readonly AboveFoldCell[];
  readonly below: readonly AboveFoldCell[];
} {
  if (artifact.kind === "no-fold") {
    return { above: noFoldAboveFoldCells({ artifact }), below: [] };
  }
  return {
    above: updateArtifactAboveFoldCells({ artifact }),
    below: updateArtifactBelowFoldCells({ artifact }),
  };
}

/**
 * Judge one FIXTURE: parse it, derive its card, and run the rules over what the code composed.
 *
 * @param entry the registry row, whose parser this fixture goes through
 * @param fixture one of that row's canonical forms
 * @param at its index in the row, which every line quotes so a finding names the branch it came from
 * @param rules the operator's private exact rules, empty when none are configured
 * @returns what the gate found about this one fixture
 */
function judgeFixture({
  entry,
  fixture,
  at,
  rules,
}: {
  entry: BotFormKind;
  fixture: unknown;
  at: number;
  rules: readonly ExactVoiceRule[];
}): DerivedCardJudgement {
  const where = `${entry.kind}[${String(at)}]`;
  const parsed = entry.parse({ isKnownPerson: () => true, raw: fixture });
  if (parsed.isErr()) {
    return {
      kind: where,
      refusals: [],
      regions: 0,
      unjudgeable: [
        `canonical fixture ${String(at)} no longer parses as a \`${entry.kind}\` form, so nothing could be ` +
          `derived from it`,
        ...slackDeliveryErrorLines({ error: parsed.error }),
      ],
      warnings: [],
    };
  }
  const { above, below } = cellsOfArtifact({ artifact: parsed.value.artifact });
  const regions = above.length + below.length;
  if (regions === 0) {
    return {
      kind: where,
      refusals: [],
      regions,
      unjudgeable: [
        `canonical fixture ${String(at)} derives NO prose at all, so it contributes nothing to the scan — a ` +
          `fixture is the smallest form that makes one branch of the derivation mint every sentence it mints`,
      ],
      warnings: [],
    };
  }
  return {
    kind: where,
    refusals: aboveFoldFindings({ cells: above, rules }).map((finding) => `${finding.path}: ${finding.message}`),
    regions,
    unjudgeable: [],
    warnings: belowFoldFindings({ cells: below, rules }).map((finding) => `${finding.path}: ${finding.message}`),
  };
}

/**
 * Judge one kind: every canonical fixture it declares, in the order it declares them.
 *
 * One judgement per FIXTURE rather than per kind, because the derivation branches are the subject and a
 * merged verdict would let a clean branch mask a dirty one in the counts the gate reports.
 *
 * @param entry the registry row, carrying both the parser and its canonical forms
 * @param rules the operator's private exact rules, empty when none are configured
 * @returns what the gate found about each of this kind's fixtures
 */
export function judgeDerivedCard({
  entry,
  rules,
}: {
  entry: BotFormKind;
  rules: readonly ExactVoiceRule[];
}): readonly DerivedCardJudgement[] {
  return entry.fixtures.map((fixture, at) => judgeFixture({ at, entry, fixture, rules }));
}

/**
 * Judge every declared kind's every declared fixture, in registry order.
 *
 * @param kinds the declared form kinds — the real registry, or a test's own
 * @param rules the operator's private exact rules, empty when none are configured
 * @returns one judgement per FIXTURE, flattened, so a kind with three branches contributes three
 */
function judgeDerivedCards({
  kinds,
  rules,
}: {
  kinds: readonly BotFormKind[];
  rules: readonly ExactVoiceRule[];
}): readonly DerivedCardJudgement[] {
  return kinds.flatMap((entry) => judgeDerivedCard({ entry, rules }));
}

/**
 * Report every fixture the gate could not judge, and say whether that is the ending.
 *
 * Split out of {@link checkDerivedCardVoice} rather than inlined, because it is the STRUCTURAL half and it
 * refuses on a different declaration from the voice half — two endings in one body is what put that function
 * over the complexity ceiling.
 *
 * @param judgements one judgement per declared kind
 * @param declared how many fixtures were judged in all, which the refusal's detail line reports against
 * @param writeError the stderr sink
 * @returns true when a fixture was unjudgeable, so the caller must stop
 */
function reportUnjudgeable({
  judgements,
  declared,
  writeError,
}: {
  judgements: readonly DerivedCardJudgement[];
  declared: number;
  writeError: (text: string) => void;
}): boolean {
  const unjudgeable = judgements.filter((judgement) => judgement.unjudgeable.length > 0);
  for (const judgement of unjudgeable) {
    for (const line of judgement.unjudgeable) {
      writeError(`derived-card-voice: ${judgement.kind}: ${line}\n`);
    }
  }
  if (unjudgeable.length === 0) {
    return false;
  }
  const detail = `${String(unjudgeable.length)} of ${String(declared)} declared fixture(s)`;
  const declaration = lintDeclarationFor({ id: "derived-card-fixture" });
  for (const line of lintGateRefusalLines({ declaration, detail })) {
    writeError(`${line}\n`);
  }
  return true;
}

/**
 * Print every finding, warnings to stdout and above-the-fold refusals to stderr, and hand back the refusals.
 *
 * The two go to different channels because they have different force: the door this gate mirrors REFUSES
 * above the fold and only WARNS below it (voice never hard blocks), so a
 * below-fold finding must not be able to redden a push.
 *
 * @param judgements one judgement per declared kind
 * @param writeOut the stdout sink, which carries the warnings
 * @param writeError the stderr sink, which carries the refusals
 * @returns each above-the-fold finding, prefixed with the kind that derived it
 */
function reportFindings({
  judgements,
  writeOut,
  writeError,
}: {
  judgements: readonly DerivedCardJudgement[];
  writeOut: (text: string) => void;
  writeError: (text: string) => void;
}): readonly string[] {
  for (const judgement of judgements) {
    for (const warning of judgement.warnings) {
      writeOut(`derived-card-voice: warning: ${judgement.kind} below the fold, ${warning}\n`);
    }
  }
  const refused = judgements.flatMap((judgement) =>
    judgement.refusals.map((refusal) => `${judgement.kind}: ${refusal}`),
  );
  for (const refusal of refused) {
    writeError(`derived-card-voice: ${refusal}\n`);
  }
  return refused;
}

/**
 * The pure core: judge the registry, report it, and return the exit code.
 *
 * `rules` and `rulesAvailable` are separate arguments rather than one nullable list, because an operator
 * whose profile exists and configures NO rules is a different state from one with no profile at all, and a
 * gate that collapsed them would report "did not run" to somebody who had run it.
 *
 * @param kinds the declared form kinds
 * @param rules the operator's private exact rules
 * @param rulesAvailable whether a profile was found at all, which decides whether the voice half ran
 * @param writeOut the stdout sink
 * @param writeError the stderr sink
 * @returns the process exit code
 */
export function checkDerivedCardVoice({
  kinds,
  rules,
  rulesAvailable,
  writeOut,
  writeError,
}: {
  kinds: readonly BotFormKind[];
  rules: readonly ExactVoiceRule[];
  rulesAvailable: boolean;
  writeOut: (text: string) => void;
  writeError: (text: string) => void;
}): number {
  const judgements = judgeDerivedCards({ kinds, rules });
  if (reportUnjudgeable({ declared: judgements.length, judgements, writeError })) {
    return 1;
  }
  const refused = reportFindings({ judgements, writeError, writeOut });
  const outcome = gateOutcome({ refused: refused.length, unseen: rulesAvailable ? 0 : kinds.length });
  if (outcome === "refused") {
    const detail =
      `${String(refused.length)} above-the-fold violation(s) across ${String(judgements.length)} fixture(s) ` +
      `of ${String(kinds.length)} kind(s)`;
    const declaration = lintDeclarationFor({ id: "derived-card-voice" });
    for (const line of lintGateRefusalLines({ declaration, detail })) {
      writeError(`${line}\n`);
    }
    return 1;
  }
  const regions = judgements.reduce((total, judgement) => total + judgement.regions, 0);
  if (outcome === "incomplete") {
    // devlint: not-a-refusal -- the operator's rule list lives off-repo, so on a machine without one the
    // gate has no rules to judge with and a FACT to report; the structural half above did run and passed
    writeOut(
      `derived-card-voice: structural half CLEAN (${String(kinds.length)} kind(s), ${String(judgements.length)} ` +
        `fixture(s), ${String(regions)} derived ` +
        `region(s)); voice half DID NOT RUN — no operator profile under $SLOPWEAVER_HOME, where the private ` +
        `rule list lives. Push from a machine that has one.\n`,
    );
    return 0;
  }
  writeOut(
    `derived-card-voice: clean (${String(kinds.length)} kind(s), ${String(judgements.length)} fixture(s), ` +
      `${String(regions)} derived region(s), ` +
      `${String(rules.length)} operator rule(s) applied)\n`,
  );
  return 0;
}

/**
 * Load the operator's private rules from `home` and run {@link checkDerivedCardVoice} over the real registry.
 *
 * No profile leaves the voice half unrun, which the gate reports as incomplete. A profile that is there but
 * corrupt is not that: judging against its empty rule list would call every fixture clean, so the gate stops
 * with the profile's path and exits 1 without judging anything.
 *
 * @param home the state home whose `profile.json` carries the rules
 * @param writeError where the refusal and findings go
 * @param writeOut where the verdict line goes
 * @returns the process exit code
 */
export function runDerivedCardVoice({
  home,
  writeError,
  writeOut,
}: {
  home: string;
  writeError: (text: string) => void;
  writeOut: (text: string) => void;
}): number {
  const profile = readProfile({ home });
  if (profile.isErr()) {
    // devlint: not-a-refusal -- a profile that cannot be parsed is a FACT about this machine's install, not a
    // rule catching a fixture; the gate names it and judges nothing rather than calling every card clean
    writeError(`derived-card-voice: ${profile.error.message}. No fixture was judged.\n`);
    return 1;
  }
  return checkDerivedCardVoice({
    kinds: BOT_FORM_KINDS,
    rules: profile.value === null ? [] : profile.value.slackMe.voice.exact,
    rulesAvailable: profile.value !== null,
    writeError,
    writeOut,
  });
}
