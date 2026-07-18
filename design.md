# AI PR Insight — VS Code Plugin 구현 명세서

> **Version**: 1.0.0-MVP  
> **Last Updated**: 2026-03-31  
> **Target**: 코딩 에이전트용 구현 가이드  

---

## 1. 프로젝트 개요

### 1.1 목적

GitHub Pull Request 리뷰 시, LLM을 활용하여 코드의 전체 논리 흐름과 세부 구현을 **시각적·상호작용적**으로 분석해주는 VS Code 플러그인.
리뷰어가 PR의 모든 코드를 라인 바이 라인으로 읽지 않아도, Call Graph 시각화와 Summary↔Code 양방향 매핑을 통해 변경사항의 맥락과 의도를 빠르게 파악할 수 있도록 한다.

### 1.2 핵심 가치

- **시각적 이해**: 함수 호출 관계를 트리 형태로 시각화하여 PR의 구조를 한눈에 파악
- **양방향 매핑**: 요약 텍스트 ↔ 실제 코드 간 드래그 기반 상호 탐색
- **LLM 유연성**: 로컬(Ollama) 또는 클라우드(Gemini, Claude) LLM을 자유롭게 전환

### 1.3 MVP 범위 (1차 릴리스)

| 포함 | 제외 (2차 이후) |
|------|----------------|
| Call Graph 시각화 + Expand/Collapse | AI Auto-Comment (코드 라인 자동 주석) |
| Summary↔Code 양방향 드래그 매핑 | GitHub PR Comment 직접 작성 연동 |
| LLM 토글 (Ollama / Gemini / Claude) | 멀티 파일 동시 분석 |
| GitHub REST API를 통한 PR diff 조회 | 실시간 코드 수정 반영 |

---

## 2. 기술 스택

| 영역 | 선택 | 근거 |
|------|------|------|
| VS Code Extension | TypeScript | VS Code 공식 권장 |
| Webview UI | **React** + @vscode/webview-ui-toolkit | VS Code 디자인 시스템 일관성, 컴포넌트 재사용성 |
| Webview 번들링 | esbuild 또는 webpack | Webview용 React 코드를 단일 bundle.js로 빌드 |
| Call Graph 렌더링 | **D3.js** (커스텀 트리 렌더링) | Mermaid보다 인터랙션(클릭 확장/축소, 애니메이션) 제어에 유리 |
| AST 파싱 | **tree-sitter** (WASM) | 다중 언어 지원, VS Code 내장 tree-sitter와 호환 |
| 텍스트 유사도 | TF-IDF + 코사인 유사도 (자체 구현, 경량) | 외부 의존성 최소화 |
| GitHub API | **Octokit** (@octokit/rest) | GitHub 공식 SDK, PAT 인증 |
| LLM 통신 | fetch API (Ollama REST) / 각 클라우드 SDK | — |
| 테스트 | Jest + @vscode/test-electron | — |

---

## 3. 아키텍처

### 3.1 전체 구조도

```
┌──────────────────────────────────────────────────────────────┐
│                     VS Code Extension Host                   │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐ │
│  │ Extension.ts │  │ EditorCtrl  │  │    GitHubClient      │ │
│  │ (진입점)     │──│ (하이라이트)│  │ (PR diff 조회)       │ │
│  └──────┬──────┘  └──────▲──────┘  └──────────┬───────────┘ │
│         │                │                     │             │
│         │         postMessage                  │             │
│         │          (양방향)                     │             │
│  ┌──────▼──────────────────┐  ┌────────────────▼───────────┐ │
│  │   WebviewProvider       │  │       LLMClient            │ │
│  │   (React 앱 호스팅)     │  │  (Ollama/Gemini/Claude)    │ │
│  └──────┬──────────────────┘  └────────────────┬───────────┘ │
│         │                                      │             │
│  ┌──────▼──────────────────┐  ┌────────────────▼───────────┐ │
│  │   Webview (React App)   │  │     AnalysisEngine         │ │
│  │  - CallGraphView        │  │  - AST Parser (tree-sitter)│ │
│  │  - StepByStepView       │  │  - TextSimilarityMapper    │ │
│  │  - LLMSettingsPanel     │  │  - LLM Response Parser     │ │
│  │  - SummaryPanel         │  │  - MappingTable Builder    │ │
│  └─────────────────────────┘  └────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 데이터 흐름

```
[사용자: PR 분석 명령 실행]
        │
        ▼
Extension.ts ──▶ GitHubClient.fetchPRDiff(owner, repo, pr_number)
        │                    │
        │                    ▼
        │            GitHub REST API (PAT 인증)
        │                    │
        │                    ▼
        │            PR diff 데이터 (unified diff)
        │                    │
        ▼                    ▼
   LLMClient.analyze(diff) ◀─┘
        │
        ▼
   LLM 응답 (구조화된 JSON)
        │
        ▼
   AnalysisEngine
   ├── LLM 응답 파싱 → CallGraphData, SummaryBlocks
   ├── AST 파싱 (tree-sitter) → 함수/클래스 범위 추출
   └── TextSimilarityMapper → Summary문장 ↔ 코드라인 매핑테이블
        │
        ▼
   WebviewProvider.postMessage({
     callGraph: CallGraphData,
     summaryBlocks: SummaryBlock[],
     mappingTable: MappingEntry[]
   })
        │
        ▼
   [Webview React App 렌더링]
```

---

## 4. 모듈 상세 설계

### 4.1 Extension.ts (진입점)

**책임**: 플러그인 라이프사이클 관리, 명령어 등록, 모듈 간 오케스트레이션

```typescript
// 등록할 명령어
"ai-pr-insight.analyzePR"      // PR 번호 입력 → 분석 시작
"ai-pr-insight.openSettings"   // LLM 설정 패널 열기

// 활성화 이벤트
"activationEvents": ["onCommand:ai-pr-insight.analyzePR"]
```

**동작 순서**:
1. 명령어 실행 시 Quick Pick으로 `owner/repo` 와 PR 번호 입력받음
2. GitHubClient로 diff 조회
3. LLMClient로 분석 요청
4. AnalysisEngine으로 매핑 테이블 생성
5. WebviewProvider에 결과 전달
6. Webview Panel을 **에디터 옆(ViewColumn.Beside)**에 생성

### 4.2 GitHubClient 모듈

**책임**: GitHub REST API를 통한 PR 데이터 조회

```typescript
interface GitHubClientConfig {
  token: string;           // Personal Access Token (VS Code SecretStorage에 저장)
}

interface PRDiffResult {
  prTitle: string;
  prBody: string;
  baseBranch: string;
  headBranch: string;
  files: PRFile[];
}

