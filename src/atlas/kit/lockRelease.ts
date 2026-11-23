/**
 * Releasing an atlas sync's operation lock from the run's own `finally`, where a throw would overturn the
 * outcome the run already reached. The failure is logged and handed back, so the run reports it on its OWN
 * outcome as `lockReleaseError` instead.
 */
import { errorMessage } from "../../lib/errorMessage.js";
import type { Logger } from "../../lib/logger.js";

/**
 * Release the lock, logging a failure rather than throwing it.
 *
 * @param release the held lock's own release
 * @param logger where a release failure is reported
 * @returns the release failure's message, or null when the lock released cleanly
 */
export function releaseReportingFailure({ logger, release }: { logger: Logger; release: () => void }): string | null {
  try {
    release();
  } catch (error: unknown) {
    const message = errorMessage({ error });
    try {
      logger.error({ msg: message });
    } catch {
      // A sink that cannot write must not overturn the outcome either; the message still reaches the report.
    }
    return message;
  }
  return null;
}
