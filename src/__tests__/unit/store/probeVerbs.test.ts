/**
 * The six probe-ladder verbs and `store detect`, as the CLI can dispatch them.
 *
 * Two properties, and both are about what happens BEFORE a connection opens. Every verb in this family
 * reaches a database of millions of rows, so an invocation that is going to be refused has to be refused while
 * it is still free — a typo in `--shape` costing a connection and a seven-second scan is the failure these
 * assert away. And `store detect` writes a run directory, so the same rule covers its parser twice over.
 *
 * These are also the tests the `manifest-loader-tests` gate asks for: a command module the CLI can
 * dispatch that no test imports is, as far as the suite is concerned, wired to nothing.
 */
import { describe, expect, it } from "vitest";

import { parseDetectArgs, runStoreDetect, storeDetectCommand } from "../../../cli/commands/store/detect.js";
import { storeCommandErrorLines } from "../../../cli/commands/store/errors.js";
import {
  runStoreGroups,
  runStoreHits,
  runStoreProbe,
  storeGroupsCommand,
  storeHitsCommand,
  storeProbeCommand,
} from "../../../cli/commands/store/probe.js";
import {
  runStoreAround,
  runStoreOpen,
  runStorePeek,
  storeAroundCommand,
  storeOpenCommand,
  storePeekCommand,
} from "../../../cli/commands/store/probeDisclose.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** Where a wave lands, invented, and the instant that names its directory. */
const AT = {
  nowMs: 1789600000000,
  roots: { recordSet: "/home/live/slack/detectives", unattached: "/nowhere" },
} as const;

/** The lines a refused `store detect` invocation prints. */
const refusalLines = ({ parsed }: { parsed: ReturnType<typeof parseDetectArgs> }): readonly string[] =>
  storeCommandErrorLines({ error: unwrapErr(parsed) });

describe("the verbs the manifest can dispatch", () => {
  it("exports each runner itself — `defineCommand` returns the function, never a wrapper", () => {
    expect(storeProbeCommand).toBe(runStoreProbe);
    expect(storeGroupsCommand).toBe(runStoreGroups);
    expect(storeHitsCommand).toBe(runStoreHits);
    expect(storePeekCommand).toBe(runStorePeek);
    expect(storeOpenCommand).toBe(runStoreOpen);
    expect(storeAroundCommand).toBe(runStoreAround);
    expect(storeDetectCommand).toBe(runStoreDetect);
  });
});

describe("parseDetectArgs", () => {
  it("takes the question from the positionals and every keyword from a REPEATED --term", () => {
    const args = unwrap(
      parseDetectArgs({
        ...AT,
        rest: ["what", "are", "their", "pain", "points", "--term", "barten", "--term", "care plan"],
      }),
    );
    expect(args.question).toBe("what are their pain points");
    expect(args.terms).toEqual(["barten", "care plan"]);
  });

  it("keeps every --recalled line rather than only the last", () => {
    const args = unwrap(
      parseDetectArgs({
        ...AT,
        rest: ["q", "--term", "x", "--recalled", "claim one", "--recalled", "claim two"],
      }),
    );
    expect(args.recalled).toEqual(["claim one", "claim two"]);
  });

  it("leaves the slot count unset when the caller does not know its own capacity", () => {
    expect(unwrap(parseDetectArgs({ ...AT, rest: ["q", "--term", "x"] })).slots).toBe(undefined);
  });

  it("reads an explicit slot count", () => {
    expect(unwrap(parseDetectArgs({ ...AT, rest: ["q", "--term", "x", "--slots", "8"] })).slots).toBe(8);
  });

  it("mints the run directory under the detective root it was given, and says a freeze will not find it", () => {
    const args = unwrap(parseDetectArgs({ ...AT, rest: ["q", "--term", "x"] }));
    expect(args.out).toBe("/nowhere/store-1789600000000");
    expect(args.outNote).toContain("`turn freeze` will not carry it");
  });

  it("lands the wave in the turn's own record set when --ask names the turn", () => {
    const args = unwrap(parseDetectArgs({ ...AT, rest: ["q", "--term", "x", "--ask", "C0TEST/1789600000.000100"] }));
    expect(args.out).toBe("/home/live/slack/detectives/C0TEST-1789600000.000100/store-1789600000000");
    expect(args.outNote).toBe(null);
  });

  it("refuses --ask beside --out, which name two different places", () => {
    const refused = refusalLines({
      parsed: parseDetectArgs({ ...AT, rest: ["q", "--term", "x", "--ask", "C0TEST/1.2", "--out", "/tmp/here"] }),
    });
    expect(refused).toEqual(["--ask and --out name two different places — pass one"]);
  });

  it("refuses an --ask whose halves would join their way out of the record set", () => {
    const refused = refusalLines({
      parsed: parseDetectArgs({ ...AT, rest: ["q", "--term", "x", "--ask", "C1/../../outside"] }),
    });
    expect(refused).toEqual(["--ask must read <channel>/<messageTs>, got C1/../../outside"]);
  });

  it("refuses an --ask that is not <channel>/<messageTs>", () => {
    const refused = refusalLines({ parsed: parseDetectArgs({ ...AT, rest: ["q", "--term", "x", "--ask", "C0TEST"] }) });
    expect(refused).toEqual(["--ask must read <channel>/<messageTs>, got C0TEST"]);
  });

  it("takes the run directory the caller named instead", () => {
    const args = unwrap(parseDetectArgs({ ...AT, rest: ["q", "--term", "x", "--out", "/tmp/here"] }));
    expect(args.out).toBe("/tmp/here");
  });

  it("refuses a wave with no question — a brief with no question briefs nobody", () => {
    const parsed = parseDetectArgs({ ...AT, rest: ["--term", "x"] });
    expect(unwrapErr(parsed).code).toBe("ARGUMENTS_REFUSED");
    expect(refusalLines({ parsed })[0]).toContain("name the question");
  });

  it("refuses a wave with no keyword to probe", () => {
    const refused = refusalLines({ parsed: parseDetectArgs({ ...AT, rest: ["a question"] }) });
    expect(refused[0]).toContain("--term is required");
  });

  it("refuses a slot count below one, which would plan a wave of nothing", () => {
    const refused = refusalLines({ parsed: parseDetectArgs({ ...AT, rest: ["q", "--term", "x", "--slots", "0"] }) });
    expect(refused[0]).toContain("--slots must be a whole number of at least 1");
  });

  it("reports every refusal at once rather than only the first", () => {
    expect(refusalLines({ parsed: parseDetectArgs({ ...AT, rest: ["--slots", "nope"] }) })).toHaveLength(3);
  });

  it("keeps every --variant beside the name they are variants of", () => {
    const args = unwrap(
      parseDetectArgs({
        ...AT,
        rest: ["q", "--term", "pain", "--name", "barten", "--variant", "barton", "--variant", "tobin barton"],
      }),
    );
    expect(args.name).toBe("barten");
    expect(args.variants).toEqual(["barton", "tobin barton"]);
  });

  it("leaves the name step unasked-for when no --name is given", () => {
    const args = unwrap(parseDetectArgs({ ...AT, rest: ["q", "--term", "x"] }));
    expect(args.name).toBe(null);
    expect(args.variants).toEqual([]);
  });

  it("refuses a --variant with no --name, which would be probed as an ordinary keyword", () => {
    const refused = refusalLines({
      parsed: parseDetectArgs({ ...AT, rest: ["q", "--term", "x", "--variant", "barton"] }),
    });
    expect(refused[0]).toContain("--variant needs --name");
  });
});
