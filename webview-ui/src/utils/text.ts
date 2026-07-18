export function splitBulletPoints(text: string): string[] {
  const rawLines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const bullets: string[] = [];
  let sawMarker = false;

  for (const line of rawLines) {
    const markerMatch = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (markerMatch) {
      sawMarker = true;
      bullets.push(markerMatch[1].trim());
      continue;
    }

    if (sawMarker && bullets.length > 0) {
      bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${line}`.trim();
      continue;
    }

    bullets.push(line);
  }

  if (sawMarker) {
    return bullets.map((item) => item.trim()).filter(Boolean);
  }

  return text
    .split(/(?<=[.!?。])\s+/)
    .map((value) => value.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}
