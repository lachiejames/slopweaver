/**
 * What `handover pause` and `handover unpause` were asked to do — the option-parsing half of `./pauseRun.ts`,
 * pure, so every refusal and every stated default is checkable without a board on disk.
 *
 * Two flags carry a default, and each is named where it is read: `--since` is the moment the pause is
 * recorded, and `--status` is `ready`, the state a row waiting on nobody returns to.
 */

import type { KnownDocStatus } from "../../../handover/doc.js";

/** The two statuses a row may be unpaused INTO — the live ones a resumed workstream can honestly claim. */
const UNPAUSE_STATUSES: readonly KnownDocStatus[] = ["ready", "in-progress"];

/**
 * A flag's value as a trimmed string. A blank value is treated exactly as an absent one, because a pause
 * recorded on `--on "  "` names nobody.
 *
 * @param values the parsed flag values
 * @param name the flag's name, without its leading `--`
 * @returns the trimmed value, or `undefined` when it was not given or was blank
 */
export function pauseFlag({
  values,
  name,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
}): string | undefined {
  const value = values[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

/**
 * Why a value cannot be written into front-matter, or `undefined` when it can.
 *
 * The flat front-matter reader is line-based, so a newline inside a scalar silently becomes a new key — the
 * quiet corruption `../../../handover/doc.ts`'s duplicate-key reporting exists to make loud. Refusing here is
 * cheaper than reporting it afterwards.
 */
function unwritable({ label, value }: { label: string; value: string }): string | undefined {
  return value.includes("\n") ? `${label} cannot contain a line break — front-matter is read line by line` : undefined;
}

/** When the pause began: `--since` as given, or — not given — the moment this pause is being recorded. */
function pauseSince({ values, nowIso }: { values: Readonly<Record<string, unknown>>; nowIso: string }): string {
  const given = pauseFlag({ name: "since", values });
  if (given === undefined) {
    return nowIso;
  }
  return given;
}

/** The status word an unpause asked for: `--status` as given, or — not given — `ready`. */
function requestedStatus({ values }: { values: Readonly<Record<string, unknown>> }): string {
  const given = pauseFlag({ name: "status", values });
  if (given === undefined) {
    return "ready";
  }
  return given;
}

/**
 * What `handover pause` was asked to do, or the usage refusal to print instead.
 *
 * @param positionals the parsed positionals, whose first is the row's slug
 * @param values the parsed flag values
 * @param nowIso the instant the pause is recorded at, used when `--since` is not given
 * @returns the plan, or the one refusal
 */
export function pausePlan({
  positionals,
  values,
  nowIso,
}: {
  positionals: readonly string[];
  values: Readonly<Record<string, unknown>>;
  nowIso: string;
}):
  | { readonly refusal: string }
  | {
      readonly slug: string;
      readonly who: string;
      readonly why: string | undefined;
      readonly since: string;
    } {
  const slug = positionals[0];
  if (slug === undefined) {
    return { refusal: "which row? Pass its slug" };
  }
  const who = pauseFlag({ name: "on", values });
  if (who === undefined) {
    return { refusal: "--on is required — a pause with nobody named is the parking this state replaced" };
  }
  const why = pauseFlag({ name: "why", values });
  const since = pauseSince({ nowIso, values });
  const bad = [
    unwritable({ label: "--on", value: who }),
    why === undefined ? undefined : unwritable({ label: "--why", value: why }),
    Number.isNaN(Date.parse(since)) ? `--since "${since}" is not an instant` : undefined,
  ].find((problem) => problem !== undefined);
  return bad === undefined ? { since, slug, who, why } : { refusal: bad };
}

/**
 * The front-matter a pause writes, in the order it is spliced.
 *
 * @param who the person or party the row waits on
 * @param since when the pause began
 * @param why what is being waited for, written to `statusSummary:` when given
 * @returns the fields to set
 */
export function pauseFields({
  who,
  since,
  why,
}: {
  who: string;
  since: string;
  why: string | undefined;
}): readonly { readonly key: string; readonly value: string }[] {
  return [
    { key: "status", value: "paused" },
    { key: "pausedOn", value: who },
    { key: "pausedSince", value: since },
    ...(why === undefined ? [] : [{ key: "statusSummary", value: why }]),
  ];
}

/**
 * What `handover unpause` was asked to do, or the usage refusal to print instead.
 *
 * @param positionals the parsed positionals, whose first is the row's slug
 * @param values the parsed flag values
 * @returns the plan, or the one refusal
 */
export function unpausePlan({
  positionals,
  values,
}: {
  positionals: readonly string[];
  values: Readonly<Record<string, unknown>>;
}):
  | { readonly refusal: string }
  | { readonly slug: string; readonly status: KnownDocStatus; readonly why: string | undefined } {
  const slug = positionals[0];
  if (slug === undefined) {
    return { refusal: "which row? Pass its slug" };
  }
  const asked = requestedStatus({ values });
  const status = UNPAUSE_STATUSES.find((known) => known === asked);
  if (status === undefined) {
    return { refusal: `--status must be ${UNPAUSE_STATUSES.join(" or ")}` };
  }
  const why = pauseFlag({ name: "why", values });
  const bad = why === undefined ? undefined : unwritable({ label: "--why", value: why });
  return bad === undefined ? { slug, status, why } : { refusal: bad };
}
