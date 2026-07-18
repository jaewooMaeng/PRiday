export type CallGraphNodeType = "function" | "class" | "method" | "module";

export interface LineRange {
  start: number;
  end: number;
}

export interface CallGraphNode {
  id: string;
  name: string;
  type: CallGraphNodeType;
  signature: string;
  summary: string;
  bulletPoints: string[];
  lineRange: LineRange;
  filename: string;
  children: CallGraphNode[];
}

export interface CallGraphFile {
  id: string;
  filename: string;
  title?: string;
  root: CallGraphNode;
  relatedFiles?: string[];
}

export interface CallGraphData {
  root?: CallGraphNode;
  files?: CallGraphFile[];
}
