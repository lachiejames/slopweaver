import { describe, expect, it } from "vitest";
import { MARK, markDrawers, scopesOf } from "./nestedControlsHarness.js";

describe("markDrawers", () => {
  it("holds the mark and every component reaching it through an import, and not a same-named local that does not", () => {
    const scopes = scopesOf({
      sources: [
        { path: "components/console/WarningMark.tsx", source: `export function WarningMark() { return <button />; }` },
        {
          path: "components/x/Wrapper.tsx",
          source: `import { WarningMark } from "../console/WarningMark";
          export function Wrapper() { return <span><WarningMark facts={[]} /></span>; }`,
        },
        {
          path: "components/x/Outer.tsx",
          source: `import { Wrapper as W } from "@/components/x/Wrapper";
          export const Outer = () => <div><W /></div>;`,
        },
        {
          path: "components/x/Dotted.tsx",
          source: `import { WarningMark } from "@/components/console/../console/WarningMark";
          export const Dotted = () => <div><WarningMark facts={[]} /></div>;`,
        },
        {
          path: "components/y/Other.tsx",
          source: `function Wrapper() { return <span>x</span>; }
          export const Lookalike = () => <div><Wrapper /></div>;`,
        },
      ],
    });
    expect([...markDrawers({ scopes })].toSorted()).toEqual([
      MARK,
      "components/x/Dotted#Dotted",
      "components/x/Outer#Outer",
      "components/x/Wrapper#Wrapper",
    ]);
  });

  it("follows default and namespace imports, re-exports of a name or a namespace, an index file and nested wrappers", () => {
    const scopes = scopesOf({
      sources: [
        { path: "components/console/WarningMark.tsx", source: `export function WarningMark() { return <button />; }` },
        {
          path: "components/x/Wrapper.tsx",
          source: `import { WarningMark } from "../console/WarningMark";
          export default function Wrapper() { return <WarningMark facts={[]} />; }`,
        },
        { path: "components/x/Defaulted.tsx", source: `import W from "./Wrapper"; export const D = () => <W />;` },
        {
          path: "components/x/Anonymous.tsx",
          source: `import { WarningMark } from "../console/WarningMark"; export default () => <WarningMark facts={[]} />;`,
        },
        { path: "components/x/index.tsx", source: `export { default as Wrapped } from "./Wrapper";` },
        { path: "components/y/All.tsx", source: `export * from "../x";` },
        { path: "components/y/Marks.tsx", source: `export * as marks from "../x";` },
        {
          path: "components/z/Deep.tsx",
          source: `import { marks } from "../y/Marks"; export const Deep = () => <marks.Wrapped />;`,
        },
        { path: "components/y/Barrel.tsx", source: `export { marks as M } from "./Marks";` },
        {
          path: "components/z/Local.tsx",
          source: `import * as x from "../x"; export { x as xs }; export const ys = x;`,
        },
        {
          path: "components/z/Near.tsx",
          source: `import { ys } from "./Local"; const R = ys; export const Near = () => <R.Wrapped />;`,
        },
        {
          path: "components/z/Relay.tsx",
          source: `import { marks } from "../y/Marks"; export const Forwarded = marks;`,
        },
        {
          path: "components/z/Kit.tsx",
          source: `import { WarningMark } from "../console/WarningMark"; export const kit = { draw: () => <WarningMark /> };`,
        },
        {
          path: "components/z/UsesKit.tsx",
          source: `import { kit } from "./Kit"; export const K = () => <kit.draw />;`,
        },
        {
          path: "components/z/Name.tsx",
          source: `import { WarningMark } from "../console/WarningMark"; export const MarkName = WarningMark.name;`,
        },
        {
          path: "components/z/Uses.tsx",
          source: `import { Forwarded } from "./Relay"; export const Uses = () => <Forwarded.Wrapped />;`,
        },
        {
          path: "components/z/Far.tsx",
          source: `import { M } from "../y/Barrel"; import { xs } from "./Local";
          export const FarM = () => <M.Wrapped />; export const FarX = () => <xs.Wrapped />;`,
        },
        {
          path: "components/y/Spaced.tsx",
          source: `import * as all from "./All"; import A from "../x/Anonymous";
          const Inner = () => <all.Wrapped />; export const Memo = memo(Inner); export const Anon = () => <A />;
          export const Ns = memo(forwardRef(all.Wrapped)); export const Paren = (() => <A />);
          export const Picked = (on: boolean) => (on ? Inner : null) as unknown;`,
        },
      ],
    });
    expect([...markDrawers({ scopes })].toSorted()).toEqual([
      MARK,
      "components/x#Wrapped",
      "components/x/Anonymous#default",
      "components/x/Defaulted#D",
      "components/x/Wrapper#Wrapper",
      "components/x/Wrapper#default",
      "components/y/All#Wrapped",
      "components/y/Barrel#M.Wrapped",
      "components/y/Marks#marks.Wrapped",
      "components/y/Spaced#Anon",
      "components/y/Spaced#Inner",
      "components/y/Spaced#Memo",
      "components/y/Spaced#Ns",
      "components/y/Spaced#Paren",
      "components/y/Spaced#Picked",
      "components/z/Deep#Deep",
      "components/z/Far#FarM",
      "components/z/Far#FarX",
      "components/z/Kit#kit",
      "components/z/Local#xs.Wrapped",
      "components/z/Local#ys.Wrapped",
      "components/z/Name#MarkName",
      "components/z/Near#Near",
      "components/z/Near#R.Wrapped",
      "components/z/Relay#Forwarded.Wrapped",
      "components/z/Uses#Uses",
      "components/z/UsesKit#K",
    ]);
  });
});