interface PRFile {
  filename: string;        // 예: "src/main.py"
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
  patch: string;           // unified diff 텍스트
  rawContent: string;      // 변경 후 파일 전체 내용 (AST 파싱용)
}
```

**API 엔드포인트**:
- `GET /repos/{owner}/{repo}/pulls/{pull_number}` → PR 메타데이터
- `GET /repos/{owner}/{repo}/pulls/{pull_number}/files` → 파일별 diff
- `GET /repos/{owner}/{repo}/contents/{path}?ref={sha}` → 파일 전체 내용 (AST용)

**구현 주의사항**:
- PAT는 `vscode.SecretStorage`에 암호화 저장 (settings.json에 절대 평문 저장 금지)
- 초기 설정 시 PAT 입력을 위한 Input Box 제공
- Rate limit 대응: 응답 헤더 `X-RateLimit-Remaining` 확인, 소진 시 사용자에게 알림
- diff가 큰 경우(3000줄 이상) 파일별로 분할하여 LLM에 전송

### 4.3 LLMClient 모듈

**책임**: 설정에 따라 Ollama(로컬) 또는 Cloud API로 프롬프트 전송 및 응답 파싱

#### 4.3.1 지원 LLM 구성

```typescript
type LLMProvider = "ollama" | "gemini" | "claude";

interface LLMConfig {
  provider: LLMProvider;
  // Ollama
  ollamaEndpoint?: string;    // 기본값: "http://localhost:11434"
  ollamaModel?: string;       // 예: "llama3", "codellama"
  // Gemini
  geminiApiKey?: string;
  geminiModel?: string;       // 예: "gemini-1.5-pro"
  // Claude
  claudeApiKey?: string;
  claudeModel?: string;       // 예: "claude-sonnet-4-20250514"
}
```

#### 4.3.2 Ollama 통신

```
POST http://localhost:11434/api/generate
Content-Type: application/json

{
  "model": "llama3",
  "prompt": "<구조화된 프롬프트>",
  "stream": false,
  "format": "json"
}
```

- `stream: false`로 전체 응답을 한 번에 수신 (MVP 단계)
- 2차에서 `stream: true`로 전환하여 Webview에 실시간 렌더링 가능
- 연결 실패 시 "Ollama가 실행 중인지 확인해주세요" 안내 메시지 표시

#### 4.3.3 Cloud API 통신

- **Gemini**: `@google/generative-ai` SDK 사용, `generateContent()` 호출
- **Claude**: `@anthropic-ai/sdk` 사용, `messages.create()` 호출
- API 키는 `vscode.SecretStorage`에 저장

#### 4.3.4 프롬프트 설계 (핵심)

LLM에 전달하는 프롬프트는 **반드시 JSON 형식의 응답**을 요구해야 한다.

```
시스템 프롬프트:
"""
You are a code analysis assistant. Analyze the given Pull Request diff and return a structured JSON response.

Your response MUST be valid JSON matching the following schema exactly.
Do NOT include any text outside the JSON object.

Response JSON Schema:
{
  "callGraph": {
    "root": {
      "id": "string (unique)",
      "name": "string (function/class name)",
      "type": "function" | "class" | "method" | "module",
      "signature": "string (full signature)",
      "summary": "string (1-2 sentence Korean description)",
      "bulletPoints": ["string (Korean, concise)"],
      "lineRange": { "start": number, "end": number },
      "filename": "string",
      "children": [ ...재귀적으로 동일 구조 ]
    }
  },
  "summaryBlocks": [
    {
      "id": "string (unique, e.g. block_001)",
      "blockType": "import" | "function_def" | "class_def" | "logic" | "config" | "test",
      "title": "string (Korean, e.g. 'Block 1: 모듈 임포트')",
      "codeSnippet": "string (해당 코드 원문, 최대 20줄)",
      "lineRange": { "start": number, "end": number },
      "filename": "string",
      "explanation": "string (Korean, 3-5 sentences)",
      "keyChanges": ["string (Korean, 변경 핵심 포인트)"]
    }
  ],
  "prSummary": "string (Korean, PR 전체 요약 2-3 문장)"
}
"""

유저 프롬프트:
"""
아래 Pull Request diff를 분석해주세요.

PR Title: {prTitle}
PR Description: {prBody}

--- 파일: {filename} ---
{patch}

--- 파일 전체 내용 (변경 후): ---
{rawContent}
"""
```

**프롬프트 주의사항**:
- 파일이 여러 개인 경우 `summaryBlocks`와 `callGraph`에 `filename` 필드로 구분
- 코드가 3000줄을 초과하면 파일별로 나누어 분석 후 결과를 병합
- LLM 응답이 유효한 JSON이 아닌 경우, 재시도 로직 (최대 2회)
- JSON 파싱 실패 시 사용자에게 "분석 결과를 파싱하지 못했습니다" 에러 표시

### 4.4 AnalysisEngine 모듈

**책임**: LLM 응답 파싱, AST 파싱, Summary↔Code 매핑 테이블 생성

이 모듈이 프로젝트의 **핵심 기술적 난이도**를 담당한다.

#### 4.4.1 AST 파싱 (tree-sitter)

```typescript
interface ASTNode {
  type: string;            // "function_definition", "class_definition", etc.
  name: string;            // 함수/클래스 이름
  lineRange: { start: number; end: number };
  children: ASTNode[];
}
```

**처리 흐름**:
1. `rawContent` (변경 후 파일 전체)를 tree-sitter로 파싱
2. 함수 정의, 클래스 정의, 메서드 정의 노드를 추출
3. 각 노드의 정확한 라인 범위(`startPosition.row`, `endPosition.row`)를 기록
4. LLM이 반환한 `callGraph.lineRange`와 AST의 라인 범위를 교차 검증하여 보정

**지원 언어 (MVP)**:
- Python (`tree-sitter-python`)
- JavaScript/TypeScript (`tree-sitter-javascript`, `tree-sitter-typescript`)
- 기타 언어는 LLM의 `lineRange`를 그대로 사용 (AST fallback 없음)

#### 4.4.2 Summary↔Code 매핑 테이블 생성

이것이 **양방향 드래그 매핑**의 핵심 데이터.

```typescript
interface MappingEntry {
  summaryBlockId: string;      // summaryBlocks[].id
  sentenceIndex: number;       // 블록 내 문장 인덱스 (0-based)
  sentenceText: string;        // 실제 문장 텍스트
  filename: string;
  codeLineStart: number;       // 매핑되는 코드 시작 라인
  codeLineEnd: number;         // 매핑되는 코드 끝 라인
  confidence: number;          // 매핑 신뢰도 (0.0 ~ 1.0)
}
```

**매핑 알고리즘 (AST + 텍스트 유사도)**:

```
1단계: LLM 응답의 lineRange를 기본 매핑으로 사용
   - summaryBlock.lineRange → 해당 블록의 모든 문장에 대한 기본 코드 범위

2단계: AST 기반 보정
   - summaryBlock.explanation 내에서 함수/변수 이름 추출 (정규식)
   - tree-sitter AST에서 해당 이름의 정의 위치를 검색
   - 매칭되면 lineRange를 AST의 정확한 범위로 보정

3단계: 문장 단위 세분화 (텍스트 유사도)
   - explanation을 마침표(.) 기준으로 문장 분리
   - 각 문장에서 식별자(함수명, 변수명, 키워드) 추출
   - 코드 라인들과 TF-IDF 코사인 유사도 계산
   - 유사도 기반으로 각 문장에 가장 관련 높은 코드 라인 범위 할당
   - confidence = 유사도 점수
```

**TF-IDF 구현 (경량, 자체 구현)**:

```typescript
// 외부 라이브러리 없이 구현
// 문서 = 코드의 각 라인 (또는 연속 3줄 묶음)
// 쿼리 = summary의 각 문장
// 토큰화: camelCase/snake_case 분리, 소문자 변환, 불용어 제거

function tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase 분리
    .replace(/_/g, ' ')                      // snake_case 분리
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}
```

**confidence 임계값**: 
- ≥ 0.3: 매핑 표시 (실선 연결)
- 0.1 ~ 0.3: 약한 매핑 (점선 연결, 옅은 하이라이트)
- < 0.1: 매핑하지 않음

### 4.5 WebviewProvider 모듈

**책임**: React 앱을 Webview Panel에 렌더링, Extension Host와 postMessage 양방향 통신

#### 4.5.1 Webview Panel 설정

```typescript
const panel = vscode.window.createWebviewPanel(
  'aiPrInsight',
  `AI PR Insight: PR #${prNumber}`,
  vscode.ViewColumn.Beside,    // 에디터 옆에 열기
  {
    enableScripts: true,
    retainContextWhenHidden: true,  // 탭 전환 시 상태 유지
    localResourceRoots: [
      vscode.Uri.joinPath(extensionUri, 'webview-dist')
    ]
  }
);
```

#### 4.5.2 React 앱 구조 (1단 레이아웃)

```
<App>
  ├── <LLMSettingsPanel />        // 상단: LLM 선택 드롭다운 + 연결 상태
  ├── <PRSummaryBanner />         // PR 제목, 브랜치, 전체 요약
  ├── <CallGraphView />           // 동적 호출 그래프 (D3.js)
  │     └── <GraphNode />         // 개별 노드 (클릭 → 확장/축소)
  │           ├── <NodeHeader />  // 함수명 + 타입 아이콘
  │           ├── <BulletSummary /> // 간결한 요약 bullet
  │           └── <DetailedLogic /> // 확장 시 표시되는 상세 로직
  ├── <Divider />
  └── <StepByStepAnalysis />      // 블록 단위 분석
        └── <AnalysisBlock />     // 각 블록 (드래그 가능 영역)
              ├── <BlockHeader /> // "Block 1: 모듈 임포트" 등
              ├── <CodeSnippet /> // 코드 원문 (syntax highlighted)
              └── <Explanation /> // 설명 텍스트 (드래그 시 매핑 트리거)
</App>
```

#### 4.5.3 postMessage 프로토콜

**Extension → Webview**:

```typescript
// 분석 결과 전달
{ type: "analysisResult", payload: {
    callGraph: CallGraphData,
    summaryBlocks: SummaryBlock[],
    mappingTable: MappingEntry[],
    prSummary: string
}}

// 분석 진행 상태
{ type: "analysisProgress", payload: {
    stage: "fetching_pr" | "calling_llm" | "parsing_ast" | "building_map",
    progress: number  // 0-100
}}

// 에러
{ type: "analysisError", payload: { message: string } }

// 코드→요약 방향 하이라이트 (에디터에서 코드 선택 시)
{ type: "highlightSummary", payload: {
    summaryBlockId: string,
    sentenceIndex: number
}}
```

**Webview → Extension**:

```typescript
// 요약→코드 방향 하이라이트 (요약 텍스트 드래그 시)
{ type: "highlightCode", payload: {
    filename: string,
    lineStart: number,
    lineEnd: number
}}

// 코드→요약 매핑 요청 (에디터에서 코드 선택 시)
{ type: "requestSummaryHighlight", payload: {
    filename: string,
    selectedLineStart: number,
    selectedLineEnd: number
}}

// LLM 설정 변경
{ type: "updateLLMConfig", payload: LLMConfig }

// Call Graph 노드 클릭 (확장/축소)
{ type: "nodeToggle", payload: { nodeId: string, expanded: boolean } }

// 재분석 요청
{ type: "reanalyze" }
```

### 4.6 EditorController 모듈

**책임**: Webview에서 전달받은 매핑 이벤트를 바탕으로 VS Code 에디터에 하이라이트 적용

#### 4.6.1 하이라이트 Decoration

```typescript
const highlightDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(59, 130, 246, 0.15)',    // 파란색 배경 (15% 투명)
  border: '1px solid rgba(59, 130, 246, 0.4)',
  borderRadius: '3px',
  isWholeLine: true,
  overviewRulerColor: 'rgba(59, 130, 246, 0.8)',
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

const weakHighlightDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(59, 130, 246, 0.06)',    // 약한 하이라이트
  border: '1px dashed rgba(59, 130, 246, 0.2)',
  isWholeLine: true,
});
```

#### 4.6.2 동작 흐름

```
[Webview에서 텍스트 드래그]
    │
    ▼
postMessage("highlightCode", { filename, lineStart, lineEnd })
    │
    ▼
EditorController 수신
    │
    ├── 해당 파일이 에디터에 열려있는지 확인
    │     └── 열려있지 않으면: vscode.workspace.openTextDocument(filename)
    │                         → vscode.window.showTextDocument(doc, ViewColumn.One)
    │
    ├── activeTextEditor.setDecorations(highlightDecoration, [range])
    │
    └── activeTextEditor.revealRange(range, TextEditorRevealType.InCenter)
        // 해당 라인이 화면 중앙에 오도록 스크롤
```

#### 4.6.3 코드→요약 방향 (역방향 매핑)

```typescript
// 에디터에서 텍스트 선택 이벤트 리스너
vscode.window.onDidChangeTextEditorSelection((event) => {
  const selection = event.selections[0];
  if (selection.isEmpty) return;

  const lineStart = selection.start.line + 1;  // 1-based
  const lineEnd = selection.end.line + 1;
  const filename = event.textEditor.document.fileName;

  // mappingTable에서 해당 라인 범위와 겹치는 매핑 검색
  const matches = mappingTable.filter(m =>
    m.filename === filename &&
    m.codeLineStart <= lineEnd &&
    m.codeLineEnd >= lineStart
  );

  if (matches.length > 0) {
    webviewPanel.webview.postMessage({
      type: "highlightSummary",
      payload: {
        summaryBlockId: matches[0].summaryBlockId,
        sentenceIndex: matches[0].sentenceIndex
      }
    });
  }
});
```

---

## 5. UI/UX 상세 설계

### 5.1 전체 레이아웃

```
┌─────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────┐ │
│  │  LLM Settings                           │ │
│  │  [Ollama ▼] [llama3 ▼]  ● Connected    │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │  PR #42: Refactor greeting logic        │ │
│  │  main ← feature/greet-refactor          │ │
│  │  "이 PR은 greet 함수를 추출하여..."     │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │         Call Graph                       │ │
│  │                                          │ │
│  │     ┌────────┐                           │ │
│  │     │ main() │                           │ │
│  │     └───┬────┘                           │ │
│  │    ┌────┴────────┐                       │ │
│  │  ┌─▼──────┐  ┌──▼──────────┐            │ │
│  │  │validate│  │ greet(name) │ ← 클릭 시  │ │
│  │  │_args() │  │  [expanded] │   확장됨    │ │
│  │  └────────┘  └──┬──────────┘            │ │
│  │            ┌────┴─────┐                  │ │
│  │         ┌──▼───┐  ┌──▼─────┐            │ │
│  │         │ form │  │ output │             │ │
│  │         │string│  │to cons.│             │ │
│  │         └──────┘  └────────┘            │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ── Step-by-Step Analysis ──────────────── │ │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │  Block 1: 모듈 임포트 (Lines 1-2)       │ │
│  │  ┌─────────────────────────────────┐    │ │
│  │  │ import sys, os                  │    │ │
│  │  └─────────────────────────────────┘    │ │
│  │  sys는 커맨드라인 인수 접근에, os는     │ │
│  │  에러 생성 명령에 사용됩니다.            │ │
│  │  ← 이 텍스트를 드래그하면 에디터에서    │ │
│  │     해당 코드가 하이라이트됨             │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │  Block 2: validate_args() (Lines 3-9)   │ │
│  │  ...                                     │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 5.2 디자인 토큰 (VS Code 테마 연동)

