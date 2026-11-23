/**
 * The model a spawn pins, and the two refusals that make `--model` impossible to forget.
 *
 * Pure: an already-parsed `--model`, the hook process's environment and one already-read `statusSummary:`
 * in; a refusal or an advisory sentence out. The effectful half is `cli/commands/cmux/run.ts`, which prints
 * them and stops.
 *
 * ## Why `--model` is required, and why `fable` throws
 *
 * Measured: `~/.claude/settings.json` had
 * carried `model: fable[1m]`, so every `cmux spawn` that omitted `--model` — which was
 * every spawn, because the flag was optional and its absence only WARNED — booted onto Fable. Most of the
 * live sessions were on it, it was about half of that day's list-price spend at twice Opus's rate, and
 * several accounts hit their session limit within a day. The rule: `--model` is a required field on spawn, so a
 * spawn can never default to Fable; `--model fable` throws by default, and when Fable IS the right tool the
 * spawn re-runs with `ALLOW_FABLE_OVERRIDE`, which makes the path of least resistance the safe one.
 *
 * An earlier version of this module warned instead of refusing, reasoning that a tier named in a doc's prose
 * is a hint the supervisor may overrule. That reasoning survives as {@link modelTierAdvisory}: the doc's
 * prose is still advice. What was wrong was letting the ABSENCE of a pin through, because the thing it fell
 * back to was never a decision anyone made.
 *
 * `statusSummary:` and nothing else, deliberately. `summary:` is the stable "what is this work" and routinely
 * quotes the owner verbatim, so scanning it would fire on a tier named inside a quotation about something
 * else entirely. `statusSummary:` is the field whose whole job is to say what an agent needs before acting.
 */

import { ambientHatchOpen } from "../hatch/open.js";
import type { VisibleSessionHost } from "../supervisor/session.js";

/** The model tiers a doc can name in prose. Tiers, never dated ids — a doc says "Sonnet-sized", not a model id. */
export type NamedTier = "fable" | "haiku" | "opus" | "sonnet";

/** Every tier this scanner knows, in the order it reports them when a doc names more than one. */
const TIERS: readonly NamedTier[] = ["opus", "sonnet", "haiku", "fable"];

/**
 * The break-glass that lets a spawn pin Fable. Its name is fixed, so the refusal's re-run line is the
 * one the owner types; read from the spawning process's own environment. The register's `fable-worker` row carries
 * the same name, and {@link fableOverrideOpen} asks that row rather than reading this constant.
 */
export const FABLE_OVERRIDE_ENV = "ALLOW_FABLE_OVERRIDE";

/**
 * Whether the `fable-worker` escape hatch is open in one environment — the one read both `cmux spawn` and a
 * worker reseat make, so neither spells its own `=== "1"`.
 *
 * @param env the spawning or reseating process's environment
 * @returns true only when {@link FABLE_OVERRIDE_ENV} is exactly `1`
 */
export function fableOverrideOpen({ env }: { env: Readonly<Record<string, string | undefined>> }): boolean {
  return ambientHatchOpen({ env, id: "fable-worker" });
}

/**
 * Every model tier a piece of prose names, deduplicated, in {@link TIERS} order.
 *
 * Word-bounded and case-insensitive, so "Sonnet-sized" and "opus" both match while a word that merely
 * contains one does not. Returns every match rather than picking one: a doc that names two tiers has not
 * decided, and a scanner that silently chose the first would report a decision nobody made.
 *
 * @param text the prose to scan
 * @returns the tiers named, in {@link TIERS} order
 */
export function namedTiers({ text }: { text: string }): readonly NamedTier[] {
  return TIERS.filter((tier) => new RegExp(`\\b${tier}\\b`, "i").test(text));
}

/**
 * Whether a `--model` value names the Fable tier — `fable`, `fable[1m]`, a dated `claude-fable-…` id.
 *
 * @returns true when it boots Fable
 */
export function isFableModel({ model }: { model: string }): boolean {
  return /\bfable\b/i.test(model);
}

