import { describe, expect, it } from "vitest";

import { releaseReportingFailure } from "../../../../atlas/kit/lockRelease.js";
import type { Logger } from "../../../../lib/logger.js";

/** A logger that keeps every error line it is handed, and drops the rest. */
function recordingLogger(): { errors: string[]; logger: Logger } {
  const errors: string[] = [];
  const ignore = (): void => undefined;
  return {
    errors,
    logger: { debug: ignore, error: ({ msg }) => errors.push(msg), info: ignore, out: ignore, warn: ignore },
  };
}

describe("releaseReportingFailure — a release failure is reported, never thrown", () => {
  it("answers null and logs nothing when the lock releases cleanly", () => {
    const { errors, logger } = recordingLogger();
    const released: string[] = [];
    expect(releaseReportingFailure({ logger, release: () => released.push("released") })).toBeNull();
    expect(released).toEqual(["released"]);
    expect(errors).toEqual([]);
  });

  it("hands back and logs the message of a release that throws", () => {
    const { errors, logger } = recordingLogger();
    const release = (): void => {
      throw new Error("EACCES: the lock directory is not writable");
    };
    expect(releaseReportingFailure({ logger, release })).toBe("EACCES: the lock directory is not writable");
    expect(errors).toEqual(["EACCES: the lock directory is not writable"]);
  });

  it("still hands back the release failure when the logger itself throws", () => {
    const ignore = (): void => undefined;
    const logger: Logger = {
      debug: ignore,
      error: () => {
        throw new Error("stderr closed");
      },
      info: ignore,
      out: ignore,
      warn: ignore,
    };
    const release = (): void => {
      throw new Error("EACCES");
    };
    expect(releaseReportingFailure({ logger, release })).toBe("EACCES");
  });

  it("reports a thrown value String() cannot print, rather than rejecting the run that released it", () => {
    const { errors, logger } = recordingLogger();
    const release = (): void => {
      throw Object.create(null);
    };
    expect(releaseReportingFailure({ logger, release })).toBe("[object Object]");
    expect(errors).toEqual(["[object Object]"]);
  });
});
