import { describe, expect, it } from "vitest";

import {
  EVENTS_TAIL_FLAG_NAMES,
  eventsTailRequest,
  parseEventsTailArgs,
  passesFilters,
} from "../../../cli/commands/events/tail.js";
import { resolveStartOffset } from "../../../cli/commands/events/tailStart.js";
import { EVENTS_TAIL_USAGE } from "../../../cli/commands/events/tailUsage.js";
import type { ListenerStreamEvent, RecipeStreamEvent } from "../../../events/event.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const home = "/tmp/slopweaver-tail-request";

const request = ({ args }: { args: readonly string[] }) =>
  eventsTailRequest({ parsed: unwrap(parseEventsTailArgs({ rest: ["--home", home, ...args] })) });

const listener: ListenerStreamEvent = {
  armId: "a1b2c3d4",
  atIso: "2026-08-23T03:00:00.000Z",
  kind: "died",
  pid: 4242,
  source: "listener",
  why: "the Slack listener DIED",
};

const recipe: RecipeStreamEvent = {
  atIso: "2026-08-23T03:01:00.000Z",
  kind: "completed",
  runId: "run-9",
  slotHash: "slot-7",
  source: "recipe-scheduler",
  why: "a recipe slot completed",
};

describe("the defaults", () => {
  it("reads everything from the start of the stream with no cursor", () => {
    const parsed = unwrap(request({ args: [] }));
    expect(parsed.cursorName).toBe(undefined);
    expect(parsed.since).toBe(undefined);
    expect(parsed.minSeverity).toBe("info");
    expect(parsed.kinds).toStrictEqual([]);
    expect(parsed.follow).toBe(false);
  });

  it("takes the home from the flag rather than the environment", () => {
    expect(unwrap(request({ args: [] })).home).toBe(home);
  });
});

describe("the flags", () => {
  it("refuses an explicitly empty cursor name, even with --since, rather than reading it as no cursor", () => {
    expect(unwrapErr(request({ args: ["--cursor", "", "--since", "0"] }))).toEqual([
      "--cursor was given an empty name — pass the cursor's name itself",
    ]);
  });

  it("takes a cursor name", () => {
    expect(unwrap(request({ args: ["--cursor", "supervisor"] })).cursorName).toBe("supervisor");
  });

  it("takes an explicit byte offset", () => {
    expect(unwrap(request({ args: ["--since", "512"] })).since).toBe(512);
  });

  it("splits a comma-separated kind list and trims each entry", () => {
    expect(unwrap(request({ args: ["--kind", "died, escalated"] })).kinds).toStrictEqual(["died", "escalated"]);
  });

  it("drops an empty entry from a trailing comma rather than filtering on a blank kind", () => {
    expect(unwrap(request({ args: ["--kind", "died,"] })).kinds).toStrictEqual(["died"]);
  });

  it("takes a severity floor", () => {
    expect(unwrap(request({ args: ["--min-severity", "alert"] })).minSeverity).toBe("alert");
  });

  it("takes a source", () => {
    expect(unwrap(request({ args: ["--source", "recipe-scheduler"] })).source).toBe("recipe-scheduler");
  });

  it("takes a follow deadline", () => {
    expect(unwrap(request({ args: ["--follow", "--deadline-ms", "3000"] })).deadlineMs).toBe(3000);
  });
});

describe("rejections", () => {
  it("refuses a severity that is not one of the three", () => {
    const refusal = unwrapErr(request({ args: ["--min-severity", "urgent"] }));
    expect(refusal.length).toBe(1);
    expect(refusal[0]!.includes("info, warn, alert")).toBe(true);
  });

  it("refuses a source that names no publisher", () => {
    expect(unwrapErr(request({ args: ["--source", "github"] })).length).toBe(1);
  });

  it("refuses a non-numeric offset", () => {
    expect(unwrapErr(request({ args: ["--since", "beginning"] })).length).toBe(1);
  });

  it("refuses a negative limit", () => {
    expect(unwrapErr(request({ args: ["--limit", "-3"] })).length).toBe(1);
  });

  it("reports EVERY bad flag at once, not just the first", () => {
    expect(unwrapErr(request({ args: ["--since", "x", "--min-severity", "urgent"] })).length).toBe(2);
  });

  it("refuses a flag it does not advertise", () => {
    const refusal = unwrapErr(parseEventsTailArgs({ rest: ["--tail"] }));
    expect(refusal).toStrictEqual(["unknown flag: --tail"]);
  });
});

describe("the filters", () => {
  const filters = ({
    minSeverity = "info",
    kinds = [],
  }: Partial<{ kinds: readonly string[]; minSeverity: "info" | "warn" | "alert" }> = {}) => ({
    kinds,
    minSeverity,
    source: undefined,
  });

  it("passes everything when nothing is filtered", () => {
    expect(passesFilters({ event: recipe, request: filters() })).toBe(true);
  });

  it("keeps only the named source", () => {
    expect(passesFilters({ event: recipe, request: { ...filters(), source: "listener" } })).toBe(false);
    expect(passesFilters({ event: listener, request: { ...filters(), source: "listener" } })).toBe(true);
  });

  it("keeps only the named kinds", () => {
    expect(passesFilters({ event: listener, request: filters({ kinds: ["died"] }) })).toBe(true);
    expect(passesFilters({ event: recipe, request: filters({ kinds: ["died"] }) })).toBe(false);
  });

  it("applies the severity floor", () => {
    expect(passesFilters({ event: recipe, request: filters({ minSeverity: "alert" }) })).toBe(false);
    expect(passesFilters({ event: listener, request: filters({ minSeverity: "alert" }) })).toBe(true);
  });
});

describe("the help text", () => {
  it("has at least one entry in EVENTS_TAIL_FLAG_NAMES, so the guards below are not vacuously green", () => {
    expect(EVENTS_TAIL_FLAG_NAMES.length).toBeGreaterThan(0);
  });

  it("advertises exactly the flags the real parser accepts", () => {
    for (const flag of EVENTS_TAIL_FLAG_NAMES) {
      expect(EVENTS_TAIL_USAGE.includes(flag)).toBe(true);
    }
  });
});

describe("where a run starts reading", () => {
  it("refuses an unusable cursor name even when --since skips the cursor read, since the run writes it back", () => {
    const refusal = unwrapErr(
      resolveStartOffset({ request: unwrap(request({ args: ["--cursor", "../oops", "--since", "0"] })) }),
    );
    expect(refusal.code).toBe("CURSOR_NAME_UNUSABLE");
  });

  it("starts at --since without reading a usable cursor", () => {
    expect(
      unwrap(resolveStartOffset({ request: unwrap(request({ args: ["--cursor", "supervisor", "--since", "42"] })) })),
    ).toBe(42);
  });
});
