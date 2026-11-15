import { createHash } from "node:crypto";

/**
 * Title normalisation used for idea de-duplication (exact fingerprint + trigram similarity in SQL).
 * Arabic: removes tashkeel and tatweel, unifies alef/hamza forms, alef maqsura and taa marbuta,
 * so "أفضل طريقة" and "افضل طريقه" compare as equal.
 */
const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .replace(TASHKEEL, "")
    .replace(TATWEEL, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Order-insensitive fingerprint of the normalised words. */
export function titleFingerprint(title: string): string {
  const words = [...new Set(normalizeTitle(title).split(" ").filter(Boolean))].sort();
  return createHash("sha256").update(words.join(" ")).digest("hex").slice(0, 32);
}

/** Stable fingerprint of an agenda (for the no-progress detector). */
export function agendaFingerprint(items: { key: string }[]): string {
  return createHash("sha256")
    .update(items.map((i) => i.key).sort().join("|"))
    .digest("hex")
    .slice(0, 32);
}
