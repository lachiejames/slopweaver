/**
 * Which `op` session the roster half runs under — the decision, with every effect passed in.
 *
 * `onepassword sync` probes `op whoami` first: a session already exported into the process (a terminal that
 * ran the sign-in by hand) is used as it stands. Only a missing session is one a sign-in can fix, so a missing
 * binary or a refused permission keeps its own reason. Without a session, the sync signs in from the
 * `onepassword-atlas-password` secret and carries the token in the environment of every later call.
 *
 * The sign-in cannot bind to the wrong account: the stored password opens only the account it belongs to, so
 * any other account `op` resolves rejects it and the sign-in fails loudly. An exported session is taken on
 * `op`'s own account resolution, as it always was.
 */
import type { Result } from "../../lib/result.js";
import { ONEPASSWORD_SIGNIN_STEP } from "./credentials.js";
import { classifyOpFailure, type OpSession } from "./opCli.js";

/** The effects {@link resolveOpSessionEnv} needs, as plain functions — the shell passes the real ones. */
export interface OpSessionSeams {
  /** `op whoami` under the given environment. */
  readonly whoami: (input: { env: NodeJS.ProcessEnv }) => Result<unknown>;
  /** The stored `onepassword-atlas-password`, or `undefined` when none is stored. */
  readonly readPassword: () => string | undefined;
  /** A fixed `op signin` fed this password. */
  readonly signIn: (input: { password: string }) => Result<OpSession>;
}

/**
 * Decide the environment every later `op` call runs under, signing in from the stored password only when
 * there is no session.
 *
 * @param env the process environment, used as it stands when it already holds a session
 * @param seams the whoami probe, the password read and the sign-in
 * @returns the environment to bind later calls to, or why the roster half is unavailable
 */
export function resolveOpSessionEnv({
  env,
  seams,
}: {
  env: NodeJS.ProcessEnv;
  seams: OpSessionSeams;
}): { env: NodeJS.ProcessEnv } | { reason: string } {
  const whoami = seams.whoami({ env });
  if (whoami.isOk()) {
    return { env };
  }
  const password = seams.readPassword();
  // `op` echoes values it was handed (an account name, say), so no reason carries the stored password verbatim.
  const unavailable = ({ lines }: { lines: readonly string[] }): { reason: string } => {
    const reason = lines.join("; ");
    if (password === undefined || password === "") {
      return { reason };
    }
    return { reason: reason.split(password).join("<redacted>") };
  };
  if (classifyOpFailure({ stderr: whoami.error.join("\n") }) !== "cli-not-signed-in") {
    return unavailable({ lines: whoami.error });
  }
  if (password === undefined) {
    return unavailable({ lines: [...whoami.error, ONEPASSWORD_SIGNIN_STEP] });
  }
  const session = seams.signIn({ password });
  if (session.isErr()) {
    return unavailable({ lines: ["signing in from the onepassword-atlas-password secret failed", ...session.error] });
  }
  const signedInEnv = { ...env, [session.value.name]: session.value.token };
  const signedIn = seams.whoami({ env: signedInEnv });
  if (signedIn.isErr()) {
    return unavailable({ lines: ["the fresh session from the stored password was refused", ...signedIn.error] });
  }
  return { env: signedInEnv };
}
