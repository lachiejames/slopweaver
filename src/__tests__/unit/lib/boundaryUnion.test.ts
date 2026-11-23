import { describe, expect, it } from "vitest";
import { z } from "zod";

import { untellableTagRefusals, untellableUnionRefusals } from "../../../lib/boundaryUnion.js";

const human = z.strictObject({ text: z.string(), user: z.string() });
const bot = z.strictObject({ bot_id: z.string(), text: z.string() });
const refusal = ({ count, kind }: { count: number; kind: string }): string =>
  `(body) is a z.union with ${String(count)} arms that read ${kind}s, so a refusal could not say which one was sent — spell it z.discriminatedUnion on the field that tells them apart, or one z.strictObject whose differing keys are optional`;
const refused = ({ options }: { options: readonly z.ZodType[] }): readonly string[] =>
  untellableUnionRefusals({ at: "(body)", options });

describe("untellableUnionRefusals", () => {
  it("refuses two arms reading the same kind however they are wrapped, nested or contained", () => {
    expect(refused({ options: [human, bot] })).toEqual([refusal({ count: 2, kind: "object" })]);
    expect(refused({ options: [human.nullable(), bot.optional().readonly()] })).toEqual([
      refusal({ count: 2, kind: "object" }),
    ]);
    expect(refused({ options: [human, z.union([z.null(), bot])] })).toEqual([refusal({ count: 2, kind: "object" })]);
    expect(refused({ options: [z.array(human), z.tuple([bot])] })).toEqual([refusal({ count: 2, kind: "array" })]);
    expect(refused({ options: [z.record(z.string(), z.number()), z.tuple([z.string()]), human] })).toEqual([
      refusal({ count: 2, kind: "object" }),
    ]);
    expect(refused({ options: [human, z.array(human), bot, z.array(bot)] })).toEqual([
      refusal({ count: 2, kind: "object" }),
      refusal({ count: 2, kind: "array" }),
    ]);
  });

  it("counts a discriminated union as one arm reading objects, and refuses it beside another object", () => {
    const tagged = z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("a") }),
      z.strictObject({ kind: z.literal("b") }),
    ]);

    expect(refused({ options: [z.null(), tagged] })).toEqual([]);
    expect(refused({ options: [tagged, human] })).toEqual([refusal({ count: 2, kind: "object" })]);
  });

  it("allows one arm of each kind beside scalars, and a union of scalars alone", () => {
    expect(refused({ options: [z.string(), human] })).toEqual([]);
    expect(refused({ options: [z.null(), z.literal("gone"), z.array(bot)] })).toEqual([]);
    expect(refused({ options: [human, z.array(human)] })).toEqual([]);
    expect(refused({ options: [z.string(), z.number()] })).toEqual([]);
  });
});

