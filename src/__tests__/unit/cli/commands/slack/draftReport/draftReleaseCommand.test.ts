/*
 * `draftReleaseCommand`: the command the queue card and `draft show` both print parses as the `slack post` or
 * `slack reply` release naming this row and its digest, so the printed command is true.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseSlackWriteArgs } from "../../../../../../cli/commands/slack/coreArgs.js";
import { draftRelease, draftReleaseCommand } from "../../../../../../cli/commands/slack/draftReport.js";
import { unwrap } from "../../../../../../lib/result.js";
import { item } from "./harness.js";

describe("draftReleaseCommand — the command the queue card and `draft show` both print", () => {
  it("parses as a `slack post` release naming this row and its digest, so the printed command is true", () => {
    const row = item();
    const [binary, noun, verb, ...rest] = draftReleaseCommand({ item: row }).split(" ");
    expect([binary, noun, verb]).toEqual(["slopweaver", "slack", "post"]);
    expect(unwrap(parseSlackWriteArgs({ defaultHome: "/h", rest, verb: "post" }))).toEqual({
      actor: "me",
      dryRun: false,
      formSource: undefined,
      home: "/h",
      json: false,
      release: { approve: row.draft.digest, draftId: "sd-11111111" },
      resendUnconfirmed: false,
      verb: "post",
    });
  });

  it("parses a thread row's command as a `slack reply` release — the verb the release accepts for it", () => {
    const row = item({ over: { shape: "thread", threadTs: "1789407961.767649" } });
    const [binary, noun, verb, ...rest] = draftReleaseCommand({ item: row }).split(" ");
    expect([binary, noun, verb]).toEqual(["slopweaver", "slack", "reply"]);
    expect(unwrap(parseSlackWriteArgs({ defaultHome: "/h", rest, verb: "reply" }))).toEqual({
      actor: "me",
      dryRun: false,
      formSource: undefined,
      home: "/h",
      json: false,
      release: { approve: row.draft.digest, draftId: "sd-11111111" },
      resendUnconfirmed: false,
      verb: "reply",
    });
  });

  it("is the command the /queue card prints, and that one parses as the same release", async () => {
    const { postCard } = await queueCardModule();
    const row = item({ over: { shape: "thread", threadTs: "1789407961.767649" } });
    const card = postCard({
      post: {
        addressed: "in a thread in #iso-27001",
        advisory: [],
        digest: row.draft.digest,
        id: row.id,
        mentions: [],
        parent: "under the thread rooted at 1789407961.767649",
        release: draftRelease({ item: row }),
        text: "Four groups, one question.",
        why: "the entry-group question",
      },
    });
    const [binary, noun, verb, ...rest] = elsewhereCommand({ how: card.options[0]!.how }).split(" ");
    expect([binary, noun, verb]).toEqual(["slopweaver", "slack", "reply"]);
    expect(unwrap(parseSlackWriteArgs({ defaultHome: "/h", rest, verb: "reply" }))).toEqual({
      actor: "me",
      dryRun: false,
      formSource: undefined,
      home: "/h",
      json: false,
      release: { approve: row.draft.digest, draftId: "sd-11111111" },
      resendUnconfirmed: false,
      verb: "reply",
    });
  });
});

/** The one slice of `site/lib/postCard.ts` this file reads: a card's options and how each one is taken. */
interface QueueCardModule {
  readonly postCard: (args: { post: Record<string, unknown> }) => {
    readonly options: readonly { readonly how: { readonly kind: string; readonly command?: string } }[];
  };
}

/**
 * Load the console's card module at RUN time. The two trees build separately — `src`'s `rootDir` refuses a
 * static import of `site/`, and the site build cannot resolve `src`'s dependencies — while vitest runs both,
 * so a runtime import is the one seam that tests the command the card really prints.
 */
async function queueCardModule(): Promise<QueueCardModule> {
  const path = fileURLToPath(new URL("../../../../../../../site/lib/postCard.ts", import.meta.url));
  return (await import(path)) as QueueCardModule;
}

/** The command an `elsewhere` option prints, failing loudly rather than reading `undefined` off another kind. */
function elsewhereCommand({ how }: { how: { readonly kind: string; readonly command?: string } }): string {
  if (how.kind !== "elsewhere" || how.command === undefined) {
    throw new Error(`expected an elsewhere option carrying a command, got ${how.kind}`);
  }
  return how.command;
}