Webview CSS에서 VS Code의 CSS 변수를 사용하여 다크/라이트 테마에 자동 대응:

```css
:root {
  /* VS Code 테마 변수 활용 */
  --bg-primary: var(--vscode-editor-background);
  --bg-secondary: var(--vscode-sideBar-background);
  --text-primary: var(--vscode-editor-foreground);
  --text-secondary: var(--vscode-descriptionForeground);
  --border: var(--vscode-panel-border);
  --accent: var(--vscode-focusBorder);
  --highlight-bg: rgba(59, 130, 246, 0.15);
  --node-bg: var(--vscode-badge-background);
  --node-active-border: var(--vscode-focusBorder);
}
```

### 5.3 Call Graph 인터랙션

**노드 상태**:
- **기본 (Collapsed)**: 함수명 + 타입 아이콘 + bullet 요약
- **확장 (Expanded)**: 하위 노드가 트리 형태로 펼쳐짐, 노드 테두리가 accent 색상으로 glow, 아이콘이 `+` → `-`로 변경
- **호버**: 노드 배경색 밝아짐, 간단한 툴팁 (시그니처 표시)

**애니메이션**:
- 확장/축소 시 `300ms ease-in-out` 트랜지션
- 하위 노드는 위에서 아래로 fade-in

### 5.4 드래그 매핑 인터랙션

**요약 → 코드 (정방향)**:
1. 사용자가 StepByStepAnalysis 영역에서 텍스트를 마우스로 드래그(선택)
2. `mouseup` 이벤트에서 `window.getSelection()` 으로 선택 텍스트 캡처
3. 선택된 텍스트가 속한 `<Explanation>` 컴포넌트의 `data-block-id`와 문장 인덱스 추출
4. mappingTable에서 해당 `(blockId, sentenceIndex)` 에 대응하는 코드 라인 조회
5. postMessage → Extension Host → EditorController가 에디터에 하이라이트 적용
6. Webview 내에서도 선택된 텍스트 영역에 파란색 배경 적용

**코드 → 요약 (역방향)**:
1. 사용자가 에디터에서 코드 라인을 선택
2. `onDidChangeTextEditorSelection` 이벤트 발생
3. mappingTable에서 해당 라인에 매핑된 summary 검색
4. postMessage → Webview에서 해당 `<AnalysisBlock>`에 하이라이트 클래스 적용 + 해당 블록으로 자동 스크롤

---

## 6. 디렉토리 구조

```
ai-pr-insight/
├── package.json
├── tsconfig.json
├── tsconfig.webview.json          # Webview React용 별도 tsconfig
├── esbuild.js                     # 빌드 스크립트 (Extension + Webview)
│
├── src/                           # Extension Host 코드
│   ├── extension.ts               # 진입점 (activate/deactivate)
│   ├── commands/
│   │   └── analyzePR.ts           # PR 분석 명령 핸들러
│   ├── github/
│   │   └── GitHubClient.ts        # GitHub REST API 클라이언트
│   ├── llm/
│   │   ├── LLMClient.ts           # LLM 통신 추상 인터페이스
│   │   ├── OllamaProvider.ts      # Ollama REST API 구현
│   │   ├── GeminiProvider.ts      # Gemini API 구현
│   │   ├── ClaudeProvider.ts      # Claude API 구현
│   │   └── prompts.ts             # 프롬프트 템플릿 관리
│   ├── analysis/
│   │   ├── AnalysisEngine.ts      # 분석 오케스트레이터
│   │   ├── ASTParser.ts           # tree-sitter 기반 AST 파싱
│   │   ├── TextSimilarity.ts      # TF-IDF 코사인 유사도
│   │   ├── MappingBuilder.ts      # 매핑 테이블 생성
│   │   └── ResponseParser.ts      # LLM JSON 응답 파싱 + 검증
│   ├── editor/
│   │   └── EditorController.ts    # 에디터 하이라이트 및 선택 이벤트
│   ├── webview/
│   │   └── WebviewProvider.ts     # Webview Panel 생성 및 메시지 라우팅
│   └── types/
│       ├── callGraph.ts           # CallGraphData 타입 정의
│       ├── summary.ts             # SummaryBlock, MappingEntry 타입 정의
│       ├── llm.ts                 # LLMConfig, LLMResponse 타입 정의
│       └── github.ts              # PRDiffResult, PRFile 타입 정의
│
├── webview-ui/                    # React 앱 (별도 빌드)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── index.tsx
│   │   ├── components/
│   │   │   ├── LLMSettingsPanel.tsx
│   │   │   ├── PRSummaryBanner.tsx
│   │   │   ├── CallGraphView.tsx
│   │   │   ├── GraphNode.tsx
│   │   │   ├── StepByStepAnalysis.tsx
│   │   │   ├── AnalysisBlock.tsx
│   │   │   ├── CodeSnippet.tsx
│   │   │   └── ProgressOverlay.tsx
│   │   ├── hooks/
│   │   │   ├── useVSCodeAPI.ts    # postMessage 래퍼
│   │   │   └── useMapping.ts      # 매핑 상태 관리
│   │   ├── utils/
│   │   │   └── d3TreeLayout.ts    # D3 트리 레이아웃 헬퍼
│   │   └── styles/
│   │       ├── global.css         # VS Code CSS 변수 바인딩
│   │       ├── callGraph.css
│   │       └── analysis.css
│   └── tsconfig.json
│
├── test/
│   ├── suite/
│   │   ├── extension.test.ts
│   │   ├── GitHubClient.test.ts
│   │   ├── LLMClient.test.ts
│   │   ├── AnalysisEngine.test.ts
│   │   └── MappingBuilder.test.ts
│   └── fixtures/
│       ├── sample-diff.txt
│       └── sample-llm-response.json
│
└── resources/
    └── icon.png
```

---

## 7. 단계별 구현 순서

각 Step은 **독립적으로 테스트 가능한 단위**로 설계되었다. 코딩 에이전트에게는 반드시 이 순서대로 Step별 프롬프트를 분리하여 지시할 것.

### 검증 인프라 (모든 Step 공통)

아래 도구와 방법은 모든 Step에서 공통으로 사용한다. 코딩 에이전트에게 **Step 1 시작 시** 아래 인프라를 먼저 구축하도록 지시할 것.

#### A. Extension Development Host (수동 검증)

VS Code Extension은 일반 앱과 달리, **별도의 VS Code 창(Extension Development Host)**에서 실행하여 테스트한다.

