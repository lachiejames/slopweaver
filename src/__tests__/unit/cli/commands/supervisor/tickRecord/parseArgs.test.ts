/** How `supervisor tick-record` reads its argv tail: both documents named, and at most one off stdin. */
import { describe, expect, it } from "vitest";

import { parseSupervisorTickRecordArgs } from "../../../../../../cli/commands/supervisor/tickRecordCore.js";

describe("parseSupervisorTickRecordArgs", () => {
  it("requires both documents, naming what each is for", () => {
    const parsed = parseSupervisorTickRecordArgs({ rest: [] });

    expect(parsed.isErr()).toBe(true);
    expect(parsed.isErr() ? parsed.error.length : 0).toBe(2);
  });

  it("refuses two readers of stdin", () => {
    const parsed = parseSupervisorTickRecordArgs({ rest: ["--draft", "-", "--reconcile", "-"] });

    expect(parsed.isErr()).toBe(true);
    expect(parsed.isErr() ? parsed.error[0]! : "").toContain("cannot both read stdin");
  });

  it("accepts one path and one stdin", () => {
    const parsed = parseSupervisorTickRecordArgs({ rest: ["--draft", "d.json", "--reconcile", "-"] });

    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.reconcileSource : "").toBe("-");
  });
});
