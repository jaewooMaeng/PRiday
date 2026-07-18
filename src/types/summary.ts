import type { LineRange } from "./callGraph";

export type SummaryBlockType =
  | "import"
  | "function_def"
  | "class_def"
  | "logic"
  | "config"
  | "test"
  | "main_flow"
  | "utility";

export interface CodeReference {
  sentenceIndex: number;
  targetName: string;
  lineStart: number;
  lineEnd: number;
}

export interface SummaryBlock {
  id: string;
  blockType: SummaryBlockType;
  title: string;
  codeSnippet: string;
  lineRange: LineRange;
  filename: string;
  explanation: string;
  keyChanges: string[];
  depth?: number;
  parentId?: string;
  codeReferences?: CodeReference[];
}

export interface MappingEntry {
  summaryBlockId: string;
  sentenceIndex: number;
  sentenceText: string;
  filename: string;
  codeLineStart: number;
  codeLineEnd: number;
  confidence: number;
}
