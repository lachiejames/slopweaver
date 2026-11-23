/*
 * The console's two small controls, as utility strings: a chip, for a count or a state beside a heading, and a
 * button. On a <button> the font is the console's own `button` rule's, inherited, and so is the colour of every
 * button but the primary one, which states its dark ink so a teal ground never carries pale text; an anchor drawn
 * as a button names its own font.
 */

/** A pill: muted by default, its `data-tone` lighting it teal (`hot`) or amber (`warn`), a `<b>` inside at full ink. */
export const CHIP =
  "inline-flex items-center gap-[0.3rem] rounded-[999px] border border-solid border-border bg-(--c-panel) px-[0.55rem] py-[0.12rem] text-[0.72rem] leading-[1.5] whitespace-nowrap text-muted-foreground data-[tone=hot]:border-primary/40 data-[tone=hot]:bg-primary/16 data-[tone=hot]:text-foreground data-[tone=warn]:border-warning/40 data-[tone=warn]:bg-warning/14 data-[tone=warn]:text-warning [&_b]:text-foreground [&_b]:tabular-nums";

/**
 * Every button's frame, ringed under the pointer and faded while disabled; its ground is the variant's. The hover
 * moves the border only, never a filter over the label, whose ink is measured on the variant's ground.
 */
const BUTTON_FRAME =
  "cursor-pointer rounded-[8px] border border-solid px-[0.9rem] py-[0.45rem] hover:not-disabled:border-ring disabled:cursor-not-allowed disabled:opacity-55";

/** A button on the panel ground. */
export const BUTTON = `${BUTTON_FRAME} border-border bg-(--c-panel)`;

/** The one button a panel leads with: dark ink on teal, borderless. */
export const BUTTON_PRIMARY = `${BUTTON_FRAME} border-transparent bg-primary text-primary-foreground`;
