/*
 * The pure half of a person's initials tile: which letters it shows and which hue it draws in. The console's
 * `Avatar` (`components/console/Avatar.tsx`) renders them over the shadcn avatar primitive.
 */

/**
 * The letters an initials tile shows: the first letter of the first two words, or the first two letters.
 *
 * @param name split on whitespace, dots, underscores and hyphens
 * @returns one or two upper-case characters, or `?` for a name with no letters in it
 */
export function avatarInitials({ name }: { name: string }): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter((word) => word.length > 0);
  const first = words.at(0);
  if (first === undefined) {
    return "?";
  }
  const second = words.at(1);
  if (second !== undefined) {
    return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
  }
  return first.slice(0, 2).toUpperCase();
}

/**
 * A hue for a name, stable across renders and visits, so the same person always gets the same initials tile.
 *
 * @returns a degree on the oklch hue wheel, 0 to 359
 */
export function avatarHue({ name }: { name: string }): number {
  let hash = 0;
  for (const char of name) {
    const point = char.codePointAt(0);
    if (point !== undefined) {
      hash = (hash * 31 + point) % 360;
    }
  }
  return hash;
}
