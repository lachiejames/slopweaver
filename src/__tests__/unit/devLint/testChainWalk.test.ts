import { describe, expect, it } from "vitest";
import { forEachChild, type LentAnswer, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";

import {
  accessNames,
  calleeOf,
  chainModifiers,
  isChainBuildingCall,
  memberAccess,
  rootIdentifier,
  unwrapWrappers,
} from "../../../devLint/testChainWalk.js";

/**
 * Parse one expression statement and hand its expression to `use`, with parent pointers set. `use` must answer
 * plain data: the tree is released when it returns.
 *
 * `isChainBuildingCall` walks UPWARDS, so the parse has to retain parents — a source built without them
 * throws on the first `.parent` read rather than answering wrongly, which would make every case here pass
 * for the wrong reason.
 */
function withExpression<R>({
  source,
  use,
}: {
  source: string;
  use: (expression: ts.Expression) => LentAnswer<R>;
}): LentAnswer<R> {
  return withSourceFile({
    fileName: "probe.ts",
    text: source,
    use: (file) => use(file.statements.find((each) => ts.isExpressionStatement(each))!.expression),
  });
}

/** Hand every call expression in one source, outermost first, to `use`, which must answer plain data. */
function withCalls<R>({
  source,
  use,
}: {
  source: string;
  use: (calls: readonly ts.CallExpression[]) => LentAnswer<R>;
}): LentAnswer<R> {
  return withSourceFile({
    fileName: "probe.ts",
    text: source,
    use: (file) => {
      const found: ts.CallExpression[] = [];
      const visit: NodeVisitor = (node) => {
        if (ts.isCallExpression(node)) found.push(node);
        forEachChild({ node, visit });
      };
      forEachChild({ node: file, visit });
      return use(found);
    },
  });
}

describe("unwrapWrappers", () => {
  it("strips every value-preserving wrapper down to the identifier", () => {
    withExpression({
      source: "((it! as never) satisfies unknown);",
      use: (node) => {
        const stripped = unwrapWrappers({ node });
        expect(ts.isIdentifier(stripped)).toBe(true);
        expect((stripped as ts.Identifier).text).toBe("it");
      },
    });
  });

  it("strips the angle-bracket assertion spelling too", () => {
    withExpression({
      source: "(<never>it);",
      use: (node) => {
        expect((unwrapWrappers({ node }) as ts.Identifier).text).toBe("it");
      },
    });
  });

  it("returns a node that carries no wrapper unchanged", () => {
    withExpression({
      source: "it;",
      use: (node) => {
        expect(unwrapWrappers({ node })).toBe(node);
      },
    });
  });
});

describe("memberAccess", () => {
  it("reads the dotted spelling", () => {
    withExpression({
      source: "it.skip;",
      use: (node) => {
        const hop = memberAccess({ node })!;
        expect(hop.name).toBe("skip");
        expect((hop.object as ts.Identifier).text).toBe("it");
      },
    });
  });

  it("reads the bracket spelling as the same property", () => {
    withExpression({
      source: 'it["skip"];',
      use: (node) => {
        expect(memberAccess({ node })!.name).toBe("skip");
      },
    });
  });

  it("unwraps a parenthesised key rather than giving up on it", () => {
    withExpression({
      source: 'it[("only")];',
      use: (node) => {
        expect(memberAccess({ node })!.name).toBe("only");
      },
    });
  });

  it("leaves a computed key it cannot resolve unread", () => {
    withExpression({
      source: "it[modifier];",
      use: (node) => {
        expect(memberAccess({ node })).toBe(undefined);
      },
    });
  });

  it("is undefined on something that is not a member access at all", () => {
    withExpression({
      source: "it;",
      use: (node) => {
        expect(memberAccess({ node })).toBe(undefined);
      },
    });
  });
});

describe("rootIdentifier", () => {
  it("walks through a call to the identifier the chain hangs off", () => {
    expect(withExpression({ source: "expect(value).not.toBe(other);", use: (node) => rootIdentifier({ node }) })).toBe(
      "expect",
    );
  });

  it("treats a template tag as a hop like any other", () => {
    expect(withExpression({ source: "it.each`a`;", use: (node) => rootIdentifier({ node }) })).toBe("it");
  });

  it("is undefined when the chain bottoms out on something that is not an identifier", () => {
    expect(withExpression({ source: '"literal".trim();', use: (node) => rootIdentifier({ node }) })).toBe(undefined);
  });
});

describe("chainModifiers", () => {
  it("names every hop last-applied first, carrying each one's own sole argument", () => {
    withExpression({
      source: "it.skipIf(true).skipIf(false);",
      use: (node) => {
        const hops = chainModifiers({ node });
        expect(hops.map((hop) => hop.name)).toEqual(["skipIf", "skipIf"]);
        expect(hops[0]!.argument!.kind).toBe(ts.SyntaxKind.FalseKeyword);
        expect(hops[1]!.argument!.kind).toBe(ts.SyntaxKind.TrueKeyword);
      },
    });
  });

  it("carries no argument for a hop that was never called", () => {
    withExpression({
      source: "it.skipIf(false).skip;",
      use: (node) => {
        const hops = chainModifiers({ node });
        expect(hops.map((hop) => hop.name)).toEqual(["skip", "skipIf"]);
        expect(hops[0]!.argument).toBe(undefined);
        expect(hops[1]!.argument!.kind).toBe(ts.SyntaxKind.FalseKeyword);
      },
    });
  });

  it("carries no argument for a call that took more than one", () => {
    withExpression({
      source: "it.each(1, 2).skip;",
      use: (node) => {
        const hops = chainModifiers({ node });
        expect(hops.map((hop) => hop.name)).toEqual(["skip", "each"]);
        expect(hops[1]!.argument).toBe(undefined);
      },
    });
  });

  it("returns an empty chain for a bare identifier", () => {
    withExpression({
      source: "it;",
      use: (node) => {
        expect(chainModifiers({ node })).toEqual([]);
      },
    });
  });
});

describe("accessNames", () => {
  it("drops the arguments and keeps the names", () => {
    expect(withExpression({ source: "it.concurrent.skipIf(false);", use: (node) => accessNames({ node }) })).toEqual([
      "skipIf",
      "concurrent",
    ]);
  });
});

describe("calleeOf", () => {
  it("reads the callee of a call", () => {
    expect(
      withExpression({
        source: "it.skip('a', fn);",
        use: (node) => rootIdentifier({ node: calleeOf({ node })! }),
      }),
    ).toBe("it");
  });

  it("reads the tag of a tagged template", () => {
    expect(
      withExpression({
        source: "it.each`a`;",
        use: (node) => rootIdentifier({ node: calleeOf({ node })! }),
      }),
    ).toBe("it");
  });

  it("is undefined for a node that invokes nothing", () => {
    withExpression({
      source: "it.skip;",
      use: (node) => {
        expect(calleeOf({ node })).toBe(undefined);
      },
    });
  });
});

describe("isChainBuildingCall", () => {
  it("is true for the inner calls and false for the one in run position", () => {
    withCalls({
      source: 'describe.skipIf(true).skipIf(false)("s", fn);',
      use: (calls) => {
        expect(calls.length).toBe(3);
        expect(isChainBuildingCall({ node: calls[0]! })).toBe(false);
        expect(isChainBuildingCall({ node: calls[1]! })).toBe(true);
        expect(isChainBuildingCall({ node: calls[2]! })).toBe(true);
      },
    });
  });

  it("steps through a parenthesis between the chain and its invocation", () => {
    withCalls({
      source: '(it.skipIf(false))("a", fn);',
      use: (calls) => {
        expect(calls.length).toBe(2);
        expect(isChainBuildingCall({ node: calls[0]! })).toBe(false);
        expect(isChainBuildingCall({ node: calls[1]! })).toBe(true);
      },
    });
  });

  it("is true for a call a further property access hangs off", () => {
    withCalls({
      source: "it.each([1]).skip;",
      use: (calls) => {
        expect(calls.length).toBe(1);
        expect(isChainBuildingCall({ node: calls[0]! })).toBe(true);
      },
    });
  });

  it("is false for a standalone call nothing encloses", () => {
    withCalls({
      source: 'it("a", fn);',
      use: (calls) => {
        expect(isChainBuildingCall({ node: calls[0]! })).toBe(false);
      },
    });
  });
});
