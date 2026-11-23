import { describe, expect, it } from "vitest";

import { walkFile } from "../prLeadWalk.js";

describe("walkFile — a write method used as a value", () => {
  const watch: ReadonlySet<string> = new Set([".postCard", ".postPoll", "api.send", "sendCard"]);

  it.each([
    {
      expected: [".postCard"],
      name: "chained forwarding",
      text: "Function.prototype.call.call(api.postCard, api, {});",
    },
    { expected: [".postCard"], name: "a stored method", text: "const later = api.postCard;" },
    { expected: [".postCard"], name: "a bound method", text: "const later = api.postCard.bind(api);" },
    { expected: [".postCard"], name: "a method passed in an array", text: "door([api.postCard]);" },
    { expected: [".postCard"], name: "a destructured method", text: "const { postCard } = api;" },
    {
      expected: [".postCard"],
      name: "a method destructured by a parameter",
      text: "function f({ postCard }: Deps) {}",
    },
    {
      expected: [".postCard"],
      name: "a method destructured by an assignment",
      text: "let post; ({ postCard: post } = transport);",
    },
    {
      expected: [".postCard", ".postCard"],
      name: "a method destructured by a nested, defaulted or looped assignment",
      text: "[{ postCard: a } = api] = list; for ({ 'postCard': b } of list) {}",
    },
    {
      expected: [".postCard"],
      name: "a method destructured under a computed literal key",
      text: "const { ['postCard']: post } = api;",
    },
    {
      expected: ["sendCard"],
      name: "an entry imported under another name",
      text: "import { sendCard as deliver } from './cardSend.js';",
    },
    {
      expected: ["sendCard"],
      name: "an entry re-exported under another name",
      text: "export { sendCard as deliver } from './cardSend.js';",
    },
    {
      expected: ["sendCard"],
      name: "an entry re-exported under its own name",
      text: "export { sendCard } from './cardSend.js';",
    },
    { expected: ["sendCard"], name: "an entry stored off a namespace", text: "const deliver = cards.sendCard;" },
    { expected: ["api.send"], name: "a stored api.send", text: "const later = api.send;" },
    {
      expected: [],
      name: "an entry imported under its own name, and an object literal that is not a target",
      text: "import { sendCard } from './cardSend.js'; const methods = { postCard: 'words' }; x = { postCard };",
    },
    { expected: [], name: "a different receiver's send", text: "const later = socket.send;" },
    {
      expected: [],
      name: "every form that runs the method where it stands",
      text: "api.postCard({}); api.postCard.call(api, {}); api.postCard['apply'](api, [{}]); Reflect.apply(api.postCard, api, [{}]); (flag ? api.postCard : api.postPoll)({});",
    },
  ])("$name", ({ expected, text }) => {
    expect(walkFile({ path: "fixture.ts", text, watch }).uses.map(({ key }) => key)).toEqual(expected);
  });
});