```
[개발 순서]
1. 코드 수정
2. 터미널에서 `npm run compile` (또는 watch 모드: `npm run watch`)
3. F5 누르기 → "Extension Development Host" 창이 열림
4. Dev Host 창에서 Ctrl+Shift+P → 명령어 실행 → 동작 확인
5. 문제 발견 시 원래 창으로 돌아가서 코드 수정 → 반복
```

- `F5`를 누를 때마다 새 Dev Host 창이 열리므로, 이전 창은 닫을 것
- Dev Host 창의 메뉴 `Help > Toggle Developer Tools` 로 Webview의 DevTools (Console, Elements) 접근 가능
- Extension Host 자체의 로그는 원래 VS Code 창의 "Output" 패널 → 드롭다운에서 "Extension Host" 선택

#### B. Output Channel 로깅 (디버그 로그)

각 모듈에 `OutputChannel` 로깅을 의무적으로 포함시킨다. 이것이 가장 핵심적인 중간 검증 도구이다.

```typescript
// src/utils/logger.ts — 모든 모듈이 이 logger를 import하여 사용
import * as vscode from 'vscode';

let channel: vscode.OutputChannel;

export function getLogger(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("AI PR Insight");
  }
  return channel;
}

// 사용 예시
const log = getLogger();
log.appendLine(`[GitHub] Fetched PR #${prNumber}: ${files.length} files`);
log.appendLine(`[LLM] Response length: ${json.length} chars`);
log.appendLine(`[AST] Parsed ${nodes.length} functions from ${filename}`);
log.appendLine(`[Mapping] Built ${table.length} entries, avg confidence: ${avg}`);
log.appendLine(`[Perf] LLM analysis took ${elapsed}ms`);
```

**확인 방법**: Dev Host에서 `Ctrl+Shift+U` (Output 패널) → 드롭다운에서 "AI PR Insight" 선택 → 로그 실시간 확인

#### C. Webview DevTools (Webview 내부 디버깅)

Webview 내의 React 앱은 브라우저 환경이므로 별도의 DevTools로 디버깅한다.

```
[Webview DevTools 열기]
Dev Host 창에서: Ctrl+Shift+P → "Developer: Open Webview Developer Tools"
또는: Webview 패널 위에서 Ctrl+Shift+I

[확인 사항]
- Console 탭: JavaScript 에러, postMessage 로그
- Elements 탭: DOM 구조, data-* 속성, CSS 적용 확인
- Network 탭: (해당 없음, Webview는 직접 네트워크 요청하지 않음)
```

코딩 에이전트에게 Webview React 앱에 아래 디버그 로깅을 포함하도록 지시:
```typescript
// webview-ui/src/hooks/useVSCodeAPI.ts
window.addEventListener('message', (event) => {
  console.log('[Webview] Received:', event.data.type, event.data.payload);
});

function postMessage(msg: any) {
  console.log('[Webview] Sending:', msg.type, msg.payload);
  vscodeApi.postMessage(msg);
}
```

#### D. 단위 테스트 (자동 검증)

```bash
# 전체 테스트 실행
npm test

# 특정 모듈만 테스트
npm test -- --grep "GitHubClient"
npm test -- --grep "ASTParser"
npm test -- --grep "TextSimilarity"
npm test -- --grep "MappingBuilder"
npm test -- --grep "ResponseParser"
```

코딩 에이전트에게 **각 Step 완료 시 해당 모듈의 테스트도 함께 작성**하도록 지시할 것. 테스트 없는 Step 완료는 인정하지 않는다.

#### E. 성능 타이머 (Step 8에서 집중 확인, 전 Step에 걸쳐 매립)

```typescript
// src/utils/timer.ts
export function startTimer(label: string): () => void {
  const start = Date.now();
  return () => {
    const elapsed = Date.now() - start;
    getLogger().appendLine(`[Perf] ${label}: ${elapsed}ms`);
  };
}

// 사용
const done = startTimer("GitHub fetch");
const result = await githubClient.fetchPRDiff(...);
done(); // → [Perf] GitHub fetch: 1234ms
```

#### F. Step 간 체크포인트 검증 흐름도

```
Step N 완료 보고를 받으면:

 1. npm run compile → 빌드 에러 0건?
    └── No → "빌드 에러 수정해주세요" 지시
 2. npm test → 해당 Step 테스트 통과?
    └── No → "실패하는 테스트 수정해주세요" 지시
 3. F5 → Dev Host에서 해당 Step 검증표의 항목 수동 확인
    └── 실패 항목 있음 → "X-Y번 검증 항목이 동작하지 않습니다" 구체적 피드백
 4. Output Channel에 에러 로그 없음?
    └── 에러 있음 → 로그 복사하여 에이전트에게 전달
 5. 모두 통과 → Step N+1 시작 지시
