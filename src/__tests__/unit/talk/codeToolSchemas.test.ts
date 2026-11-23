/**
 * `codeToolSchemas.ts` — the checkout's three code tools, every one a read through `talk code`, first in the voice's
 * tool list.
 */
import { describe, expect, it } from "vitest";

import { CODE_TOOLS } from "../../../talk/codeToolSchemas.js";
import { TALK_TOOLS } from "../../../talk/talkToolSchemas.js";

describe("the code tools", () => {
  it("read through `talk code`, and open the voice's tool list in their own order", () => {
    expect(CODE_TOOLS.map((tool) => [tool.name, tool.kind, tool.runs])).toEqual([
      ["code_find", "read", { noun: "talk", verb: "code" }],
      ["code_read", "read", { noun: "talk", verb: "code" }],
      ["code_list", "read", { noun: "talk", verb: "code" }],
    ]);
    expect(TALK_TOOLS.slice(0, 3).map((tool) => tool.name)).toEqual(["code_find", "code_read", "code_list"]);
  });
});
