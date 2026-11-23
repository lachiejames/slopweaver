"use client";

import type { MotionProps } from "motion/react";
import { motion } from "motion/react";
import type { CSSProperties, JSX } from "react";
import { createElement, memo, useMemo } from "react";
import { cn } from "@/lib/utils";

type MotionHTMLProps = MotionProps & Record<string, unknown>;

// Cache motion components at module level to avoid creating during render
const motionComponentCache = new Map<keyof JSX.IntrinsicElements, React.ComponentType<MotionHTMLProps>>();

const getMotionComponent = (element: keyof JSX.IntrinsicElements) => {
  let component = motionComponentCache.get(element);
  if (!component) {
    component = motion.create(element);
    motionComponentCache.set(element, component);
  }
  return component;
};

export interface TextShimmerProps {
  children: string;
  as?: keyof JSX.IntrinsicElements;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({ children, as: Component = "p", className, duration = 2, spread = 2 }: TextShimmerProps) => {
  const MotionComponent = getMotionComponent(Component);

  const dynamicSpread = useMemo(() => children.length * spread, [children, spread]);
  const style: CSSProperties & { "--spread": string } = {
    "--spread": `${dynamicSpread}px`,
    backgroundImage: "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
  };

  // Rendered via createElement rather than JSX: MotionComponent is resolved
  // from a stable module-level cache (see getMotionComponent above), so its
  // identity does not change across renders for a given `as` element type —
  // but a JSX tag bound to a locally-scoped variable still reads as an
  // unstable component to static analysis.
  return createElement(
    MotionComponent,
    {
      animate: { backgroundPosition: "0% center" },
      className: cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        // The highlight sweeps ink over the muted base, never the ground's colour: every glyph stays between two inks
        // that read on every plane (foregroundHarness.ts, the `shimmer` measure), where a ground-coloured one fell to 1:1.
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-foreground),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className,
      ),
      initial: { backgroundPosition: "100% center" },
      style,
      transition: {
        duration,
        ease: "linear",
        repeat: Number.POSITIVE_INFINITY,
      },
    },
    children,
  );
};

export const Shimmer = memo(ShimmerComponent);
