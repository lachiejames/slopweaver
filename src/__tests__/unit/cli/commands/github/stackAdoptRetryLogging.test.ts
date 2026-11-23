import { describe, expect, it } from "vitest";

import { octokitAttemptTraceLog } from "../../../../../corpus/github/writeCtx.js";
import { createLogger } from "../../../../../lib/logger.js";

const RECOVERED_TRANSIENT_LINE =
  "GET /repos/acme/acme-admin/pulls?head=acme%3Amx-2386&per_page=1&state=open - 500 with id UNKNOWN in 8ms";
const SUCCESSFUL_ATTEMPT_LINE =
  "GET /repos/acme/acme-admin/pulls?head=acme%3Amx-2386&per_page=1&state=open - 200 with id abc123 in 42ms";

describe("octokitAttemptTraceLog", () => {
  it("does not surface a recovered transient's error line at the default log level", () => {
    const lines: string[] = [];
    const sink = createLogger({ outSink: () => undefined, sink: (line) => lines.push(line) });

    octokitAttemptTraceLog({ sink }).error(RECOVERED_TRANSIENT_LINE);

    expect(lines).toEqual([]);
  });

  it("does not surface a successful attempt's info line at the default log level either", () => {
    const lines: string[] = [];
    const sink = createLogger({ outSink: () => undefined, sink: (line) => lines.push(line) });

    octokitAttemptTraceLog({ sink }).info(SUCCESSFUL_ATTEMPT_LINE);

    expect(lines).toEqual([]);
  });

  it("still emits the exact attempt line at the debug (--verbose) level", () => {
    const lines: string[] = [];
    const sink = createLogger({ level: "debug", outSink: () => undefined, sink: (line) => lines.push(line) });

    octokitAttemptTraceLog({ sink }).error(RECOVERED_TRANSIENT_LINE);

    expect(lines).toEqual([RECOVERED_TRANSIENT_LINE]);
  });
});