describe("untellableTagRefusals", () => {
  const omittable = ({ index }: { index: number }): string =>
    `(body) arm ${String(index)} may omit its tag "subtype" or answer it null, so a value whose tag was dropped, nulled or renamed reads as that arm — make the tag a required literal on every arm, or spell one z.strictObject whose differing keys are optional`;
  const tagged = ({
    options,
    unionFallback,
  }: {
    options: readonly z.ZodType[];
    unionFallback?: boolean;
  }): readonly string[] => untellableTagRefusals({ at: "(body)", discriminator: "subtype", options, unionFallback });
  const botArm = bot.extend({ subtype: z.literal("bot_message") });

  it("refuses an arm whose tag is optional or defaulted, since a dropped tag reads as that arm", () => {
    expect(tagged({ options: [human.extend({ subtype: z.literal("thread_broadcast").optional() }), botArm] })).toEqual([
      omittable({ index: 0 }),
    ]);
    expect(tagged({ options: [botArm, human.extend({ subtype: z.literal("message").default("message") })] })).toEqual([
      omittable({ index: 1 }),
    ]);
  });

  it("refuses an arm whose tag may be null, and an arm whose wrapper hides its tag from Zod", () => {
    expect(tagged({ options: [human.extend({ subtype: z.literal("thread_broadcast").nullable() }), botArm] })).toEqual([
      omittable({ index: 0 }),
    ]);
    expect(tagged({ options: [botArm, human.extend({ subtype: z.null() })] })).toEqual([omittable({ index: 1 })]);
    expect(tagged({ options: [botArm.nullable(), human.extend({ subtype: z.literal("message") })] })).toEqual([
      '(body) arm 0 declares no tag "subtype" Zod can read, so every read throws — wrap the whole union, never one arm',
    ]);
  });

  it("refuses a nested arm that lacks the outer tag, and a tag value two arms share", () => {
    const joined = z.strictObject({ subtype: z.literal("channel_join"), user: z.string() });
    const message = z.discriminatedUnion("subtype", [botArm.extend({ type: z.literal("message") }), joined]);
    const reaction = z.strictObject({ reaction: z.string(), type: z.literal("reaction_added") });

    expect(
      untellableTagRefusals({
        at: "(body)",
        discriminator: "type",
        options: [message, reaction],
        unionFallback: false,
      }),
    ).toEqual([
      '(body) arm 0.1 declares no tag "type" Zod can read, so every read throws — wrap the whole union, never one arm',
    ]);
    expect(
      untellableTagRefusals({
        at: "(body)",
        discriminator: "kind",
        options: [
          z.strictObject({ kind: z.literal("a") }),
          z.strictObject({ kind: z.enum(["a", "b"]), m: z.number() }),
        ],
        unionFallback: false,
      }),
    ).toEqual([
      '(body) gives the tag "kind" the value a on more than one arm, which Zod throws on at the first read — give each arm its own',
    ]);
  });

  it("looks through .readonly() into a nested union, and refuses a nest on another tag spanning two outer values", () => {
    const hidden = z.discriminatedUnion("sub", [
      z.strictObject({ kind: z.literal("b"), sub: z.literal("1") }),
      z.strictObject({ sub: z.literal("2"), z: z.number() }),
    ]);
    const a = z.strictObject({ kind: z.literal("a"), x: z.number() });
    const byVersion = z.discriminatedUnion("version", [
      z.strictObject({ text: z.string(), type: z.literal("message"), version: z.literal(1) }),
      z.strictObject({ emoji: z.string(), type: z.literal("reaction"), version: z.literal(2) }),
    ]);
    const ping = z.strictObject({ type: z.literal("ping") });

    expect(
      untellableTagRefusals({
        at: "(body)",
        discriminator: "kind",
        options: [a, hidden.readonly()],
        unionFallback: false,
      }),
    ).toEqual([
      '(body) arm 1.1 declares no tag "kind" Zod can read, so every read throws — wrap the whole union, never one arm',
    ]);
    expect(
      untellableTagRefusals({ at: "(body)", discriminator: "type", options: [ping, byVersion], unionFallback: false }),
    ).toEqual([
      '(body) arm 1 is a z.discriminatedUnion on "version" whose arms answer different values of "type", so a drifted "version" reads as an arm of another "type" — give every arm under it one "type", or spell its arms flat',
    ]);
  });

  it("allows a nest on another tag whose arms all answer one outer value", () => {
    const message = z.discriminatedUnion("subtype", [
      z.strictObject({ subtype: z.literal("bot_message"), type: z.literal("message") }),
      z.strictObject({ subtype: z.literal("channel_join"), type: z.literal("message") }),
    ]);
    const reaction = z.strictObject({ reaction: z.string(), type: z.literal("reaction_added") });

    expect(
      untellableTagRefusals({
        at: "(body)",
        discriminator: "type",
        options: [message, reaction],
        unionFallback: false,
      }),
    ).toEqual([]);
  });

  it("refuses unionFallback, which answers an unmatched tag by trying every arm", () => {
    const options = [human.extend({ subtype: z.literal("thread_broadcast") }), botArm];

    expect(tagged({ options, unionFallback: true })).toEqual([
      "(body) is a z.discriminatedUnion with unionFallback, which reads an unmatched tag as a guess between arms",
    ]);
    expect(tagged({ options, unionFallback: false })).toEqual([]);
    expect(tagged({ options })).toEqual([]);
  });
});
