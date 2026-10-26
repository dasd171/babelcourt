// Mirror of the contract's deterministic pre-filter (contracts/babel_court.py: prefilter).
// The contract is the source of truth; this only gives translators instant feedback.

const INJECTION_MARKERS = [
  "ignore previous instructions", "ignore all previous", "ignore the above", "disregard previous",
  "system prompt", "you are now", "as the judge", "score this translation", "mark this as pass",
  "忽略以上", "忽略之前",
];

const norm = (s: string) => s.split(/\s+/).filter(Boolean).join(" ").trim().toLowerCase();
const count = (s: string, sub: string) => s.split(sub).length - 1;

export function prefilter(source: string, translation: string, glossary: Record<string, string>): string {
  const t = translation.trim();
  if (!t) return "untranslated";
  if (norm(t) === norm(source)) return "untranslated";
  const low = t.toLowerCase();
  for (const m of INJECTION_MARKERS) if (low.includes(m) && !source.toLowerCase().includes(m)) return "injection";
  if (count(source, "```") !== count(t, "```")) return "formatting";
  const src = source.toLowerCase();
  for (const [term, req] of Object.entries(glossary))
    if (src.includes(term.toLowerCase()) && !low.includes(req.toLowerCase())) return "glossary";
  return "";
}

export const REASON_LABEL: Record<string, string> = {
  ok: "Faithful and fluent",
  meaning_error: "A statement's meaning was changed, negated or garbled",
  omission: "Source content is missing",
  addition: "Content not in the source was added",
  glossary: "A required glossary rendering is missing",
  fluency: "Unnatural or ungrammatical target language",
  formatting: "Code blocks, links or lists were broken",
  wrong_language: "Not written in the target language",
  untranslated: "Empty or left in the source language",
  injection: "Tried to manipulate the judge",
};
