import { describe, expect, it } from "vitest";
import { err, ok } from "../../../../lib/result.js";
import { type AliasedBatchRead, aliasedFleetRead } from "../../../../live/github/aliasedFleetRead.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";

/** One item, distinguishable by identity, which is how the read keys its answers. */
interface Item {
  readonly name: string;
}

const items = (...names: readonly string[]): readonly Item[] => names.map((name) => ({ name }));

/**
 * A batch read that refuses any batch containing a POISON item, and otherwise answers every item.
 *
 * `calls` records the SIZE of each batch attempted, which is what makes the halving itself falsifiable
 * rather than only its outcome.
 */
const refusing = ({
  poison,
}: {
  poison: readonly string[];
}): { read: AliasedBatchRead<Item, string>; calls: number[] } => {
  const calls: number[] = [];
  return {
    calls,
    read: ({ items: batch }) => {
      calls.push(batch.length);
      if (batch.some((item) => poison.includes(item.name))) {
        return Promise.resolve(err(GithubLiveErrors.readFailed({ cause: undefined, message: "could not resolve" })));
      }
      return Promise.resolve(ok(batch.map((item) => ({ kind: "read", value: item.name.toUpperCase() }) as const)));
    },
  };
};

describe("aliasedFleetRead", () => {
  it("answers every item in ONE request when nothing fails", async () => {
    const { read, calls } = refusing({ poison: [] });
    const answers = await aliasedFleetRead({ items: items("a", "b", "c"), read });
    expect(answers).toStrictEqual([
      { kind: "read", value: "A" },
      { kind: "read", value: "B" },
      { kind: "read", value: "C" },
    ]);
    expect(calls).toStrictEqual([3]);
  });

  it("splits on failure so ONE bad item never costs the others their answers", async () => {
    const { read } = refusing({ poison: ["c"] });
    const answers = await aliasedFleetRead({ items: items("a", "b", "c", "d"), read });
    expect(answers).toStrictEqual([
      { kind: "read", value: "A" },
      { kind: "read", value: "B" },
      { kind: "unread", why: "could not resolve" },
      { kind: "read", value: "D" },
    ]);
  });

  it("halves rather than retrying one at a time — four items with one bad take four requests", async () => {
    const { read, calls } = refusing({ poison: ["c"] });
    await aliasedFleetRead({ items: items("a", "b", "c", "d"), read });
    expect(calls).toStrictEqual([4, 2, 2, 1, 1]);
  });

  it("reports every item unread when every item is bad, and never invents a value", async () => {
    const { read } = refusing({ poison: ["a", "b"] });
    const answers = await aliasedFleetRead({ items: items("a", "b"), read });
    expect(answers).toStrictEqual([
      { kind: "unread", why: "could not resolve" },
      { kind: "unread", why: "could not resolve" },
    ]);
  });

  it("calls nothing at all for an empty fleet", async () => {
    const { read, calls } = refusing({ poison: [] });
    const answers = await aliasedFleetRead({ items: [], read });
    expect(answers).toStrictEqual([]);
    expect(calls).toStrictEqual([]);
  });

  it("refuses a SHORT batch outright rather than shifting later answers onto the wrong pull request", async () => {
    const read: AliasedBatchRead<Item, string> = ({ items: batch }) =>
      Promise.resolve(ok(batch.slice(1).map((item) => ({ kind: "read", value: item.name }) as const)));
    const answers = await aliasedFleetRead({ items: items("a", "b"), read });
    const why =
      "the read answered 1 of 2 pull request(s), so no answer could be attributed to the pull request it was about";
    expect(answers).toStrictEqual([
      { kind: "unread", why },
      { kind: "unread", why },
    ]);
  });

  it("refuses a LONG batch too, because an extra entry means the alignment is unknowable either way", async () => {
    const read: AliasedBatchRead<Item, string> = ({ items: batch }) =>
      Promise.resolve(ok([...batch, ...batch].map((item) => ({ kind: "read", value: item.name }) as const)));
    const answers = await aliasedFleetRead({ items: items("a", "b"), read });
    expect(answers.map((answer) => answer.kind)).toStrictEqual(["unread", "unread"]);
  });
});

describe("aliasedFleetRead — two items that are the same value", () => {
  it("answers BOTH of them, which is what an item-keyed map could not do", async () => {
    const { read } = refusing({ poison: [] });
    const same = { name: "same" };
    const answers = await aliasedFleetRead({ items: [same, same], read });
    expect(answers).toStrictEqual([
      { kind: "read", value: "SAME" },
      { kind: "read", value: "SAME" },
    ]);
  });

  it("answers one of two equal items unread without losing the other", async () => {
    const same = { name: "same" };
    const read: AliasedBatchRead<Item, string> = ({ items: batch }) =>
      Promise.resolve(
        ok(
          batch.map((item, index) =>
            index === 0
              ? ({ kind: "unread", why: "no answer for the first" } as const)
              : ({ kind: "read", value: item.name } as const),
          ),
        ),
      );
    const answers = await aliasedFleetRead({ items: [same, same], read });
    expect(answers).toStrictEqual([
      { kind: "unread", why: "no answer for the first" },
      { kind: "read", value: "same" },
    ]);
  });
});
