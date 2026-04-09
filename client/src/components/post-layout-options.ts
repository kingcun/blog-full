export const _POST_LAYOUT_OPTIONS = ["list", "masonry"] as const;

export type PostLayout = (typeof _POST_LAYOUT_OPTIONS)[number];

export function normalizePostLayout(value: string): PostLayout {
  return _POST_LAYOUT_OPTIONS.includes(value as PostLayout) ? (value as PostLayout) : "list";
}
