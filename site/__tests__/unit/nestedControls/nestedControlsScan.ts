/*
 * The scan half of the nested-controls walk (see `./nestedControlsHarness.ts` for the scope half and the full account):
 * every mark drawer a source draws inside a button or a link, every `InsideControl` drawn off, and the console sources
 * the real-tree case reads.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { forEachChild, ts, withSourceFile } from "../../../../src/lib/tsSyntax.js";
import { chainOf, fileScope, reaches, resolveTag } from "./nestedControlsHarness.js";

/** The `site/` root every path here is relative to. */
export const SITE = join(import.meta.dirname, "../../..");

/** The trees whose sources draw the console: its routes and its components. */
const TREES = ["app", "components"] as const;

/** The tags that draw an interactive element a button may not sit inside: a button, and a link. */
const CONTROLS: ReadonlySet<string> = new Set(["button", "Button", "a", "Link"]);

/** A mark drawn inside a control with nothing telling it so. */
interface NestedMark {
  readonly path: string;
  readonly line: number;
  readonly mark: string;
}

/** One file's marks inside a control: the ones refused, and the ones `InsideControl` shields. */
interface NestedScan {
  readonly refused: readonly NestedMark[];
  readonly shielded: readonly NestedMark[];
}

/** A JSX element's tag, without a namespace: `ui.Button` reads as `Button`. */
function terminalTag({ element }: { element: ts.JsxOpeningLikeElement }): string {
  const tag = element.tagName.getText();
  return tag.slice(tag.lastIndexOf(".") + 1);
}

/**
 * Whether an `InsideControl` provider turns the mark's image ON: only a literal `value={true}`, or the bare `value`
 * shorthand. A `false`, a missing value or one computed at run time is no shield, since the mark would draw its
 * button under it.
 */
function shieldsOn({ element }: { element: ts.JsxOpeningElement }): boolean {
  const value = element.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.getText() === "value",
  );
  if (value === undefined || !ts.isJsxAttribute(value)) {
    return false;
  }
  if (value.initializer === undefined) {
    return true;
  }
  return ts.isJsxExpression(value.initializer) && value.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword;
}

/**
 * Every mark drawer one source draws inside a control, split by whether an `InsideControl` sits between the two.
 *
 * @param path the file, relative to `site/`, for the report and its imports
 * @param source the file's text
 * @param drawers the components that reach the mark, as `module#name`
 * @param shields every name `InsideControl` is reachable by
 * @returns the refused and the shielded
 */
export function nestedScan({
  path,
  source,
  drawers,
  shields,
}: {
  path: string;
  source: string;
  drawers: ReadonlySet<string>;
  shields: ReadonlySet<string>;
}): NestedScan {
  const scope = fileScope({ path, source });
  const refused: NestedMark[] = [];
  const shielded: NestedMark[] = [];
  withSourceFile({
    fileName: path,
    text: source,
    scriptKind: ts.ScriptKind.TSX,
    use: (file) => {
      const inside = ({ node, shield }: { node: ts.Node; shield: boolean }): void => {
        let shieldBelow = shield;
        const shieldTag = ts.isJsxElement(node)
          ? resolveTag({ scope, tag: node.openingElement.tagName.getText() })
          : undefined;
        if (ts.isJsxElement(node) && shieldTag !== undefined && shields.has(shieldTag)) {
          shieldBelow = shieldsOn({ element: node.openingElement });
        }
        // Any reference, not only a tag: `{renderMark()}` and `{markElement}` reach the mark as surely as `<Mark />`. The
        // outermost one that reaches is reported once; one that does not is searched inward, so `marks?.draw()` still
        // finds `marks`.
        const isChain = ts.isIdentifier(node) || ts.isPropertyAccessExpression(node);
        const tag = isChain && !ts.isJsxClosingElement(node.parent) ? chainOf({ node }) : undefined;
        const resolved = tag === undefined ? undefined : resolveTag({ scope, tag });
        if (tag !== undefined && resolved !== undefined && reaches({ drawers, key: resolved })) {
          const found = { line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1, mark: tag, path };
          (shield ? shielded : refused).push(found);
          return;
        }
        forEachChild({
          node,
          visit: (child) => {
            inside({ node: child, shield: shieldBelow });
          },
        });
      };
      const visit = (node: ts.Node): void => {
        if (ts.isJsxElement(node) && CONTROLS.has(terminalTag({ element: node.openingElement }))) {
          for (const child of node.children) {
            inside({ node: child, shield: false });
          }
          return;
        }
        forEachChild({ node, visit });
      };
      visit(file);
    },
  });
  return { refused, shielded };
}

/**
 * Every line one source draws the mark's own `InsideControl` with anything but its value on, or self-closing whatever
 * its value, since a provider with no children shields nothing. A provider is only ever there to turn the image on,
 * and one turned off inside a component would undo a shield the walk above credited.
 *
 * @returns the 1-based lines of each such provider
 */
export function offShields({
  path,
  source,
  shields,
}: {
  path: string;
  source: string;
  shields: ReadonlySet<string>;
}): readonly number[] {
  const scope = fileScope({ path, source });
  const lines: number[] = [];
  withSourceFile({
    fileName: path,
    text: source,
    scriptKind: ts.ScriptKind.TSX,
    use: (file) => {
      const isShield = ({ tag }: { tag: string }): boolean => {
        const resolved = resolveTag({ scope, tag });
        return resolved !== undefined && shields.has(resolved);
      };
      const visit = (node: ts.Node): void => {
        const line = (): number => file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        if (ts.isJsxSelfClosingElement(node) && isShield({ tag: node.tagName.getText() })) {
          lines.push(line());
        }
        if (
          ts.isJsxOpeningElement(node) &&
          isShield({ tag: node.tagName.getText() }) &&
          !shieldsOn({ element: node })
        ) {
          lines.push(line());
        }
        forEachChild({ node, visit });
      };
      visit(file);
    },
  });
  return lines;
}

/**
 * Every `.tsx` and `.jsx` the console is drawn from, relative to `site/`: the docs route is plain JSX.
 *
 * @returns each such path, `app/` then `components/`
 */
export function consoleSources(): readonly string[] {
  return TREES.flatMap((tree) =>
    readdirSync(join(SITE, tree), { encoding: "utf8", recursive: true })
      .filter((name) => name.endsWith(".tsx") || name.endsWith(".jsx"))
      .map((name) => `${tree}/${name.split("\\").join("/")}`),
  );
}