/**
 * The reasoning effort every Opus spawn default pins on its boot line.
 *
 * Explicit because the saved default does not reach a spawn: MEASURED over the trajectory `turns` table,
 * every effort-recording session on `claude-opus-5-5` (dozens) ran at `medium` with no `--effort`,
 * despite `effortLevel: "high"` in `~/.claude/settings.json`, while every one on `claude-opus-5` (dozens
 * more) ran at `high`. An Opus seat rebases, lands or investigates (rule 5), which `model-tiering.md` pins at `high`.
 * Repro: `skills/supervisor/reference/model-tiering.md` § effort carries the query.
 */
export const OPUS_SPAWN_EFFORT = "high";

/**
 * Whether a `--model` value names the Opus tier — `opus`, a dated `claude-opus-…` id.
 *
 * @returns true when it boots Opus
 */
export function isOpusModel({ model }: { model: string }): boolean {
  return /\bopus\b/i.test(model);
}

/**
 * The `--effort` a spawn onto `model` pins, or `undefined` when it pins none.
 *
 * Only an Opus model on a Claude Code host gets {@link OPUS_SPAWN_EFFORT}: a Sonnet leaf keeps Claude Code's own
 * default, and a `codex` host has no `--effort` at all — `cmux spawn` refuses one there, and `bootLine`
 * never renders it.
 *
 * @param model the model tier or id the spawn pins
 * @param host which model CLI boots the session
 * @returns the effort level, or `undefined` for no flag
 */
export function opusSpawnEffort({ model, host }: { model: string; host: VisibleSessionHost }): string | undefined {
  if (host !== "claude-code" || !isOpusModel({ model })) {
    return undefined;
  }
  return OPUS_SPAWN_EFFORT;
}

/**
 * Why a spawn must not proceed with the `--model` it was (not) given, or `undefined` when it may.
 *
 * Two refusals. No `--model` at all: there is no default to fall back to, because the saved default is what
 * put the whole fleet on Fable. `--model fable` without {@link FABLE_OVERRIDE_ENV}: a fixed error text.
 *
 * @param model the `--model` value, or `undefined` when the flag was omitted
 * @param env the spawning process's environment, for the override
 * @param slug the doc's slug, for the re-run line
 * @returns the refusal sentence, or `undefined` when the pin stands
 */
export function spawnModelRefusal({
  model,
  env,
  slug,
}: {
  model: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
  slug: string;
}): string | undefined {
  if (model === undefined || model.trim().length === 0) {
    return (
      `--model is required: a spawn with no pin boots onto the launching user's saved default, which is how ` +
      `every session on this machine ended up on Fable. Opus for anything that rebases, resolves ` +
      `conflicts, lands a PR or investigates; sonnet for a mechanical leaf; fable roughly one in twenty, for a ` +
      `deep investigation. Re-run: slopweaver cmux spawn ${slug} --model <opus|sonnet>`
    );
  }
  if (isFableModel({ model }) && !fableOverrideOpen({ env })) {
    return (
      `use the right tool for the job, but if this is one of those few instances where fable is the right tool ` +
      `for the job, then re-run with \`${FABLE_OVERRIDE_ENV}=1 slopweaver cmux spawn ${slug} --model fable\``
    );
  }
  return undefined;
}

/**
 * The advisory to print when the doc's `statusSummary:` names a tier and the spawn pinned a different one.
 *
 * Advice, never a refusal: `statusSummary:` is free-form English written for a human, and "Opus-sized for the
 * design" is something the supervisor may knowingly overrule today. What it must not do is pass unread.
 *
 * @param statusSummary the doc's own `statusSummary:`, or `undefined` when it declares none
 * @param model the `--model` value the spawn pinned
 * @param slug the doc's slug, for the sentence
 * @returns the advisory sentence, or `undefined` when the pin matches or the doc names no tier
 */
export function modelTierAdvisory({
  statusSummary,
  model,
  slug,
}: {
  statusSummary: string | undefined;
  model: string;
  slug: string;
}): string | undefined {
  if (statusSummary === undefined) {
    return undefined;
  }
  const tiers = namedTiers({ text: statusSummary });
  if (tiers.length === 0 || tiers.some((tier) => new RegExp(`\\b${tier}\\b`, "i").test(model))) {
    return undefined;
  }
  return (
    `${slug}'s statusSummary names ${tiers.join(" and ")} but this spawn pins ${model}; the doc's prose is ` +
    `advice, so this proceeds — re-run with --model <tier> if the doc was right.`
  );
}
