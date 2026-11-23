/**
 * Whether a Claude session may take a turn, judged from the credential it BOOTED on — the spawn half of the billing-account rule:
 * fail to start a session, or even fail a turn, on the wrong billing account or in the wrong state, loudly and with
 * an escape hatch.
 *
 * ## The signal is positive attestation, not a metered classifier
 *
 * The METERED signal reads telemetry rather than the environment, because a `/login` onto a Console organisation sets
 * no variable. This asks the opposite question: was this session booted on one of the owner's configured plans? A `/login`,
 * Console or plan, lands in the default store, and a session booted with no token descriptor and no store IS on that
 * store — so the incident of a wrong-account login reads `off-plan` here, before a single request, with no telemetry to wait
 * for. `./seatBoot.ts` is the reading, the one `claude gauge` and the chair cadence already trust. The chair's
 * telemetry gate (`../supervisor/chairMetered.ts`) stays: it is what sees a login INSIDE a plan-store seat.
 *
 * ## Only a positive reading refuses
 *
 * `unresolved` — a `ps` that failed, a pid another process now holds, a token two plans share — passes. A gate that
 * refused on its own blindness would get its hatch exported for good, which is the reasoning
 * `../supervisor/chairMetered.ts` § Unmeasured prints, it does not refuse already carries.
 *
 * Pure: `./seatAttestRead.ts` is the effectful edge, `../cli/commands/claude/seatRun.ts` the verb and hook.
 */
import type { ClaudeAmbientCredential } from "./ambientCredential.js";
import type { ClaudeAccountAlias } from "./contracts.js";
import type { SeatBootPlan } from "./seatBoot.js";

/** What the boot-credential read established about one session, before the judgement. */
export type SeatReading =
  /** This install registers no Claude destination at all, so there is no plan to be off. */
  | { readonly kind: "unconfigured" }
  /** The session, or the register, could not be read; `why` says which. */
  | { readonly kind: "unread"; readonly why: string }
  /**
   * The session's own boot credential, read and bound to its process. `process` is the registry's pid and recorded
   * start, present only when the registry recorded a start: it is what keys a cached pass (`./seatPass.ts`).
   */
  | {
      readonly kind: "read";
      readonly plan: SeatBootPlan;
      readonly process?: { readonly pid: number; readonly procStart: string };
    };

/** Whether the session may take this turn. */
export type SeatVerdict =
  /** Booted on a configured plan. */
  | { readonly kind: "on-plan"; readonly alias: ClaudeAccountAlias; readonly how: "token" | "store" }
  /** An Anthropic-issued credential outranks every store: this session bills a Console organisation per token. */
  | { readonly kind: "metered"; readonly why: string }
  /** Booted on the default login, or a store no plan names. Never a setup token: that is always a subscription. */
  | { readonly kind: "off-plan"; readonly why: string }
  /** Nothing to judge against, or nothing readable to judge — never refused. */
  | { readonly kind: "unmeasured"; readonly why: string };

/**
 * Judge one session.
 *
 * The ambient credential is checked FIRST: an API key outranks every store (`../../docs/api-key-lane.md` § 1), so a
 * session booted on a plan's token still bills a Console organisation under one.
 *
 * @param ambient what the session's environment presents ahead of any store
 * @param reading what its boot credential read found
 * @returns whether it may take the turn, and why not
 */
export function judgeSeat({
  ambient,
  reading,
}: {
  ambient: ClaudeAmbientCredential;
  reading: SeatReading;
}): SeatVerdict {
  if (ambient.kind === "shadowed") {
    return { kind: "metered", why: ambient.reason };
  }
  if (reading.kind === "unconfigured") {
    return { kind: "unmeasured", why: "this install registers no Claude plan, so there is no plan to be off" };
  }
  if (reading.kind === "unread") {
    return { kind: "unmeasured", why: reading.why };
  }
  const { plan } = reading;
  if (plan.kind === "unresolved") {
    return { kind: "unmeasured", why: plan.why };
  }
  if (plan.kind === "off-plan") {
    return { kind: "off-plan", why: plan.why };
  }
  return { alias: plan.alias, how: plan.kind, kind: "on-plan" };
}

/** A verdict that refuses the turn. */
export type RefusingSeatVerdict = Extract<SeatVerdict, { kind: "metered" | "off-plan" }>;

/**
 * Whether a verdict refuses the turn.
 *
 * @param verdict the session's verdict
 * @returns true for a metered or off-plan session
 */
export function refusesTurn(verdict: SeatVerdict): verdict is RefusingSeatVerdict {
  return verdict.kind === "metered" || verdict.kind === "off-plan";
}

/**
 * The one line a verdict prints, by hand or beside a refusal.
 *
 * @param verdict the session's verdict
 * @returns the line, naming the plan, or what the session is on instead
 */
export function seatVerdictLine({ verdict }: { verdict: SeatVerdict }): string {
  switch (verdict.kind) {
    case "on-plan": {
      const how = verdict.how === "token" ? "its setup token" : "its own store";
      return `claude seat: ON ${verdict.alias}, booted on ${how}`;
    }
    case "metered":
      return `claude seat: METERED — ${verdict.why}`;
    case "off-plan":
      return `claude seat: OFF every configured plan — ${verdict.why}`;
    case "unmeasured":
      return `claude seat: UNMEASURED — ${verdict.why}`;
    default: {
      const unreachable: never = verdict;
      return unreachable;
    }
  }
}

/** The exact command that signs the default store out, whatever store the shell it runs in names. */
export const DEFAULT_LOGOUT_COMMAND = "env -u CLAUDE_SECURESTORAGE_CONFIG_DIR claude auth logout";

/**
 * What to do about a refused session, printed after the four-line refusal.
 *
 * @param verdict the refused session's verdict
 * @returns the remedy lines
 */
export function seatRemedyLines({ verdict }: { verdict: RefusingSeatVerdict }): readonly string[] {
  if (verdict.kind === "metered") {
    return [
      "remedy: unset the credential named above (or remove `apiKeyHelper` from Claude Code's settings) and relaunch;",
      "`slopweaver claude route --model <model>` names anything in the environment that shadows the plan stores.",
    ];
  }
  // `cmux reseat` leads because the commonest off-plan seat is one cmux restored with no credential, and a spawn
  // cannot resume it. The logout is fenced off from that case: run there, it deleted the shared
  // `oauthAccount` in `~/.claude.json` and every session's telemetry lost its identity.
  return [
    "remedy: from any cmux tab (a plain shell too), `slopweaver cmux reseat <workspace>` relaunches THIS session",
    "with --resume on a plan's setup token; `slopweaver cmux spawn <slug> --model <model>` boots a fresh seat.",
    `Only a stray \`/login\` in the default store is signed out, with \`${DEFAULT_LOGOUT_COMMAND}\` — never after a restore.`,
  ];
}
