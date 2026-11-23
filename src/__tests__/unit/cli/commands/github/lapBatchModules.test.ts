import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { LAP_BATCH_PREFLIGHT_DEADLINE_MS } from "../../../../../cli/commands/github/lapBatchCore.js";
import { landBatch } from "../../../../../cli/commands/github/lapBatchLand.js";
import { memberSession, preflightBatch } from "../../../../../cli/commands/github/lapBatchPhases.js";
import { runGithubLapBatch } from "../../../../../cli/commands/github/lapBatchRun.js";
import { lapPlan, parseGithubLapArgs } from "../../../../../cli/commands/github/lapCore.js";
import type { GithubLapDeps } from "../../../../../cli/commands/github/lapDeps.js";
import { printLapPlan } from "../../../../../cli/commands/github/lapLanes.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { ARGS, BASE, batchDeps, HEADS, MEMBERS, observe, sha } from "../../../../lapBatchFixture.js";

let homes: string[] = [];
afterEach(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
  homes = [];
});

/** The batch's parsed invocation, its fake deps over a fresh home, its fake API, and what they observed. */
function batchCase({ extra }: { extra: readonly string[] }) {
  const observed = observe();
  const home = mkdtempSync(join(tmpdir(), "sw-lap-batch-"));
  homes.push(home);
  const deps = batchDeps({ home, observed });
  const args = unwrap(parseGithubLapArgs({ rest: [...ARGS, ...extra] }));
  return { api: deps.makeApi({ home, token: "token" }), args, deps, observed };
}

describe("printLapPlan", () => {
  it("prints one line per planned step, naming its id, context and command", () => {
    const lines: string[] = [];
    printLapPlan({ out: (line) => lines.push(line) });
    const first = lapPlan()[0]!;
    expect(lines.length).toBe(lapPlan().length);
    expect(lines[0]!.startsWith(`would run ${first.id} (${first.context}): ${first.argv.join(" ")}`)).toBe(true);
  });
});

describe("preflightBatch", () => {
  it("chains each member's simulated squash onto the one before it, testing the last", async () => {
    const { api, args, deps } = batchCase({ extra: [] });
    const batch = unwrap(await preflightBatch({ api, args, deps, numbers: MEMBERS }));
    expect(batch.baseTip).toBe(BASE);
    expect(batch.tested).toBe(sha({ tag: "s9" }));
    expect(batch.members.map((member) => member.onto)).toEqual([BASE, sha({ tag: "s7" }), sha({ tag: "s8" })]);
  });

  it("refuses once the preflight passes its deadline, naming the stage that carried it over and reaching no later one", async () => {
    const { api, args, deps: base } = batchCase({ extra: ["--dry-run"] });
    let nowMs = Date.parse("2026-11-11T03:00:00.000Z");
    const measured: number[] = [];
    const deps: GithubLapDeps = {
      ...base,
      memberMergeFacts: (at) => {
        const number = MEMBERS.find((member) => HEADS[member] === at.head)!;
        measured.push(number);
        nowMs += number === 8 ? LAP_BATCH_PREFLIGHT_DEADLINE_MS : 1000;
        return base.memberMergeFacts(at);
      },
      now: () => new Date(nowMs),
    };
    expect(unwrapErr(await preflightBatch({ api, args, deps, numbers: MEMBERS }))).toEqual([
      {
        code: "REFUSED",
        message:
          "the batch preflight passed its 10-minute deadline while measuring #8's merge over its link (601s in); " +
          "nothing was posted or run and the machine's lock is released, so lap a shorter batch or land the members singly",
      },
    ]);
    expect(measured).toEqual([7, 8]);
  });

  it("gives a stage's own refusal over the deadline when that stage both refused and carried it over", async () => {
    const { api, args, deps: base } = batchCase({ extra: ["--dry-run"] });
    let nowMs = Date.parse("2026-11-11T03:00:00.000Z");
    const moved = sha({ tag: "moved8" });
    const deps: GithubLapDeps = {
      ...base,
      fetchRefs: async (at) => {
        const refs = unwrap(await base.fetchRefs(at));
        nowMs += LAP_BATCH_PREFLIGHT_DEADLINE_MS + 1000;
        return ok(at.number === 8 ? { ...refs, headSha: moved } : refs);
      },
      now: () => new Date(nowMs),
    };
    expect(unwrapErr(await preflightBatch({ api, args, deps, numbers: [8, 9] }))).toEqual([
      {
        code: "REFUSED",
        message: `#8's head moved between two reads (${HEADS[8]!}, then ${moved}); run the lap again`,
      },
    ]);
  });
});

describe("memberSession", () => {
  it("carries one member's own number and head over the tip it lands onto, never the batch", async () => {
    const { api, args, deps } = batchCase({ extra: ["--land"] });
    const batch = unwrap(await preflightBatch({ api, args, deps, numbers: MEMBERS }));
    const session = { api, args, baseRef: batch.baseRef, deps, home: "/home", refs: { baseTip: BASE, headSha: "x" } };
    const member = memberSession({ member: batch.members[1]!, session, tip: sha({ tag: "m7" }) });
    expect(member.args.number).toBe(8);
    expect(member.args.batch).toBe(undefined);
    expect(member.refs).toEqual({ baseTip: sha({ tag: "m7" }), headSha: HEADS[8] });
  });
});

describe("landBatch", () => {
  it("holds, merges and releases each member in order once the batch's lap is green", async () => {
    const { api, args, deps, observed } = batchCase({ extra: ["--land"] });
    const batch = unwrap(await preflightBatch({ api, args, deps, numbers: MEMBERS }));
    const session = {
      api,
      args,
      baseRef: batch.baseRef,
      deps,
      home: deps.home(),
      refs: { baseTip: batch.baseTip, headSha: batch.tested },
    };
    expect(await landBatch({ batch, session })).toBe(0);
    expect(observed.landing.filter((line) => line.startsWith("merge"))).toEqual([
      "merge #7 acknowledging none",
      "merge #8 acknowledging base-moved",
      "merge #9 acknowledging base-moved",
    ]);
  });
});

describe("runGithubLapBatch", () => {
  it("prints the chain and the plan on a dry run, and posts nothing", async () => {
    const { api, args, deps, observed } = batchCase({ extra: ["--dry-run"] });
    const execution = { kind: "dry-run" as const };
    expect(await runGithubLapBatch({ api, args, deps, execution, home: deps.home(), numbers: MEMBERS })).toBe(0);
    expect(observed.posted).toEqual([]);
    expect(observed.out.at(-1)!.startsWith(`would run ${lapPlan().at(-1)!.id} `)).toBe(true);
  });
});
