/** Common analyst filler / meta phrases to discourage (guardrail hint). */
export const BRIEF_PERSONALISE_FILLER_PATTERN =
  /\b(it is worth noting|it is important to|needless to say|moving forward|at the end of the day|leverage synergies|robust framework)\b/i;

/**
 * First/second person slips (positions copy must stay third-person observational).
 * Omits `\bus\b` to avoid false positives on "US" (e.g. US Henry Hub).
 */
export function containsDisallowedVoice(text: string): boolean {
  return /\b(I|me|my|mine|we|our|ours|you|your|yours)\b/i.test(text);
}

/** Match if full label appears, or enough distinctive tokens (models paraphrase names). */
export function positionReferencedInText(text: string, label: string): boolean {
  const lower = text.toLowerCase();
  const l = label.trim().toLowerCase();
  if (!l) return false;
  if (lower.includes(l)) return true;
  const words = l.split(/\s+/).filter((w) => w.length > 2);
  if (words.length <= 1) {
    return words.length === 1 && lower.includes(words[0]!);
  }
  const hits = words.filter((w) => lower.includes(w));
  return hits.length >= Math.min(words.length, Math.ceil(words.length * 0.6));
}

export function validatePersonalisedParagraph(
  text: string,
  requiredLabels: string[],
): boolean {
  if (!text || /^invalid\.?$/i.test(text.trim())) return false;
  if (containsDisallowedVoice(text)) return false;
  if (BRIEF_PERSONALISE_FILLER_PATTERN.test(text)) return false;
  return requiredLabels.every((label) =>
    positionReferencedInText(text, label),
  );
}
