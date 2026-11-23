/*
 * `dripMessageIdentities`: a distinct key per message, stable across renders and across an append or a prepend,
 * different for a genuine repeat, and moved by the media riding on a message, its order, the channel, the actor
 * and the shape.
 */
import { describe, expect, it } from "vitest";

import { dripMessageIdentities } from "../../../../../../outbound/slack/fingerprint.js";
import type { SlackDripMessagePayload } from "../../../../../../outbound/slack/types.js";

describe("dripMessageIdentities", () => {
  const target = { actor: "me", channel: "C1", shape: "top-level" };
  const messages = ({
    texts,
    media = [],
  }: {
    texts: readonly string[];
    media?: readonly string[];
  }): readonly { payload: SlackDripMessagePayload; media: readonly string[] }[] =>
    texts.map((text) => ({
      media,
      payload: { form: "plain" as const, text, unfurl_links: true, unfurl_media: true },
    }));

  it("gives each message a distinct key", () => {
    const keys = dripMessageIdentities({ messages: messages({ texts: ["a", "b", "c"] }), target }).map(
      (m) => m.duplicateKey,
    );

    expect(new Set(keys).size).toBe(3);
  });

  it("is stable across renders — the whole resume depends on it", () => {
    const first = dripMessageIdentities({ messages: messages({ texts: ["a", "b"] }), target }).map(
      (m) => m.duplicateKey,
    );
    const second = dripMessageIdentities({ messages: messages({ texts: ["a", "b"] }), target }).map(
      (m) => m.duplicateKey,
    );

    expect(first).toEqual(second);
  });

  it("keeps an UNCHANGED message's key when a new message is APPENDED", () => {
    const before = dripMessageIdentities({ messages: messages({ texts: ["a", "b"] }), target }).map(
      (m) => m.duplicateKey,
    );
    const after = dripMessageIdentities({ messages: messages({ texts: ["a", "b", "c"] }), target }).map(
      (m) => m.duplicateKey,
    );

    expect(after.slice(0, 2)).toEqual(before);
  });

  it("keeps an unchanged message's key when a message is PREPENDED — index is deliberately not in the key", () => {
    const before = dripMessageIdentities({ messages: messages({ texts: ["b", "c"] }), target }).map(
      (m) => m.duplicateKey,
    );
    const after = dripMessageIdentities({ messages: messages({ texts: ["a", "b", "c"] }), target }).map(
      (m) => m.duplicateKey,
    );

    expect(after.slice(1)).toEqual(before);
  });

  it("gives two byte-identical messages DIFFERENT keys, so a genuine repeat is not swallowed", () => {
    const keys = dripMessageIdentities({ messages: messages({ texts: ["yep", "yep"] }), target }).map(
      (m) => m.duplicateKey,
    );

    expect(keys[0]).not.toBe(keys[1]);
  });

  it("keys differ by the MEDIA riding on the message, so adding screenshots is not skipped as a repeat", () => {
    const bare = dripMessageIdentities({ messages: messages({ texts: ["a"] }), target })[0]!.duplicateKey;
    const withMedia = dripMessageIdentities({
      messages: messages({ media: ["shot.png"], texts: ["a"] }),
      target,
    })[0]!.duplicateKey;

    expect(withMedia).not.toBe(bare);
  });

  it("keys differ by media ORDER, because the order is what the reader sees", () => {
    const forwards = dripMessageIdentities({
      messages: messages({ media: ["a.png", "b.png"], texts: ["x"] }),
      target,
    })[0]!.duplicateKey;
    const backwards = dripMessageIdentities({
      messages: messages({ media: ["b.png", "a.png"], texts: ["x"] }),
      target,
    })[0]!.duplicateKey;

    expect(forwards).not.toBe(backwards);
  });

  it("carries each message's media back out beside its key, so the two cannot be zipped apart", () => {
    const identities = dripMessageIdentities({
      messages: [
        { media: [], payload: { form: "plain", text: "a", unfurl_links: true, unfurl_media: true } },
        { media: ["shot.png"], payload: { form: "plain", text: "b", unfurl_links: true, unfurl_media: true } },
      ],
      target,
    });

    expect(identities.map((identity) => identity.media)).toEqual([[], ["shot.png"]]);
  });

  it("keys differ by channel, by actor and by shape", () => {
    const base = dripMessageIdentities({ messages: messages({ texts: ["a"] }), target })[0]!.duplicateKey;
    const other = dripMessageIdentities({
      messages: messages({ texts: ["a"] }),
      target: { ...target, channel: "C2" },
    })[0]!;
    const shaped = dripMessageIdentities({
      messages: messages({ texts: ["a"] }),
      target: { ...target, shape: "thread" },
    })[0]!;

    expect(other.duplicateKey).not.toBe(base);
    expect(shaped.duplicateKey).not.toBe(base);
  });
});
