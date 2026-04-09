export const POST_CARD_VARIANTS = ["default", "editorial", "codelist"] as const;

export type PostCardVariant = (typeof POST_CARD_VARIANTS)[number];

export function normalizePostCardVariant(value: string): PostCardVariant {
  return POST_CARD_VARIANTS.includes(value as PostCardVariant) ? (value as PostCardVariant) : "default";
}
