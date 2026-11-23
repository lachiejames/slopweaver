/*
 * `hand surface` end to end over its real parser and builder, its lines read back from plain arrays.
 */
import { describe, expect, it } from "vitest";

import { runHandSurface } from "../../../../../cli/commands/hand/surface.js";
import { HAND_SURFACE_USAGE } from "../../../../../cli/commands/hand/surfaceUsage.js";

const BASE: readonly string[] = [
  "--row",
  "runner-outage",
  "--ask-slug",
  "runner-outage-access",
  "--tried",
  "re-ran the jobs",
  "--tried",
  "checked the labels",
  "--doc",
  "https://docs.github.com/en/actions",
  "--documented",
  "a queued job picks a runner",
  "--observed",
  "jobs sit queued",
  "--codex",
  "Codex agrees on the docs",
  "--why",
  "I do not know why",
  "--urgency",
  "none",
  "--question",
  "Ask Rosa?",
  "--problem",
  "jobs sit queued",
  "--options",
  "ask Rosa :: one message\nkeep pulling :: hours",
  "--lean",
  "ask Rosa",
  "--risk",
  "merges stay blocked",
  "--blast-radius",
  "every merge",
  "--still-real",
  "the run is still queued",
  "--evidence",
  "https://github.com/o/r/actions/runs/1",
  "--observed-by",
  "workspace:77",
  "--context",
  "work",
];

/** A `--urgency none` invocation's tokens swapped for a breaking one with every companion. */
const BREAKING: readonly string[] = [
  ...BASE.filter((token) => token !== "none" && token !== "--urgency"),
  "--urgency",
  "breaking",
  "--breaks",
  "every merge",
  "--by",
  "now",
  "--note-what",
  "Ask Rosa for read on the runner settings, so merges can run again",
];

const run = ({ rest }: { rest: readonly string[] }): { code: number; out: string[]; error: string[] } => {
  const out: string[] = [];
  const error: string[] = [];
  const code = runHandSurface({
    io: {
      error: (line) => {
        error.push(line);
      },
      out: (line) => {
        out.push(line);
      },
    },
    rest,
  });
  return { code, error, out };
};

describe("hand surface", () => {
  it("prints its usage on --help", () => {
    expect(run({ rest: ["--help"] })).toEqual({ code: 0, error: [], out: [HAND_SURFACE_USAGE] });
  });

  it("refuses a report missing a required flag before printing anything", () => {
    const result = run({ rest: BASE.slice(2) });
    expect([result.code, result.out, result.error[0]]).toEqual([2, [], "hand surface needs --row"]);
  });

  it("refuses part of the access triple", () => {
    const result = run({ rest: [...BASE, "--access", "read on runner settings"] });
    expect([result.code, result.error[0]]).toEqual([
      2,
      "--access, --holder and --would-settle come together: the access, who holds it, and what it would settle",
    ]);
  });

  it("refuses a breaking report with no --breaks or --by", () => {
    const result = run({
      rest: [...BASE.map((token) => (token === "none" ? "breaking" : token)), "--note-what", "Ask Rosa for read"],
    });
    expect([result.code, result.error[0]]).toEqual([
      2,
      "--urgency breaking needs --breaks and --by: what may break, and by when",
    ]);
  });

  it("refuses note-only flags on a Queue-only report", () => {
    const result = run({ rest: [...BASE, "--note-what", "Ask Rosa"] });
    expect([result.code, result.error[0]]).toEqual([2, "--urgency none does not take --note-what"]);
  });

  it("refuses an urgency outside the closed set", () => {
    const result = run({ rest: BASE.map((token) => (token === "none" ? "soon" : token)) });
    expect([result.code, result.error[0]]).toEqual([
      2,
      "--urgency must be one of breaking|blocked-send|fleet-idle|keen|close-call|none, not soon",
    ]);
  });

  it("refuses a close call that does not say what silence risks", () => {
    const result = run({
      rest: [...BASE.map((token) => (token === "none" ? "close-call" : token)), "--note-what", "Say whether"],
    });
    expect([result.code, result.error[0]]).toEqual([
      2,
      "--urgency close-call needs --if-silent: what could go wrong if the owner is not told",
    ]);
  });

  it("refuses another kind's companion on a blocked send", () => {
    const rest = [
      ...BASE.map((token) => (token === "none" ? "blocked-send" : token)),
      "--send",
      "the reply",
      "--if-silent",
      "x",
      "--note-what",
      "Sign in to Gmail",
    ];
    expect(run({ rest }).error[0]).toBe("--urgency blocked-send does not take --if-silent");
  });

  it("prints the report, the route and only the Queue line when nothing is urgent", () => {
    const result = run({ rest: BASE });
    expect([result.code, result.out.slice(-3, -1), result.out.at(-1)!.startsWith("queue (run it yourself): ")]).toEqual(
      [0, ["", "route: queue"], true],
    );
  });

  it("prints a note line for the chair when something may break, as JSON on --json", () => {
    const result = run({ rest: [...BREAKING, "--json"] });
    const surface = JSON.parse(result.out[0]!) as { route: { kind: string }; note: { argv: string[] } };
    expect([result.code, surface.route.kind, surface.note.argv.slice(0, 5)]).toEqual([
      0,
      "note",
      ["slopweaver", "hand", "post", "--id", "mid-state-runner-outage-access"],
    ]);
  });
});
