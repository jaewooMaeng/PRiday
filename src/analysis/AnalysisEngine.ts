import { ASTParser } from "./ASTParser";
import { MappingBuilder } from "./MappingBuilder";
import type { PRDiffResult } from "../types/github";
import type { LLMResponse } from "../types/llm";
import type { MappingEntry } from "../types/summary";

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

export interface AnalysisResult {
  callGraph: LLMResponse["callGraph"];
  summaryBlocks: LLMResponse["summaryBlocks"];
  mappingTable: MappingEntry[];
  prSummary: string;
  files: PRFileInfo[];
  prMeta: PRMetadata;
}

export class AnalysisEngine {
  private readonly astParser = new ASTParser();
  private readonly mappingBuilder = new MappingBuilder();

  public build(llmResponse: LLMResponse, diff: PRDiffResult, prNumber?: number): AnalysisResult {
    const fileContentMap = new Map<string, string>();
    const astNodesByFile = new Map<string, ReturnType<ASTParser["parse"]>>();

    for (const file of diff.files) {
      fileContentMap.set(file.filename, file.rawContent);
      astNodesByFile.set(
        file.filename,
        this.astParser.parse({ filename: file.filename, content: file.rawContent })
      );
    }

    const mappingTable = this.mappingBuilder.build({
      blocks: llmResponse.summaryBlocks,
      fileContentMap,
      astNodesByFile,
    });

    const files: PRFileInfo[] = diff.files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      rawContent: f.rawContent,
      patch: f.patch,
    }));

    const prMeta: PRMetadata = {
      title: diff.prTitle,
      body: diff.prBody,
      baseBranch: diff.baseBranch,
      headBranch: diff.headBranch,
      prNumber,
    };

    return {
      callGraph: llmResponse.callGraph,
      summaryBlocks: llmResponse.summaryBlocks,
      mappingTable,
      prSummary: llmResponse.prSummary,
      files,
      prMeta,
    };
  }
}
