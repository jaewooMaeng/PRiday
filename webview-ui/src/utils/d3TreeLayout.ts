import type { CallGraphNode } from "../types/messages";

export interface TreeLayoutNode {
  id: string;
  depth: number;
}

// MVP에서는 React 재귀 렌더링을 사용하고, 향후 D3 좌표 계산을 이 유틸로 확장한다.
export function collectDepth(node: CallGraphNode, depth = 0, out: TreeLayoutNode[] = []): TreeLayoutNode[] {
  out.push({ id: node.id, depth });
  node.children.forEach((child) => collectDepth(child, depth + 1, out));
  return out;
}
