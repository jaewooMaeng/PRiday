const STOPWORDS = new Set([
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "a",
  "is",
  "for",
  "on",
  "this",
  "that",
  "을",
  "를",
  "이",
  "가",
  "은",
  "는",
]);

export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function termFreq(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const token of tokens) {
    map.set(token, (map.get(token) ?? 0) + 1);
  }
  return map;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (const key of keys) {
    const av = a.get(key) ?? 0;
    const bv = b.get(key) ?? 0;
    dot += av * bv;
    aNorm += av * av;
    bNorm += bv * bv;
  }
  if (aNorm === 0 || bNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export function bestLineMatch(sentence: string, codeLines: string[]): { index: number; score: number } {
  const sentenceTokens = tokenize(sentence);
  const query = termFreq(sentenceTokens);
  let best = { index: 0, score: 0 };

  codeLines.forEach((line, index) => {
    const lineTokens = tokenize(line);
    let score = cosine(query, termFreq(lineTokens));
    if (sentenceTokens.some((token) => lineTokens.includes(token))) {
      score = Math.min(1, score + 0.15);
    }
    if (score > best.score) {
      best = { index, score };
    }
  });
  return best;
}
