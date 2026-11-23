/**
 * The TypeScript seam for a HOT path: the one syntax question a board read asks, with the compiler loaded the first
 * time that question is asked rather than when this module is imported.
 *
 * `src/lib/tsSyntax.ts` imports the compiler at module load, which is right for a gate that parses every file it
 * opens and wrong for `src/handover/probe.ts`, which every verb that reads the board imports and most of them never
 * ask a structural question of. MEASURED, a static import cost `hand list --json` 106ms of every console
 * read that ran it — repro: `NODE_DEBUG=module node dist-cli/cli/index.js hand list --json 2>&1 | grep -c typescript/dist`
 * (0 when nothing loaded the library). So this is a seam file of its own, kept behind the `typescript-import-seam`
 * gate with the other three, and it answers a question rather than handing out the compiler.
 */
import { createRequire } from "node:module";
import type * as TsAst from "typescript/ast";
import type * as TsSync from "typescript/sync";

import { lazyTypeScriptClient } from "./tsLifecycle.js";

/** The two halves of the library this seam needs, its own parsing client, and that client's close. */
interface Loaded {
  readonly ast: typeof TsAst;
  readonly api: TsSync.API;
  readonly close: () => void;
}

/** Load one module by id, synchronously, the way this file's own `require` would. */
type Load = <M>(id: string) => M;

/**
 * The library, loaded on first use, and a client started then too, with its close registered at that same moment,
 * never at import — so a board read that asks no structural question loads and registers nothing. A use after
 * `closeTypeScript()` starts a fresh client.
 */
const typescript = lazyTypeScriptClient({
  open: (): Loaded => {
    const require: Load = createRequire(import.meta.url);
    const ast = require<typeof TsAst>("typescript/ast");
    const { API } = require<typeof TsSync>("typescript/sync");
    const api = new API({ cwd: process.cwd() });
    return {
      api,
      ast,
      close: () => {
        api.close();
      },
    };
  },
});

/**
 * Whether `symbol` appears as a real `Identifier` node in `text` — never inside a comment or a string literal.
 *
 * @param text TypeScript source, parsed as a `.ts` file
 * @param symbol the identifier's exact spelling
 * @returns true when some `Identifier` node in the tree spells `symbol`
 */
export function identifierReferenced({ text, symbol }: { text: string; symbol: string }): boolean {
  const { ast, api } = typescript();
  const retained = api.createSourceFile("probe.ts", text, { scriptKind: ast.ScriptKind.TS });
  try {
    const visit = (node: TsAst.Node): boolean | undefined =>
      (ast.isIdentifier(node) && node.text === symbol) || node.forEachChild(visit);
    return visit(retained.sourceFile) === true;
  } finally {
    retained.dispose();
  }
}
