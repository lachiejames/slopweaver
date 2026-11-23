/*
 * What the `planSignin` test files share: a live gauge, a configured account, an enrollment assertion, the
 * no-login probe problem, and the healthy and emptied store readings. They moved here when the sign-in plan's
 * tests were split by behaviour.
 */
import type { ClaudeAccount, ClaudeAccountGauge, ClaudeWindowReading } from "../../../../claude/contracts.js";
import type { StoreLife } from "../../../../claude/credentialRepair.js";
import type { ClaudeIdentityAssertion } from "../../../../claude/identityAssertions.js";

const RESET = "2026-09-16T03:00:00.000Z";

const window = ({
  status = "allowed",
  utilization,
}: {
  status?: ClaudeWindowReading["status"];
  utilization: number;
}): ClaudeWindowReading => ({ resetAtIso: RESET, status, utilization });

/**
 * A live usage reading for one store, its five-hour window fixed at 47% and its week at 10% unless named.
 *
 * @param fable the weekly Fable utilisation, omitted from the gauge when not given
 * @returns the gauge, observed at one fixed instant
 */
export const gauge = ({
  alias,
  fable,
  sevenDay = 0.1,
  sevenDayStatus = "allowed",
}: {
  alias: string;
  fable?: number;
  sevenDay?: number;
  sevenDayStatus?: ClaudeWindowReading["status"];
}): ClaudeAccountGauge => ({
  alias,
  fiveHour: window({ utilization: 0.47 }),
  observedAtIso: "2026-09-09T04:39:58.856Z",
  sevenDay: window({ status: sevenDayStatus, utilization: sevenDay }),
  ...(fable === undefined ? {} : { sevenDayFable: window({ utilization: fable }) }),
});

/**
 * A configured plan with no address of its own.
 *
 * @returns the account, its store directory derived from the alias
 */
export const account = ({ alias }: { alias: string }): ClaudeAccount => ({
  alias,
  storeDir: `/stores/${alias}`,
});

/**
 * An enrollment record binding a store to an organisation, and to an address when one is named.
 *
 * @returns the assertion, made at one fixed instant
 */
export const assertion = ({
  alias,
  email,
  organizationId,
}: {
  alias: string;
  email?: string;
  organizationId: string;
}): ClaudeIdentityAssertion => ({
  alias,
  assertedAtIso: "2026-09-09T05:00:00.000Z",
  organizationId,
  ...(email === undefined ? {} : { email }),
});

export const NO_LOGIN = "the credential store for `plan-two` holds no login — sign in once with ...";

/**
 * A store whose own credential is healthy — the pre-setup-token shape, where a live gauge came from it.
 *
 * @returns the reading, with both access and grant expiries set
 */
export const signedIn = ({ alias }: { alias: string }): StoreLife => ({
  alias,
  expiresAtIso: "2026-09-19T23:59:00.000Z",
  hasCredential: true,
  hasRefreshToken: true,
  refreshExpiresAtIso: "2026-10-16T00:00:00.000Z",
});

/**
 * The EMPTIED shape measured on all five plan stores: both tokens the empty string, `expiresAt`
 * zero, so no expiry is readable and no refresh can present anything.
 *
 * @returns the reading, holding neither credential nor refresh token
 */
export const emptied = ({ alias }: { alias: string }): StoreLife => ({
  alias,
  hasCredential: false,
  hasRefreshToken: false,
});
