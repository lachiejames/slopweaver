/**
 * `slopweaver automation run-due` over an `investigate` row — the clock joining the ask lane: the question is asked
 * through the ordinary post door, the posted message is briefed as an ask, and every refusal stamps nothing.
 */
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../../../lib/result.js";
import { readRecipeDefinitionRuns } from "../../../../../../live/automation/definitionRunStore.js";
import { readFiringPosting } from "../../../../../../live/automation/postingLedger.js";
import { slotDeliveryKey } from "../../../../../../live/automation/slotLedger.js";
import { runDueUnderFake } from "../../../../../runDueSignalFake.js";
import { argvFor, firingAt, investigateRow, POST_REPORT, PROMPT_CHANNEL } from "./fixtures.js";
import { deps, homeWith, removeHomes } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("recipe run-due over an investigate row — the clock joining the ask lane", () => {
  it("asks the row's question in its own channel, as the bot, through the ordinary post door", async () => {
    const home = homeWith({ rows: [investigateRow()] });
    const injected = deps();

    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });

    expect(code).toBe(0);
    expect(injected.posts).toEqual([
      [
        "--as",
        "bot",
        "--channel",
        PROMPT_CHANNEL,
        "--form",
        JSON.stringify({
          kind: "automation-prompt",
          prompt: "what regressed in staging overnight?",
          recipeId: "overnight-staging",
        }),
        "--home",
        home,
        "--idempotency-key",
        slotDeliveryKey({
          recipeId: "overnight-staging",
          slotIso: firingAt({ cadence: "0 * * * *", nowIso: "2026-09-08T12:05:00.000Z" }),
        }),
        "--dm-purpose",
        "asked-for",
        "--json",
      ],
    ]);
  });

  it("briefs the POSTED message as an ask, so the ask lane owns everything after the question", async () => {
    const home = homeWith({ rows: [investigateRow()] });
    const injected = deps();

    await runDueUnderFake({ argv: argvFor({ home }), deps: injected });

    expect(injected.dispatched).toEqual([
      [
        "node",
        "slopweaver",
        "turn",
        "brief",
        "--channel",
        PROMPT_CHANNEL,
        "--message-ts",
        "1789.0001",
        "--thread-ts",
        "1789.0001",
        "--user",
        "U0OWNER",
        "--text",
        "what regressed in staging overnight?",
        "--surface",
        "dm",
        "--home",
        home,
      ],
    ]);
  });

  it("records where the firing posted, so the Automations page never re-derives it from today's config", async () => {
    const home = homeWith({ rows: [investigateRow()] });
    const slotIso = firingAt({ cadence: "0 * * * *", nowIso: "2026-09-08T12:05:00.000Z" });

    await runDueUnderFake({ argv: argvFor({ home }), deps: deps() });

    const posting = readFiringPosting({ home, recipeId: "overnight-staging", slotIso });
    expect(unwrap(posting)).toEqual({
      channel: PROMPT_CHANNEL,
      postedAtIso: "2026-09-08T12:05:00.000Z",
      recipeId: "overnight-staging",
      slotIso,
      ts: "1789.0001",
    });
  });

  it("records no posting on a dry run, because nothing was posted", async () => {
    const home = homeWith({ rows: [investigateRow()] });
    const slotIso = firingAt({ cadence: "0 * * * *", nowIso: "2026-09-08T12:05:00.000Z" });

    await runDueUnderFake({ argv: argvFor({ home, tail: ["--dry-run"] }), deps: deps() });

    expect(unwrap(readFiringPosting({ home, recipeId: "overnight-staging", slotIso }))).toBeUndefined();
  });

  it("never tags the bot in the opening message, so a running listener cannot capture the same slot twice", async () => {
    const home = homeWith({ rows: [investigateRow()] });
    const injected = deps();

    await runDueUnderFake({ argv: argvFor({ home }), deps: injected });

    expect(injected.posts[0]!.filter((token) => token.includes("<@"))).toEqual([]);
    expect(injected.posts[0]!.filter((token) => token.includes("mention"))).toEqual([]);
  });

  it("stamps the row it asked, so the next tick does not ask the same question again", async () => {
    const home = homeWith({ rows: [investigateRow()] });

    await runDueUnderFake({ argv: argvFor({ home }), deps: deps() });

    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs["overnight-staging"]).toEqual({
      exitCode: 0,
      firstSucceededIso: "2026-09-08T12:05:00.000Z",
      lastRunAtIso: "2026-09-08T12:05:00.000Z",
      watermarkIso: "2026-09-08T12:00:00.000Z",
    });
  });

  it("names the ask and where its brief landed, rather than claiming an answer", async () => {
    const home = homeWith({ rows: [investigateRow()] });
    const injected = deps();

    await runDueUnderFake({ argv: argvFor({ home }), deps: injected });

    expect(injected.out).toContain(
      `recipe overnight-staging · asked · D0PROMPT/1789.0001 · in the ask lane · judge it and dispatch: ` +
        join(home, "briefs", "D0PROMPT-1789.0001.json"),
    );
  });

  it("briefs nothing and fails the tick when the door refused the question", async () => {
    const home = homeWith({ rows: [investigateRow()] });
    const injected = deps({ postExitCode: 1 });

    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });

    expect(code).toBe(1);
    expect(injected.dispatched).toEqual([]);
    expect(injected.out).toContain(
      "recipe overnight-staging · ASK FAILED · recipe 'overnight-staging' could not ask its question in " +
        "D0PROMPT: slack post --as bot exited 1 · nothing was asked",
    );
  });

  it("leaves a refused row unstamped, so it is asked again on the next tick", async () => {
    const home = homeWith({ rows: [investigateRow()] });

    await runDueUnderFake({ argv: argvFor({ home }), deps: deps({ postExitCode: 1 }) });

    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs).toEqual({});
  });

  it("STAMPS a question that was asked but not briefed, and prints the brief to run by hand", async () => {
    const home = homeWith({ rows: [investigateRow()] });
    const injected = deps({ exitCode: 3 });

    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });

    expect(code).toBe(1);
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs["overnight-staging"]).toEqual({
      exitCode: 3,
      lastRunAtIso: "2026-09-08T12:05:00.000Z",
      watermarkIso: "2026-09-08T12:00:00.000Z",
    });
    expect(injected.out.join("\n")).toContain(
      "recipe overnight-staging · ASKED, NOT BRIEFED · D0PROMPT/1789.0001 · turn brief exited 3 · " +
        "the question is posted; brief it by hand: slopweaver turn brief --channel D0PROMPT --message-ts 1789.0001",
    );
  });

  it("asks nothing and refuses the row when its params name no question", async () => {
    const home = homeWith({ rows: [investigateRow({ params: { askedBy: "U0OWNER", channel: PROMPT_CHANNEL } })] });
    const injected = deps();

    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });

    expect(code).toBe(1);
    expect(injected.posts).toEqual([]);
    expect(injected.out.join("\n")).toContain("recipe overnight-staging · REFUSED · ");
  });

  it("renders the question a dry run would have asked, and stamps nothing", async () => {
    const home = homeWith({ rows: [investigateRow()] });
    const injected = deps({ postLines: [JSON.stringify({ preview: ["> what regressed"], sent: null })] });

    const code = await runDueUnderFake({ argv: argvFor({ home, tail: ["--dry-run"] }), deps: injected });

    expect(code).toBe(0);
    expect(injected.posts[0]).toContain("--dry-run");
    expect(injected.dispatched).toEqual([]);
    expect(injected.out).toContain("recipe overnight-staging · would ask · #D0PROMPT · > what regressed");
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs).toEqual({});
  });

  it("refuses a post document that carries no sent message rather than briefing an invented address", async () => {
    const home = homeWith({ rows: [investigateRow()] });
    const injected = deps({ postLines: [JSON.stringify({ preview: [], sent: null })] });

    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });

    expect(code).toBe(1);
    expect(injected.dispatched).toEqual([]);
    expect(injected.out).toContain(
      "recipe overnight-staging · ASK FAILED · the door reported no sent message · nothing was asked",
    );
  });

  it("refuses a post that emitted more than one document on stdout", async () => {
    const home = homeWith({ rows: [investigateRow()] });
    const injected = deps({ postLines: [POST_REPORT, POST_REPORT] });

    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });

    expect(code).toBe(1);
    expect(injected.dispatched).toEqual([]);
    expect(injected.out.join("\n")).toContain("emitted 2 document(s) on stdout, expected exactly 1");
  });
});
