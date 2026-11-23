/**
 * The gate a card the owner reads meets when it asks them to sign in to Datadog or GitHub: those two walls are the
 * fleet's to press through, so a card may ask only once a fresh look reached a step that is genuinely the owner's.
 *
 * The rule: the fleet can always click the buttons and do the sign in, for Datadog and GitHub. The incident it
 * answers: a seat's Queue card read "Sign in to Datadog in the work Chrome …" and stopped work the owner had asked
 * for, while no browser had been opened at all — its real blocker was an expired Google application-default
 * credential, relabelled — and the console read signed in the moment anything looked.
 *
 * So the look is the gate's evidence. `slopweaver browser sign-in --provider <p>` writes a row to the probe ledger
 * (`../browser/signInProbeStore.ts`); a card naming the provider passes only when that provider's NEWEST row says
 * the owner's hands are needed and is under {@link FRESH_PROBE_MS} old. A `signed-in` row means the blocker is something else; a
 * `pressable` row means the fleet presses first.
 *
 * Which sentences count: a sign-in sentence (`../hand/decision.ts`'s phrasing) whose OBJECT is Datadog or GitHub —
 * "sign in to Datadog", "your GitHub SSO", "Datadog wants a sign-in". "Sign in to Google Cloud so the Datadog stack
 * boots" asks for a Google credential and passes. The residue, stated: a sign-in sentence that names the provider
 * some other way gets past, because a phrase list is a tripwire, never a parser.
 *
 * Pure: the texts, the ledger's rows, the clock and the environment in, a verdict out.
 */

import { SIGN_IN_PROVIDERS, type SignInProvider } from "../browser/signInPress.js";
import type { SignInProbeRow } from "../browser/signInProbeStore.js";
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";

/**
 * The environment variable that records a card this gate refuses.
 *
 * A LITERAL rather than `hatchEnvVar({ suffix })`: `escape-hatch` in `yarn lint` checks that a row's named reader
 * mentions its own key, and a name assembled at runtime is one no static scan can see.
 */
export const FLEET_SIGN_IN_CARD_HATCH = "SLOPWEAVER_ALLOW_FLEET_SIGN_IN_CARD";

/** How old a look that found the owner's hands needed may be and still stand behind a card: past it the wall may have cleared or moved. */
const FRESH_PROBE_MS = 30 * 60 * 1000;

/** How each provider is written in prose. */
const PROVIDER_WORD: Readonly<Record<SignInProvider, string>> = { datadog: "Datadog", github: "GitHub" };

/** A sign-in verb, as `../hand/decision.ts` reads one. */
const VERB = String.raw`(?:sign|log)(?:ging|ing)?[-\s]?(?:in|on|into)|re-?authenticat(?:e|ing)|authenticat(?:e|ing)`;

/** A sign-in noun. */
const NOUN = String.raw`sign[-\s]?in|log[-\s]?in|sso|single sign-on|re-?auth(?:entication)?|session`;

/**
 * The phrasings that make a provider the OBJECT of a sign-in, for one provider word.
 *
 * @returns the patterns, each case-insensitive
 */
function objectPatterns({ word }: { word: string }): readonly RegExp[] {
  return [
    // "sign in to Datadog", "log back into the GitHub", "authenticate with Datadog"
    new RegExp(
      String.raw`\b(?:${VERB})(?:\s+back)?(?:\s+(?:in\s+)?(?:to|into|at|on|with))?\s+(?:the\s+|your\s+)?${word}\b`,
      "i",
    ),
    // "your Datadog sign-in", "GitHub SSO", "the Datadog login"
    new RegExp(String.raw`\b${word}(?:'s)?\s+(?:${NOUN})\b`, "i"),
    // "Datadog in the work Chrome wants a sign-in"
    new RegExp(
      String.raw`\b${word}\b[^.?!\n]{0,60}?\b(?:wants|needs|asks for|requires|is waiting on)\s+(?:a\s+|your\s+|his\s+)?(?:${NOUN})\b`,
      "i",
    ),
    // "SSO to GitHub", "single sign-on for GitHub"
    new RegExp(String.raw`\b(?:${NOUN})\s+(?:to|for|into)\s+(?:the\s+)?${word}\b`, "i"),
  ];
}

