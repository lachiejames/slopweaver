/** What `claude mint` and `claude token` print for one setup-token admission, and the exit code each outcome gives. */
import { describe, expect, it } from "vitest";

import { ClaudeRotationErrors } from "../../../../../claude/errors.js";
import { reportSetupTokenAdmission } from "../../../../../cli/commands/claude/setupTokenReport.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";

/** Report one admission into two recorded channels, so the test reads the exact ordered lines on each. */
function reported({ admitted }: { admitted: Parameters<typeof reportSetupTokenAdmission>[0]["admitted"] }): {
  code: number;
  out: string[];
  problems: string[];
} {
  const out: string[] = [];
  const problems: string[] = [];
  const code = reportSetupTokenAdmission({
    account: { alias: "plan-a" },
    admitted,
    writeOut: ({ line }) => {
      out.push(line);
    },
    writeProblem: ({ problem }) => {
      problems.push(problem);
    },
  });
  return { code, out, problems };
}

describe("reportSetupTokenAdmission", () => {
  it("prints the judge's lines then where the token was written, and exits OK", () => {
    const admitted = ok({ lines: ["gauge: present", "week: present"], path: "/home/plan-a/setup-token" });
    expect(reported({ admitted })).toEqual({
      code: EXIT_OK,
      out: [
        "gauge: present",
        "week: present",
        "plan-a: written to /home/plan-a/setup-token — every spawn routed to plan-a now boots on it",
      ],
      problems: [],
    });
  });

  it("prints an unproven token's judge lines as output, not as a problem, and exits with an error", () => {
    const admitted = err(
      ClaudeRotationErrors.setupTokenUnproven({ alias: "plan-a", lines: ["gauge: absent", "refused: not written"] }),
    );
    expect(reported({ admitted })).toEqual({
      code: EXIT_ERROR,
      out: ["gauge: absent", "refused: not written"],
      problems: [],
    });
  });

  it("reports any other failure through the problem channel only, and exits with an error", () => {
    const admitted = err(
      ClaudeRotationErrors.setupTokenWriteFailed({ cause: new Error("disk full"), path: "/home/plan-a/setup-token" }),
    );
    expect(reported({ admitted })).toEqual({
      code: EXIT_ERROR,
      out: [],
      problems: ["could not write the setup token at /home/plan-a/setup-token: disk full"],
    });
  });
});
