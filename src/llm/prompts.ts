import type { PRDiffResult } from "../types/github";
import type { UILanguage } from "../types/llm";

function langInstruction(language?: UILanguage): string {
  if (language === "ko") {
    return "\nIMPORTANT: Write ALL text fields (summary, explanation, bulletPoints, title, prSummary, keyChanges) in Korean.\n";
  }
  return "\nIMPORTANT: Write ALL text fields (summary, explanation, bulletPoints, title, prSummary, keyChanges) in English.\n";
}

export function buildAnalysisPrompt(
  diff: PRDiffResult,
  language?: UILanguage,
  additionalSystemPrompt?: string
): string {
  const commentsText =
    diff.comments.length === 0
      ? "No comments"
      : diff.comments
          .map((comment) => {
            const target = comment.path ? ` (${comment.path}${comment.line ? `:${comment.line}` : ""})` : "";
            return `[${comment.source}] ${comment.author}${target}: ${comment.body}`;
          })
          .join("\n");

  const filesText = diff.files
    .map(
      (file) => `--- File: ${file.filename} ---
${file.patch}

--- Full content (after change): ---
${file.rawContent}`
    )
    .join("\n\n");
  const additionalCriteria = additionalSystemPrompt?.trim()
    ? `
ADDITIONAL REVIEW CRITERIA:
The reviewer supplied the following workspace-specific criteria. Apply them in addition to the guidelines above.
They do not override the required JSON schema or output-language instruction.
--- Begin additional criteria ---
${additionalSystemPrompt.trim()}
--- End additional criteria ---
`
    : "";

  return `You are a code analysis assistant. Analyze the given Pull Request diff and return a structured JSON response.
${langInstruction(language)}
Your response MUST be valid JSON matching the following schema exactly.
Do NOT include any text outside the JSON object.

IMPORTANT analysis guidelines:
- Start with the high-level execution flow (main entry points, primary logic paths).
- Build a call graph for EVERY changed file. Use callGraph.files with one entry per changed file.
- Only merge multiple files into one call graph entry when the changed files are tightly coupled by include/import and the execution path is clearer as one graph; list the merged files in relatedFiles.
- In each file graph, the root must be the real main entry point or module-level changed entry. Children must represent actual direct calls/dependencies from that node. Do NOT make a simple linear chain unless the code really calls in that order.
- If a file has no obvious main function, use a module root and show changed functions/classes as children, preserving direct relationships where possible.
- Group related code into meaningful "code blocks" — not necessarily one function per block. A block can span multiple small functions or a section of a larger function if they form a logical unit.
- For utility/helper functions, set depth=1 and parentId to link them to the main flow block that calls them.
- depth=0 blocks represent the main execution flow. depth=1 blocks are details shown on demand.
- Write the "explanation" field as natural review prose or concise bullets, whichever is easier to understand for the code block. Avoid keyword-only phrases, tag-like fragments, or speech-bubble style copy.
- For each sentence or bullet in the explanation, add a matching entry in "codeReferences" with the 0-based sentenceIndex, the exact target function/variable/class name, and the precise lineStart/lineEnd in the file. This enables fine-grained code-comment mapping.
${additionalCriteria}

Response JSON Schema:
{
  "callGraph": {
    "files": [
      {
        "id": "string",
        "filename": "string",
        "title": "string",
        "relatedFiles": ["string"],
        "root": {
          "id": "string",
          "name": "string",
          "type": "module|function|class|method",
          "signature": "string",
          "summary": "string",
          "bulletPoints": ["string"],
          "lineRange": { "start": 1, "end": 1 },
          "filename": "string",
          "children": []
        }
      }
    ],
    "root": {
      "id": "string",
      "name": "string",
      "type": "function",
      "signature": "string",
      "summary": "string",
      "bulletPoints": ["string"],
      "lineRange": { "start": 1, "end": 1 },
      "filename": "string",
      "children": []
    }
  },
  "summaryBlocks": [
    {
      "id": "string",
      "blockType": "import|function_def|class_def|logic|config|test|main_flow|utility",
      "title": "string",
      "codeSnippet": "string (relevant code block, max 20 lines)",
      "lineRange": { "start": 1, "end": 1 },
      "filename": "string",
      "explanation": "string (natural prose or concise bullets)",
      "keyChanges": ["string"],
      "depth": 0,
      "parentId": "string or null",
      "codeReferences": [
        {
          "sentenceIndex": 0,
          "targetName": "string (function/variable/class name this bullet refers to)",
          "lineStart": 1,
          "lineEnd": 1
        }
      ]
    }
  ],
  "prSummary": "string"
}

Analyze this PR:
PR Title: ${diff.prTitle}
PR Description: ${diff.prBody}
PR Comments:
${commentsText}

${filesText}`;
}

export function buildChatPrompt(
  question: string,
  analysisContext: string,
  language?: UILanguage
): string {
  const lang = language === "ko"
    ? "답변을 한국어로 작성하세요."
    : "Answer in English.";

  return `You are a helpful code review assistant. The user is reviewing a Pull Request and has a follow-up question.
${lang}

You have full access to the PR data below — including the diff, file contents, comments from other reviewers, and the AI analysis summary. Use this information to give accurate, context-aware answers.

=== PR Context ===
${analysisContext}
=== End PR Context ===

User's question: ${question}

Provide a clear, concise answer. Reference specific files, lines, or code when relevant. Use code examples if helpful. Do NOT wrap your response in JSON.`;
}