```

### Step 1: 프로젝트 스캐폴딩 + 정적 Webview

**목표**: 명령어 실행 → Webview Panel 열기 → 정적 1단 레이아웃 표시

**구현 항목**:
1. `yo code` 또는 수동으로 VS Code Extension 프로젝트 생성 (TypeScript)
2. `package.json`에 명령어 `ai-pr-insight.analyzePR` 등록
3. `Extension.ts`: 명령어 핸들러에서 WebviewPanel 생성
4. `WebviewProvider.ts`: HTML 뼈대 반환 (React 빌드 결과물 로드)
5. React 앱 초기 구성: `App.tsx` + 더미 컴포넌트들
6. esbuild 설정: Extension (Node) + Webview (브라우저) 이중 빌드
7. 정적 더미 데이터로 1단 레이아웃 렌더링 확인

**완료 기준**:
- `Ctrl+Shift+P` → "AI PR Insight: Analyze PR" 실행 시 우측에 Webview 열림
- Webview에 LLM 설정 영역, Call Graph 영역, Analysis 영역이 정적으로 표시됨

**🔍 검증 방법**:
| # | 검증 항목 | 구체적 확인 방법 |
|---|----------|----------------|
| 1-1 | 빌드 성공 | 터미널에서 `npm run compile` 실행 → 에러 0건, `dist/extension.js` 와 `webview-dist/bundle.js` 생성 확인 |
| 1-2 | Extension 로드 | `F5` 눌러 Extension Development Host 창 열기 → 좌측 하단 상태바에 에러 표시 없음 |
| 1-3 | 명령어 등록 | Dev Host에서 `Ctrl+Shift+P` → "AI PR Insight" 입력 → "Analyze Pull Request" 명령어 표시됨 |
| 1-4 | Webview 렌더링 | 명령어 실행 → 에디터 우측에 패널 열림 → 빈 화면이 아닌 1단 레이아웃(LLM Settings, Call Graph, Analysis 영역) 표시 |
| 1-5 | 테마 호환 | Dev Host에서 `Ctrl+K Ctrl+T` → 다크/라이트 테마 전환 → Webview 배경·글씨 색상이 자연스럽게 변경됨 |
| 1-6 | DevTools 에러 | Webview 내에서 `Ctrl+Shift+I` → Console 탭 확인 → JavaScript 에러 0건 |

### Step 2: GitHub API 연동

**목표**: PAT 입력 → PR 번호 입력 → diff 데이터 조회 성공

**구현 항목**:
1. `GitHubClient.ts` 구현 (Octokit 사용)
2. PAT 저장/로드 로직 (`vscode.SecretStorage`)
3. 명령어 실행 시 InputBox로 `owner/repo` 및 PR 번호 입력
4. PR diff 조회 → `PRDiffResult` 객체 생성
5. 파일 전체 내용 조회 (AST 파싱용)
6. 에러 처리: 인증 실패, PR 미존재, Rate Limit

**완료 기준**:
- 실제 GitHub PR의 diff를 성공적으로 조회하여 콘솔에 출력
- 잘못된 PAT 입력 시 적절한 에러 메시지 표시

**🔍 검증 방법**:
| # | 검증 항목 | 구체적 확인 방법 |
|---|----------|----------------|
| 2-1 | PAT 입력 흐름 | 명령어 실행 → PAT 미설정 상태 → InputBox 나타남 → 유효한 PAT 입력 → "토큰 저장 완료" 알림 |
| 2-2 | PR 조회 성공 | 공개 레포의 PR 번호 입력 (테스트용: `octocat/Hello-World` PR#1) → Output Channel "AI PR Insight"에 diff 텍스트 출력 확인 |
| 2-3 | 파일 목록 확인 | Output Channel에서 `files` 배열 확인 → 각 파일의 `filename`, `status`, `patch` 필드가 채워져 있음 |
| 2-4 | 인증 실패 | 의도적으로 잘못된 PAT 입력 → "인증에 실패했습니다" 에러 메시지 표시 (VS Code 알림) |
| 2-5 | PR 미존재 | 존재하지 않는 PR 번호 입력 (예: 999999) → "PR을 찾을 수 없습니다" 에러 |
| 2-6 | 단위 테스트 | `npm test` 실행 → `GitHubClient.test.ts` 통과 (mock API 응답 기반) |

**테스트용 공개 PR 추천**: 코딩 에이전트에게 아래 중 하나로 테스트하라고 지시
- `octocat/Hello-World` — GitHub 공식 테스트 레포
- 본인의 public 레포에 간단한 테스트 PR을 미리 만들어두기 (10줄 이하 변경)

### Step 3: LLM 연동 + 프롬프팅

**목표**: PR diff를 LLM에 전달 → 구조화된 JSON 응답 수신

**구현 항목**:
1. `LLMClient.ts` 인터페이스 정의
2. `OllamaProvider.ts` 구현 (Ollama REST API)
3. `GeminiProvider.ts` 구현 (Gemini SDK)
4. `ClaudeProvider.ts` 구현 (Claude SDK)
5. `prompts.ts`: 프롬프트 템플릿 (섹션 4.3.4 참조)
6. `ResponseParser.ts`: JSON 파싱 + 스키마 검증
7. `LLMSettingsPanel.tsx`: Provider 선택 드롭다운 + 연결 상태 표시
8. VS Code settings에 LLM 설정 저장 (`vscode.workspace.getConfiguration`)

**완료 기준**:
- Ollama 실행 상태에서 diff 전달 → JSON 응답 정상 수신 및 파싱
- LLM Settings에서 Provider 전환 가능
- 연결 실패 시 에러 메시지 표시

**🔍 검증 방법**:
| # | 검증 항목 | 구체적 확인 방법 |
|---|----------|----------------|
| 3-1 | Ollama 연결 | Ollama 실행 상태에서 명령어 실행 → Webview LLM Settings에 `● Connected (Local)` 표시 |
| 3-2 | JSON 스키마 검증 | Output Channel에 LLM 응답 JSON 출력 → 아래 필수 키 존재 확인: `callGraph.root.name`, `summaryBlocks[0].title`, `prSummary` |
| 3-3 | Provider 전환 | Webview에서 드롭다운으로 Ollama → Gemini 전환 → Settings(`Ctrl+,`)에서 `aiPrInsight.llm.provider` 값이 `"gemini"`로 변경됨 |
| 3-4 | Ollama 미실행 | Ollama 종료 상태에서 분석 실행 → "Ollama가 실행 중인지 확인해주세요" 에러 메시지 |
| 3-5 | 응답 파싱 실패 | `ResponseParser.test.ts`에서 의도적으로 깨진 JSON 입력 → 재시도 로직 동작 확인 |
| 3-6 | 프롬프트 확인 | Output Channel에 전송된 프롬프트 전문 출력 → diff 내용이 정상적으로 포함되어 있는지 육안 확인 |

**디버깅 팁**: `LLMClient`에 아래와 같은 디버그 로깅을 반드시 포함시킬 것:
```typescript
const outputChannel = vscode.window.createOutputChannel("AI PR Insight");
outputChannel.appendLine(`[LLM] Provider: ${config.provider}`);
outputChannel.appendLine(`[LLM] Prompt length: ${prompt.length} chars`);
outputChannel.appendLine(`[LLM] Response (first 500): ${response.substring(0, 500)}`);
```

### Step 4: Call Graph 시각화

**목표**: LLM 응답의 callGraph 데이터를 D3.js 트리로 렌더링 + 확장/축소

**구현 항목**:
1. `CallGraphView.tsx`: D3.js를 활용한 트리 레이아웃 렌더링
2. `GraphNode.tsx`: 노드 컴포넌트 (이름, 타입 아이콘, bullet 요약)
3. 노드 클릭 → children 토글 (expand/collapse) + 애니메이션
4. 확장된 노드: glow 효과 + 상세 로직 표시
5. 그래프가 클 경우 수평 스크롤 + 줌 지원
6. `d3TreeLayout.ts`: 트리 레이아웃 계산 유틸리티

**완료 기준**:
- Call Graph가 트리 형태로 정상 렌더링
- 노드 클릭 시 하위 트리가 애니메이션과 함께 확장/축소
- 각 노드 아래 bullet 요약 표시

**🔍 검증 방법**:
| # | 검증 항목 | 구체적 확인 방법 |
|---|----------|----------------|
| 4-1 | 더미 데이터 렌더링 | LLM 연결 없이 `test/fixtures/sample-llm-response.json`의 callGraph 데이터로 렌더링 → 트리 형태 표시됨 |
| 4-2 | 노드 내용 | 각 노드에 함수명(예: `main()`)과 bullet 요약 텍스트가 표시됨 |
| 4-3 | Expand 동작 | children이 있는 노드(예: `main()`) 클릭 → `+` 아이콘이 `-`로 변경 → 하위 노드 `validate_args()`, `greet()` 등이 아래로 펼쳐짐 |
| 4-4 | Collapse 동작 | 확장된 노드 재클릭 → 하위 노드가 사라지고 `-` → `+` 복원 |
| 4-5 | 애니메이션 | 확장/축소 시 노드가 즉시 나타나지 않고, 위→아래 fade-in 트랜지션 존재 (육안 확인) |
| 4-6 | 깊은 트리 | 3단 이상 중첩된 callGraph JSON으로 테스트 → 레이아웃 깨짐 없음, 스크롤/줌 동작 |

**테스트 fixture (반드시 작성)**:
```
test/fixtures/sample-llm-response.json에 아래 구조의 더미 데이터 포함:
- root: main() → 2 children
  - validate_args() → 0 children  
  - greet(name) → 2 children
    - form_greeting_string() → 0 children
    - output_to_console() → 0 children
