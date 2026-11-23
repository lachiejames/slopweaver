"use client";

import type { CSSProperties, ReactElement } from "react";

import { avatarHue, avatarInitials } from "../../lib/avatarLabel";
import { cn } from "../../lib/utils";
import { AvatarFallback, AvatarImage, Avatar as AvatarRoot } from "../ui/avatar";

/** The tile's edge and its initials' type size, per size. */
const SIZE = { md: "size-8 text-[0.72rem]", sm: "size-5 text-[0.55rem]" } as const;

/**
 * A person's picture, or their initials when the roster has none or the image will not load.
 *
 * The frame and the fallback are the shadcn avatar primitive (`components/ui/avatar.tsx`), which shows the
 * initials until the picture has loaded and keeps them when it never does. The picture is fetched by the owner's
 * browser from the platform's own image host (GitHub's avatars host, Slack's edge); no token travels with it,
 * no referrer is sent, and nothing is proxied. `docs/console/pull-requests.md` says so for GitHub's
 * host; for Slack's the console doc names only the source (`docs/console/queue-and-triage.md`), so the
 * `referrerPolicy` below is the whole of the evidence there.
 *
 * @param url the picture, when the roster has one
 * @param name what the initials and the title are made from
 * @param size the tile's edge
 * @param muted whether the initials are drawn in the muted tokens with no hue, as for a member who has left
 * @returns the avatar
 */
export function Avatar({
  url,
  name,
  size = "sm",
  muted = false,
}: {
  url: string | undefined;
  name: string;
  size?: "sm" | "md";
  muted?: boolean;
}): ReactElement {
  let hue: CSSProperties | undefined = { background: `oklch(0.5 0.13 ${String(avatarHue({ name }))})` };
  if (muted) {
    hue = undefined;
  }
  return (
    <AvatarRoot className={cn("bg-muted", SIZE[size])} title={name}>
      {url === undefined ? null : (
        <AvatarImage className="object-cover" src={url} alt={name} loading="lazy" referrerPolicy="no-referrer" />
      )}
      <AvatarFallback
        className={cn("font-bold tracking-[0.02em]", muted ? "bg-muted text-muted-foreground" : "text-white")}
        style={hue}
        aria-label={name}
      >
        {avatarInitials({ name })}
      </AvatarFallback>
    </AvatarRoot>
  );
}
