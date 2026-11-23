import { describe, expect, it } from "vitest";

import { callsIn } from "../prLeadWalk.js";

const CARD = [".postCard", "api.postCard"];
const POLL = [".postPoll", "api.postPoll"];

/** One grammar case: `text` walked as `path`, and every invocation it must yield. */
function grammarCase({
  expected,
  name,
  path = "fixture.ts",
  text,
}: {
  expected: readonly { keys: readonly string[]; within: string }[];
  name: string;
  path?: string;
  text: string;
}): { expected: readonly { keys: readonly string[]; within: string }[]; name: string; path: string; text: string } {
  return { expected, name, path, text };
}

describe("callsIn — the declared grammar", () => {
  it.each([
    grammarCase({
      expected: [{ keys: ["sendCard"], within: "f" }],
      name: "an identifier",
      text: "function f() { sendCard({}); }",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "f" }],
      name: "a member by name, through a comment and an optional call",
      text: "function f() { (api) /* the card */ .postCard?.({}); }",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "f" }],
      name: "a member by a quoted key",
      text: 'function f() { api["postCard"]({}); }',
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "f" }],
      name: "a member by a template key",
      text: "function f() { api[`postCard`]({}); }",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "f" }],
      name: "a quoted key under every erased wrapper",
      text: 'function f() { api[(<string>("postCard" as string)!) satisfies string]({}); }',
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "f" }],
      name: "a callee under every erased wrapper",
      text: "function f() { ((<Post>(api.postCard as Post)!) satisfies Post)({}); }",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "f" }],
      name: "a callee under an instantiation expression",
      text: "function f() { (api.postCard<unknown>)({}); }",
    }),
    grammarCase({
      expected: [{ keys: [...CARD, ...POLL], within: "f" }],
      name: "a conditional callee",
      text: "function f() { (flag ? api.postCard : api.postPoll)({}); }",
    }),
    grammarCase({
      expected: [{ keys: [...CARD, ...POLL], within: "f" }],
      name: "a logical callee",
      text: "function f() { (api.postCard ?? api.postPoll)({}); }",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "f" }],
      name: "a comma callee",
      text: "function f() { (0, api.postCard)({}); }",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "f" }],
      name: "an awaited callee",
      text: "async function f() { (await api.postCard)({}); }",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "f" }],
      name: "a new expression",
      text: "function f() { new api.postCard({}); }",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "f" }],
      name: "a tagged template",
      text: "function f() { api.postCard`card`; }",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "f" }],
      name: "a decorator",
      text: "function f() { @api.postCard class Card {} }",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "f" }],
      name: "a JSX tag",
      path: "fixture.tsx",
      text: "function f() { return <api.postCard />; }",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "f" }],
      name: "a JavaScript module, which the compiler checks too",
      path: "fixture.mjs",
      text: "export function f() { return api.postCard({}); }",
    }),
    grammarCase({
      expected: [
        { keys: ['?api[pick("postCard")]'], within: "f" },
        { keys: ["pick"], within: "f" },
      ],
      name: "a computed key, unkeyed and carrying its text",
      text: 'function f() { api[pick("postCard")]({}); }',
    }),
    grammarCase({
      expected: [
        { keys: [...CARD, '?api[pick("postCard")]'], within: "f" },
        { keys: ["pick"], within: "f" },
      ],
      name: "a composite with one unkeyable branch, which keeps its own marker",
      text: 'function f() { (flag ? api.postCard : api[pick("postCard")])({}); }',
    }),
    grammarCase({
      expected: [{ keys: [".call", ...CARD], within: "f" }],
      name: "a function run by .call",
      text: "function f() { api.postCard.call(api, {}); }",
    }),
    grammarCase({
      expected: [{ keys: [".apply", ...CARD], within: "f" }],
      name: "a function run by .apply",
      text: "function f() { api.postCard.apply(api, [{}]); }",
    }),
    grammarCase({
      expected: [{ keys: [".call", ...CARD], within: "f" }],
      name: "a function run by a quoted call key",
      text: 'function f() { api.postCard["call"](api, {}); }',
    }),
    grammarCase({
      expected: [{ keys: [".apply", ...CARD], within: "f" }],
      name: "a function run by a quoted apply key under an erased wrapper",
      text: 'function f() { api["postCard"][("apply" as const)](api, [{}]); }',
    }),
    grammarCase({
      expected: [{ keys: [".apply", "Reflect.apply", ...CARD], within: "f" }],
      name: "a function run by Reflect.apply",
      text: "function f() { Reflect.apply(api.postCard, api, [{}]); }",
    }),
    grammarCase({
      expected: [{ keys: [".construct", "Reflect.construct", ...CARD], within: "f" }],
      name: "a function run by Reflect.construct",
      text: "function f() { Reflect.construct(api.postCard, [{}]); }",
    }),
    grammarCase({
      expected: [
        { keys: ["?api.postCard.bind(api)"], within: "f" },
        { keys: [".bind"], within: "f" },
      ],
      name: "a bound function invoked at once, unkeyed and carrying its text",
      text: "function f() { api.postCard.bind(api)({}); }",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "publish" }],
      name: "a function held by a variable",
      text: "const publish = () => api.postCard({});",
    }),
    grammarCase({
      expected: [
        { keys: ["door"], within: "<module>" },
        { keys: CARD, within: "publish" },
      ],
      name: "a function held by an object property",
      text: "door({ publish: () => api.postCard({}) });",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "publish" }],
      name: "a function held by a class field",
      text: "class K { publish = () => api.postCard({}); }",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "publish" }],
      name: "a function held by a binding element's default",
      text: "const { publish = () => api.postCard({}) } = source;",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "install/publish" }],
      name: "a function held by a parameter's default",
      text: "function install({ publish = () => api.postCard({}) } = {}) {}",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "publish" }],
      name: "a function held by a shorthand destructuring default",
      text: "({ publish = () => api.postCard({}) } = source);",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "publish" }],
      name: "a function held by an assignment target",
      text: "publisher.publish = () => api.postCard({});",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "default" }],
      name: "a function held by export default",
      text: "export default () => api.postCard({});",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "default" }],
      name: "an anonymous default function declaration",
      text: "export default function () { api.postCard({}); }",
    }),
    grammarCase({
      expected: [
        { keys: CARD, within: "constructor" },
        { keys: CARD, within: "publish#1" },
        { keys: CARD, within: "publish#2" },
      ],
      name: "a constructor and two accessors",
      text: "class K { constructor() { api.postCard({}); } get publish() { api.postCard({}); return 1; } set publish(v) { api.postCard({}); } }",
    }),
    grammarCase({
      expected: [
        { keys: ["door"], within: "<module>" },
        { keys: CARD, within: "publish" },
      ],
      name: "a named function expression",
      text: "door(function publish() { api.postCard({}); });",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "publish" }],
      name: "a held function under every erased wrapper, an instantiation included",
      text: "const publish = ((<T,>() => api.postCard({}))<unknown> satisfies Later) as Later;",
    }),
    grammarCase({
      expected: [
        { keys: ["door"], within: "f" },
        { keys: CARD, within: "f" },
      ],
      name: "an anonymous callback, counted toward the function around it",
      text: "function f() { door(() => api.postCard({})); }",
    }),
    grammarCase({
      expected: [{ keys: CARD, within: "<module>" }],
      name: "a class static block, counted toward the scope around it",
      text: "class K { static { api.postCard({}); } }",
    }),
  ])("$name", ({ expected, path, text }) => {
    expect(callsIn({ path, text })).toEqual(expected);
  });

  it("tells two same-named functions apart, so a write moved from one to the other changes its key", () => {
    const text = [
      "function send() {",
      "  door({ perform: () => sendCard({}) });",
      "  door({ perform: () => api.postCard({}) });",
      "}",
    ].join("\n");
    expect(callsIn({ path: "fixture.ts", text }).filter(({ keys }) => keys[0] !== "door")).toEqual([
      { keys: ["sendCard"], within: "send/perform#1" },
      { keys: CARD, within: "send/perform#2" },
    ]);
  });
});
