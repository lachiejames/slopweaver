/**
 * The request seam a Linear verification pass reads through, what one fetch leg built on it returns, and the
 * production seam over Linear's process-wide paced transport. The pass itself is `./verify.ts`.
 */
import { sharedLinearTransport } from "../../corpus/linear/transport.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "./errors.js";
import type { LinearVerification } from "./verifyDocument.js";

/** The injected request seam. Production uses the process-wide safe, paced Linear transport. */
export type LinearVerifyRequest = (args: {
  query: string;
  variables: Readonly<Record<string, unknown>>;
}) => Promise<Result<unknown, LinearLiveError>>;

/** One FETCH leg of a verification pass: the live nodes it read and the requests it spent. */
export interface VerifyLeg {
  readonly nodes: readonly Record<string, unknown>[];
  readonly unverified: readonly LinearVerification[];
  readonly requests: number;
}

/**
 * Build the production verification seam over Linear's process-wide paced transport.
 *
 * @param token the configured Linear API key
 * @returns a result-returning request seam
 */
export function linearVerifyRequest({ token }: { token: string }): LinearVerifyRequest {
  const transport = sharedLinearTransport({ token });
  return async ({ query, variables }) => {
    try {
      return ok(await transport.request({ query, variables: { ...variables } }));
    } catch (error: unknown) {
      return err(
        LinearLiveErrors.readFailed({
          cause: error,
          message: error instanceof Error ? error.message : "Linear verification read failed",
        }),
      );
    }
  };
}
