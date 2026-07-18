import { getLogger } from "./logger";

export function startTimer(label: string): () => void {
  const start = Date.now();
  return () => {
    const elapsed = Date.now() - start;
    getLogger().appendLine(`[Perf] ${label}: ${elapsed}ms`);
  };
}
