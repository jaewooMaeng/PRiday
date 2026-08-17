export interface LineRange {
  start: number;
  end: number;
}

export interface CallGraphNode {
  id: string;
  name: string;
  type: string;
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

export interface CodeReference {
  sentenceIndex: number;
  targetName: string;
  lineStart: number;
  lineEnd: number;
}

export interface SummaryBlock {
  id: string;
  blockType: string;
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

export interface PRFileInfo {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  rawContent: string;
  patch: string;
}

export interface PRMetadata {
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  prNumber?: number;
}

export interface AnalysisResultPayload {
  callGraph: { root?: CallGraphNode; files?: CallGraphFile[] };
  summaryBlocks: SummaryBlock[];
  mappingTable: MappingEntry[];
  prSummary: string;
  files: PRFileInfo[];
  prMeta: PRMetadata;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  modelLabel?: string;
}

export type UILanguage = "en" | "ko";

export type LLMProvider = "ollama" | "gemini" | "claude" | "chatgpt";

export interface LLMConfigPayload {
  provider: LLMProvider;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  geminiModel?: string;
  claudeModel?: string;
  chatgptModel?: string;
  language?: UILanguage;
  additionalSystemPrompt?: string;
  hasGeminiApiKey?: boolean;
  hasClaudeApiKey?: boolean;
  hasOpenAIApiKey?: boolean;
  hasGitHubToken?: boolean;
}
