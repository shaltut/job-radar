/** Normalize a string for comparison: lowercase, strip punctuation, collapse whitespace. */
export function norm(s) {
  if (s == null) return '';
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '') // drop punctuation, keep letters/numbers/space
    .replace(/\s+/g, ' ')
    .trim();
}