/**
 * Every provider a text asks the owner to sign in to.
 *
 * @param text the card's texts, joined as the owner reads them
 * @returns each provider named as a sign-in's object, in register order
 */
export function fleetSignInProviders({ text }: { text: string }): readonly SignInProvider[] {
  return SIGN_IN_PROVIDERS.filter((provider) =>
    objectPatterns({ word: PROVIDER_WORD[provider] }).some((pattern) => pattern.test(text)),
  );
}

/** Why one named provider's card is not yet the owner's to receive. */
type Unbacked = { readonly provider: SignInProvider; readonly because: string };

/**
 * Judge one provider against its newest look.
 *
 * @returns `undefined` when a fresh look reached the owner's hands, else why the card is refused
 */
function unbacked({
  provider,
  probes,
  nowMs,
}: {
  provider: SignInProvider;
  probes: readonly SignInProbeRow[];
  nowMs: number;
}): Unbacked | undefined {
  const newest = probes.findLast((row) => row.provider === provider);
  const look = `slopweaver browser sign-in --provider ${provider}`;
  if (newest === undefined) {
    return { because: `no look stands behind it — run \`${look}\` first`, provider };
  }
  const ageMs = nowMs - Date.parse(newest.atIso);
  if (ageMs > FRESH_PROBE_MS) {
    return {
      because: `the newest look is from ${newest.atIso}, too old to stand behind a card — run \`${look}\` again`,
      provider,
    };
  }
  if (newest.verdict === "signed-in") {
    return {
      because: `the look at ${newest.atIso} read it SIGNED IN (${newest.why}), so whatever is blocking is not this sign-in`,
      provider,
    };
  }
  if (newest.verdict === "pressable") {
    return { because: `the look at ${newest.atIso} found a wall the fleet presses itself: ${newest.why}`, provider };
  }
  return undefined;
}

/**
 * Why a sign-in card for one provider may not reach the owner yet — the gate's per-provider judgement, for a writer that
 * knows the provider from a page rather than from prose (the `resync-signed-out` monitor).
 *
 * @param provider the provider the card would ask the owner to sign in to
 * @param probes every row of the sign-in probe ledger, in written order
 * @param nowIso the instant the card would be raised at
 * @returns `undefined` when a fresh look reached the owner's hands, else why the card waits on the fleet
 */
export function unbackedSignInCard({
  provider,
  probes,
  nowIso,
}: {
  provider: SignInProvider;
  probes: readonly SignInProbeRow[];
  nowIso: string;
}): string | undefined {
  return unbacked({ nowMs: Date.parse(nowIso), probes, provider })?.because;
}

/** What a verb should do with the texts it was handed. */
export type FleetSignInVerdict =
  | { readonly kind: "ok" }
  /** Not recordable. `lines` is whole — the caller prints it and adds nothing. */
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/**
 * The verdict on the texts a card draws, read together as the owner reads the card, with the hatch applied.
 *
 * @param texts every text the card draws
 * @param probes every row of the sign-in probe ledger, in written order
 * @param nowIso the instant the card would be recorded at
 * @param command the door being refused, as the owner would type it
 * @param env the process environment, for the hatch
 * @returns `ok`, or the whole refusal to print
 */
export function fleetSignInVerdict({
  texts,
  probes,
  nowIso,
  command,
  env,
}: {
  texts: readonly string[];
  probes: readonly SignInProbeRow[];
  nowIso: string;
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): FleetSignInVerdict {
  const named = fleetSignInProviders({ text: texts.join("\n") });
  if (named.length === 0 || env[FLEET_SIGN_IN_CARD_HATCH] === "1") {
    return { kind: "ok" };
  }
  const nowMs = Date.parse(nowIso);
  const refusals = named.flatMap((provider) => {
    const one = unbacked({ nowMs, probes, provider });
    return one === undefined ? [] : [one];
  });
  if (refusals.length === 0) {
    return { kind: "ok" };
  }
  const hatch = { ...hatchFor({ id: "fleet-sign-in-card" }), command };
  return {
    kind: "refused",
    lines: [
      hatchRefusal({ hatch }),
      ...refusals.map((one) => `  - ${PROVIDER_WORD[one.provider]}: ${one.because}`),
      "NOTHING was recorded and the run is not paused. Press the wall with `browser sign-in`, then carry on, or card " +
        "only the step its look says is the owner's.",
    ],
  };
}