```

### Step 5: Step-by-Step Analysis 렌더링

**목표**: LLM 응답의 summaryBlocks를 블록 카드 형태로 렌더링

**구현 항목**:
1. `StepByStepAnalysis.tsx`: 블록 리스트 컨테이너
2. `AnalysisBlock.tsx`: 개별 블록 카드 (제목, 코드 스니펫, 설명)
3. `CodeSnippet.tsx`: 코드 구문 하이라이팅 (Prism.js 또는 Highlight.js)
4. 각 `<Explanation>` 태그에 `data-block-id` 속성 부여

**완료 기준**:
- PR diff에 대한 블록별 분석 카드가 순서대로 표시
- 코드 스니펫이 구문 하이라이팅된 상태로 표시
- 스크롤 시 부드럽게 연속적으로 읽을 수 있는 레이아웃

**🔍 검증 방법**:
| # | 검증 항목 | 구체적 확인 방법 |
|---|----------|----------------|
| 5-1 | 블록 카드 표시 | 더미 summaryBlocks (3개 이상) 로드 → 카드가 위에서 아래로 순서대로 표시됨 |
| 5-2 | 코드 하이라이팅 | `CodeSnippet` 내에서 Python 키워드(`def`, `import`, `if`)가 색상 구분됨 |
| 5-3 | data 속성 | Webview DevTools (`Ctrl+Shift+I`) → Elements 탭에서 `<div data-block-id="block_001">` 존재 확인 |
| 5-4 | 블록 타입 구분 | `blockType`이 다른 블록들(import, function_def, logic)이 시각적으로 구분됨 (아이콘 또는 색상 라벨) |
| 5-5 | 라인 범위 표시 | 각 블록 헤더에 "(Lines 1-2)" 형태의 라인 범위 표시됨 |
| 5-6 | 스크롤 | 블록이 5개 이상일 때 Webview 내에서 부드러운 스크롤 가능 |

### Step 6: AST 파싱 + 매핑 테이블 생성

**목표**: tree-sitter로 AST 파싱 + TF-IDF로 문장-코드 매핑 테이블 생성

**구현 항목**:
1. `ASTParser.ts`: tree-sitter WASM 로드 및 파싱
2. `TextSimilarity.ts`: TF-IDF + 코사인 유사도 구현
3. `MappingBuilder.ts`: 3단계 매핑 알고리즘 (섹션 4.4.2 참조)
4. 매핑 결과를 `MappingEntry[]`로 구조화
5. 단위 테스트: 샘플 코드 + 샘플 요약으로 매핑 정확도 검증

**완료 기준**:
- Python/JavaScript 코드에 대해 AST 파싱 성공
- 매핑 테이블이 생성되어 각 요약 문장에 코드 라인 범위가 할당됨
- confidence 값이 합리적인 범위로 산출됨

**🔍 검증 방법**:
| # | 검증 항목 | 구체적 확인 방법 |
|---|----------|----------------|
| 6-1 | AST 파싱 단위테스트 | `npm test -- --grep "ASTParser"` → 아래 fixture 코드에 대해 함수 3개(`main`, `validate_args`, `greet`)의 이름·라인 범위 정확히 추출 |
| 6-2 | TF-IDF 단위테스트 | `TextSimilarity.test.ts` → `"validate 함수는 인수 개수를 확인합니다"` 문장과 `def validate_args():` 코드 라인 간 유사도 > 0.3 |
| 6-3 | 매핑 테이블 출력 | Output Channel에 매핑 테이블 JSON 출력 → 각 entry의 `codeLineStart`/`codeLineEnd`가 실제 코드와 대응하는지 수작업 비교 |
| 6-4 | confidence 범위 | 매핑 테이블의 모든 entry에서 `confidence`가 0.0~1.0 사이, 평균 0.2 이상 |
| 6-5 | 미지원 언어 fallback | `.go` 파일 diff로 테스트 → tree-sitter 파싱 실패해도 에러 없이 LLM lineRange 기반 매핑 생성 |

**AST 파싱 테스트 fixture** (코딩 에이전트에게 `test/fixtures/sample-code.py`로 작성 지시):
```python
import sys, os

def validate_args():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <name>")
        sys.exit(1)

def greet(name):
    print(f"Hello, {name}!")

def main():
    validate_args()
    name = sys.argv[1]
    greet(name)

if __name__ == "__main__":
    main()
```
위 코드에 대해 AST 파싱 결과로 기대되는 출력:
```json
[
  { "name": "validate_args", "type": "function_definition", "lineRange": { "start": 3, "end": 6 } },
  { "name": "greet",         "type": "function_definition", "lineRange": { "start": 8, "end": 9 } },
  { "name": "main",          "type": "function_definition", "lineRange": { "start": 11, "end": 14 } }
]
```

### Step 7: 양방향 드래그 매핑 (핵심 인터랙션)

**목표**: 요약↔코드 간 양방향 하이라이트 매핑 동작

**구현 항목**:
1. `EditorController.ts`: Decoration 적용 + 선택 이벤트 리스너
2. Webview `mouseup` 이벤트 → 선택 텍스트 캡처 → postMessage 전송
3. Extension Host에서 수신 → 에디터 하이라이트 적용 + 스크롤
4. 역방향: 에디터 선택 → postMessage → Webview 블록 하이라이트
5. `useMapping.ts` 훅: 매핑 상태 관리 + 하이라이트 해제 타이머

**완료 기준**:
- 요약 텍스트 드래그 → 에디터에서 대응 코드 파란색 하이라이트 + 자동 스크롤
- 에디터에서 코드 선택 → Webview에서 대응 요약 블록 하이라이트 + 자동 스크롤
- 다른 영역 클릭 시 하이라이트 해제

**🔍 검증 방법**:
| # | 검증 항목 | 구체적 확인 방법 |
|---|----------|----------------|
| 7-1 | 정방향 매핑 | Webview의 Analysis 영역에서 `"validate 함수는..."` 텍스트를 마우스로 드래그 → 에디터에서 `def validate_args():` 블록(3~6줄)이 파란색 배경으로 하이라이트 |
| 7-2 | 자동 스크롤 (정방향) | 에디터가 해당 코드가 보이지 않는 위치에 있을 때 → 하이라이트와 동시에 해당 라인이 화면 중앙으로 스크롤됨 |
| 7-3 | 역방향 매핑 | 에디터에서 `def greet(name):` 라인을 마우스로 선택 → Webview에서 greet 관련 Analysis 블록의 배경색이 변경됨 |
| 7-4 | 자동 스크롤 (역방향) | Webview가 해당 블록이 보이지 않는 위치에 있을 때 → 해당 블록으로 Webview 내 자동 스크롤 |
| 7-5 | 하이라이트 해제 | 하이라이트 상태에서 빈 영역 클릭 → 에디터와 Webview 양쪽의 하이라이트 모두 해제 |
| 7-6 | 파일 자동 열기 | 에디터에 해당 파일이 열려있지 않은 상태에서 드래그 → 파일이 자동으로 열리면서 하이라이트 |
| 7-7 | postMessage 로그 | DevTools Console에서 `[Mapping] highlightCode: {filename: "main.py", lineStart: 3, lineEnd: 6}` 형태 로그 확인 |

### Step 8: 통합 테스트 + 에지 케이스

**목표**: 전체 흐름 E2E 테스트 + 에지 케이스 처리

**구현 항목**:
1. 실제 GitHub PR로 전체 흐름 테스트
2. 큰 PR (3000줄+) 처리: 파일 분할 분석
3. 바이너리 파일, 삭제된 파일 등 예외 처리
4. LLM 응답이 유효하지 않은 경우 재시도 + 에러 UI
5. 빈 PR, 단일 파일 PR 등 경계 조건 테스트
6. 성능: 분석 소요 시간 측정, 로딩 인디케이터 표시
7. package.json 정리 (contributes, activationEvents, 아이콘)

**🔍 검증 방법**:
| # | 검증 항목 | 구체적 확인 방법 |
|---|----------|----------------|
| 8-1 | E2E 정상 흐름 | 실제 GitHub PR로 전체 흐름 실행: 명령어 → PAT 인증 → PR 입력 → LLM 분석 → Call Graph 표시 → Analysis 표시 → 드래그 매핑 동작 |
| 8-2 | 로딩 UI | 분석 중 Webview에 프로그레스 바 또는 스피너 표시 → 단계별 메시지("PR 데이터 가져오는 중...", "LLM 분석 중...", "매핑 테이블 생성 중...") 순차 변경 |
| 8-3 | 대형 PR | 파일 10개 이상 또는 변경 3000줄+ PR 테스트 → 분할 분석 메시지 표시, 최종 결과 정상 렌더링 |
| 8-4 | 빈 PR | 변경사항 없는 PR → "분석할 변경사항이 없습니다" 메시지 |
| 8-5 | 바이너리 파일 | 이미지 파일 변경이 포함된 PR → 바이너리 파일은 건너뛰고 텍스트 파일만 분석 |
| 8-6 | LLM 실패 | LLM이 유효하지 않은 JSON 반환 → "재시도 중..." → 2회 실패 시 에러 UI 표시 |
| 8-7 | 성능 측정 | Output Channel에 각 단계 소요 시간 출력: `[Perf] GitHub fetch: 1.2s / LLM analysis: 15.3s / AST parse: 0.4s / Mapping: 0.8s / Total: 17.7s` |

---

## 8. 에러 처리 매트릭스

| 상황 | 대응 | 사용자 메시지 |
|------|------|---------------|
| GitHub PAT 미설정 | InputBox로 입력 유도 | "GitHub Personal Access Token을 입력해주세요" |
| GitHub PAT 인증 실패 | 재입력 유도 | "인증에 실패했습니다. 토큰을 확인해주세요" |
| PR 번호 잘못됨 | 에러 표시 | "PR #N을 찾을 수 없습니다" |
| Ollama 미실행 | 연결 재시도 + 안내 | "Ollama가 실행 중인지 확인해주세요 (localhost:11434)" |
| Cloud API 키 미설정 | Settings 열기 유도 | "API 키를 설정해주세요" |
| Cloud API 할당량 초과 | 에러 표시 | "API 할당량을 초과했습니다. 잠시 후 다시 시도해주세요" |
| LLM 응답 JSON 파싱 실패 | 최대 2회 재시도 | "분석 결과를 처리하는 중 문제가 발생했습니다. 재시도 중..." |
| tree-sitter 미지원 언어 | LLM lineRange만 사용 | 별도 메시지 없음 (graceful degradation) |
| diff 3000줄 초과 | 파일별 분할 분석 | "대규모 PR입니다. 파일별로 분할하여 분석합니다" |
| Webview 통신 실패 | 패널 재생성 | "연결이 끊어졌습니다. 다시 시도합니다" |

---

## 9. package.json 핵심 설정

```jsonc
{
  "name": "ai-pr-insight",
  "displayName": "AI PR Insight",
  "description": "LLM-powered interactive PR analysis with call graphs and code mapping",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": [],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "ai-pr-insight.analyzePR",
        "title": "AI PR Insight: Analyze Pull Request"
      },
      {
        "command": "ai-pr-insight.setGitHubToken",
        "title": "AI PR Insight: Set GitHub Token"
      }
    ],
    "configuration": {
      "title": "AI PR Insight",
      "properties": {
        "aiPrInsight.llm.provider": {
          "type": "string",
          "default": "ollama",
          "enum": ["ollama", "gemini", "claude"],
          "description": "Active LLM provider"
        },
        "aiPrInsight.llm.ollamaEndpoint": {
          "type": "string",
          "default": "http://localhost:11434",
          "description": "Ollama API endpoint"
        },
        "aiPrInsight.llm.ollamaModel": {
          "type": "string",
          "default": "llama3",
          "description": "Ollama model name"
        },
        "aiPrInsight.llm.geminiModel": {
          "type": "string",
          "default": "gemini-1.5-pro",
          "description": "Gemini model name"
        },
        "aiPrInsight.llm.claudeModel": {
          "type": "string",
          "default": "claude-sonnet-4-20250514",
          "description": "Claude model name"
        }
      }
    }
  },
  "dependencies": {
    "@octokit/rest": "^20.0.0",
    "@anthropic-ai/sdk": "^0.30.0",
    "@google/generative-ai": "^0.20.0",
    "web-tree-sitter": "^0.22.0"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@vscode/webview-ui-toolkit": "^1.4.0",
    "esbuild": "^0.20.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "d3": "^7.9.0",
    "@types/d3": "^7.4.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.4.0"
  }
}
```

---

## 10. 개발 환경 세팅 명령

```bash
# 프로젝트 생성 (수동)
mkdir ai-pr-insight && cd ai-pr-insight
npm init -y

# 핵심 의존성
npm install @octokit/rest web-tree-sitter
npm install -D typescript @types/vscode esbuild \
  react react-dom @types/react @types/react-dom \
  d3 @types/d3 @vscode/webview-ui-toolkit

# Cloud LLM SDK (선택적, 사용 시 설치)
npm install @anthropic-ai/sdk @google/generative-ai

# tree-sitter 언어 WASM (webview-ui/public/ 에 배치)
# Python: https://github.com/nicolo-ribaudo/tree-sitter-wasm-prebuilt
# JavaScript: 동일 레포에서 다운로드
```

---

## 11. 성능 목표

| 지표 | 목표값 |
|------|--------|
| PR 분석 요청 → 결과 표시 | < 30초 (Ollama llama3 기준, 500줄 이하 PR) |
| Call Graph 렌더링 | < 500ms |
| 드래그 매핑 하이라이트 반응 | < 200ms |
| Webview 초기 로딩 | < 1초 |
| 메모리 사용 (Extension Host) | < 150MB |

---

## 12. 향후 확장 계획 (2차 이후)

| 기능 | 설명 |
|------|------|
| AI Auto-Comment | LLM이 코드 라인에 자동 주석 생성 + 사용자 답글 |
| GitHub PR Comment 연동 | Webview에서 작성한 코멘트가 GitHub PR에 직접 등록 |
| 멀티 파일 동시 분석 | 여러 파일의 Call Graph를 통합 시각화 |
| 스트리밍 렌더링 | LLM 응답을 stream으로 받아 실시간 UI 업데이트 |
| 코드 수정 실시간 반영 | 에디터에서 코드 수정 시 분석 결과 자동 갱신 |
| 분석 결과 캐싱 | 동일 PR 재분석 시 캐시 활용으로 속도 향상 |
| VS Code GitHub PR Extension 연동 | 기존 PR Extension에서 직접 분석 트리거 |