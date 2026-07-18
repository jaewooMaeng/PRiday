import * as vscode from "vscode";
import { AnalysisEngine, type AnalysisResult } from "../analysis/AnalysisEngine";
import { GitHubClient } from "../github/GitHubClient";
import { LLMClient } from "../llm/LLMClient";
import type { PRDiffResult } from "../types/github";
import type { LLMConfig, LLMProvider, UILanguage } from "../types/llm";
import { getLogger } from "../utils/logger";
import { startTimer } from "../utils/timer";
import { WebviewProvider } from "../webview/WebviewProvider";
import { EditorController } from "../editor/EditorController";

const GITHUB_TOKEN_KEY = "aiPrInsight.githubToken";
const GEMINI_API_KEY = "aiPrInsight.geminiApiKey";
const CLAUDE_API_KEY = "aiPrInsight.claudeApiKey";
const OPENAI_API_KEY = "aiPrInsight.openaiApiKey";

interface ModelOption {
  label: string;
  model?: string;
}

const CUSTOM_MODEL_OPTION = "$(edit) 직접 입력";

interface RepoInput {
  owner: string;
  repo: string;
}

interface AnalysisSession {
  repo: RepoInput;
  prNumber: number;
  diff: PRDiffResult;
  result: AnalysisResult;
  githubToken: string;
}

let session: AnalysisSession | undefined;

export async function setGitHubTokenCommand(context: vscode.ExtensionContext): Promise<void> {
  const token = await vscode.window.showInputBox({
    title: "GitHub Personal Access Token",
    prompt: "GitHub PAT를 입력하세요 (repo scope 권장)",
    password: true,
    ignoreFocusOut: true,
  });
  if (!token) return;
  await context.secrets.store(GITHUB_TOKEN_KEY, token.trim());
  vscode.window.showInformationMessage("GitHub 토큰을 안전하게 저장했습니다.");
}

async function setGeminiApiKeyCommand(context: vscode.ExtensionContext): Promise<void> {
  const apiKey = await vscode.window.showInputBox({
    title: "Gemini API Key",
    prompt: "Gemini API 키를 입력하세요",
    password: true,
    ignoreFocusOut: true,
  });
  if (!apiKey) return;
  await context.secrets.store(GEMINI_API_KEY, apiKey.trim());
  vscode.window.showInformationMessage("Gemini API 키를 안전하게 저장했습니다.");
}

async function setClaudeApiKeyCommand(context: vscode.ExtensionContext): Promise<void> {
  const apiKey = await vscode.window.showInputBox({
    title: "Claude API Key",
    prompt: "Claude API 키를 입력하세요",
    password: true,
    ignoreFocusOut: true,
  });
  if (!apiKey) return;
  await context.secrets.store(CLAUDE_API_KEY, apiKey.trim());
  vscode.window.showInformationMessage("Claude API 키를 안전하게 저장했습니다.");
}

async function setOpenAIApiKeyCommand(context: vscode.ExtensionContext): Promise<void> {
  const apiKey = await vscode.window.showInputBox({
    title: "ChatGPT API Key",
    prompt: "ChatGPT API 키를 입력하세요",
    password: true,
    ignoreFocusOut: true,
  });
  if (!apiKey) return;
  await context.secrets.store(OPENAI_API_KEY, apiKey.trim());
  vscode.window.showInformationMessage("ChatGPT API 키를 안전하게 저장했습니다.");
}

export async function setLLMApiKeyCommand(context: vscode.ExtensionContext): Promise<void> {
  const provider = vscode.workspace
    .getConfiguration("aiPrInsight.llm")
    .get<LLMProvider>("provider", "gemini");
  await setApiKeyForProvider(context, provider);
}

export async function setLLMProviderCommand(context: vscode.ExtensionContext): Promise<void> {
  const selected = await vscode.window.showQuickPick(
    [
      { label: "Ollama", value: "ollama" as LLMProvider },
      { label: "Gemini", value: "gemini" as LLMProvider },
      { label: "Claude", value: "claude" as LLMProvider },
      { label: "ChatGPT", value: "chatgpt" as LLMProvider },
    ],
    {
      title: "LLM Provider 선택",
      placeHolder: "분석에 사용할 LLM provider를 선택하세요",
    }
  );
  if (!selected) return;
  await saveLLMConfig({ provider: selected.value });
  await promptForMissingApiKey(context, selected.value);

  vscode.window.showInformationMessage(`LLM provider가 ${selected.label}(으)로 설정되었습니다.`);
}

export async function setLLMModelCommand(): Promise<void> {
  const conf = vscode.workspace.getConfiguration("aiPrInsight.llm");
  const provider = conf.get<LLMProvider>("provider", "gemini");
  const modelSetting = getModelSettingName(provider);
  const currentModel = conf.get<string>(modelSetting, getDefaultModelForProvider(provider));
  const modelOptions = [
    ...getModelOptions(provider).map((model) => ({
      label: model,
      description: model === currentModel ? "현재 모델" : undefined,
      model,
    })),
    {
      label: CUSTOM_MODEL_OPTION,
      description: "목록에 없는 모델명을 입력합니다",
    },
  ];

  const selected = await vscode.window.showQuickPick<ModelOption>(modelOptions, {
    title: `${getProviderLabel(provider)} Model 선택`,
    placeHolder: `현재 ${getProviderLabel(provider)} 모델: ${currentModel}`,
  });
  if (!selected) return;

  const model =
    selected.model ??
    (await vscode.window.showInputBox({
      title: `${getProviderLabel(provider)} Model 직접 입력`,
      prompt: "사용할 모델명을 입력하세요",
      placeHolder: currentModel,
      value: currentModel,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : "모델명을 입력해주세요"),
    }));
  if (!model) return;

  const trimmedModel = model.trim();
  await conf.update(modelSetting, trimmedModel, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(
    `${getProviderLabel(provider)} 모델이 ${trimmedModel}(으)로 설정되었습니다.`
  );
}

export async function analyzePRCommand(
  context: vscode.ExtensionContext,
  webviewProvider: WebviewProvider,
  editorController: EditorController
): Promise<void> {
  const config = await loadLLMConfig(context);
  const repoInput = await askRepository();
  if (!repoInput) return;
  const prNumberText = await askPRNumber();
  if (!prNumberText) return;

  webviewProvider.show(prNumberText);
  webviewProvider.postLLMConfig(config);
  await runFullAnalysis({
    context,
    webviewProvider,
    editorController,
    repoInput,
    prNumber: Number(prNumberText),
  });
}

interface RunInput {
  context: vscode.ExtensionContext;
  webviewProvider: WebviewProvider;
  editorController: EditorController;
  repoInput: RepoInput;
  prNumber: number;
}

export async function runFullAnalysis(input: RunInput): Promise<void> {
  const { context, webviewProvider, repoInput, prNumber } = input;
  const log = getLogger();

  try {
    const token = await getOrCreateToken(context);
    if (!token) return;

    webviewProvider.postProgress("fetching_pr", 15);
    const doneFetch = startTimer("GitHub fetch");
    const github = new GitHubClient(token);
    await github.validateToken();
    const diff = await github.fetchPRDiff(repoInput.owner, repoInput.repo, prNumber);
    doneFetch();
    if (diff.files.length === 0) {
      webviewProvider.postError("분석할 변경사항이 없습니다");
      return;
    }
    log.appendLine(`[GitHub] fetched files: ${diff.files.length}, comments: ${diff.comments.length}`);

    webviewProvider.postProgress("calling_llm", 45);
    const llm = new LLMClient();
    const config = await loadLLMConfig(context);
    if (!(await ensureApiKeyForAnalysis(context, config))) return;
    const doneLLM = startTimer("LLM analysis");
    const llmResponse = await llm.analyze(diff, config);
    doneLLM();

    webviewProvider.postProgress("parsing_ast", 70);
    const engine = new AnalysisEngine();
    const doneMap = startTimer("Mapping build");
    const result = engine.build(llmResponse, diff, prNumber);
    doneMap();
    webviewProvider.postProgress("building_map", 95);

    session = { repo: repoInput, prNumber, diff, result, githubToken: token };
    webviewProvider.postAnalysisResult(result);
    webviewProvider.postProgress("building_map", 100);
    vscode.window.showInformationMessage(`PR #${prNumber} 분석 완료`);
  } catch (error) {
    const message = toUserMessage(error);
    log.appendLine(`[Analyze] Error: ${message}`);
    webviewProvider.postError(message);
    vscode.window.showErrorMessage(message);
  }
}

export function bindWebviewHandlers(
  context: vscode.ExtensionContext,
  webviewProvider: WebviewProvider,
  editorController: EditorController
): void {
  const llm = new LLMClient();

  webviewProvider.setMessageHandlers({
    onHighlightCode: async (payload) => {
      await editorController.highlightCode(
        payload.filename,
        payload.lineStart,
        payload.lineEnd,
        payload.confidence ?? 1
      );
    },
    onUpdateLLMConfig: async (payload) => {
      await saveLLMConfig(payload);
      const updated = await loadLLMConfig(context);
      webviewProvider.postLLMConfig(updated);
      vscode.window.showInformationMessage("LLM 설정이 저장되었습니다.");
    },
    onUpdateSecrets: async (payload) => {
      if (payload.llmApiKey?.trim() && payload.provider) {
        const keyName = getApiKeySecretName(payload.provider);
        if (keyName) {
          await context.secrets.store(keyName, payload.llmApiKey.trim());
        }
      }
      if (payload.githubToken?.trim()) {
        await context.secrets.store(GITHUB_TOKEN_KEY, payload.githubToken.trim());
      }
      const updated = await loadLLMConfig(context);
      webviewProvider.postLLMConfig(updated);
      vscode.window.showInformationMessage("API 키 설정이 저장되었습니다.");
    },
    onTestConnection: async (payload) => {
      try {
        const current = await loadLLMConfig(context);
        const config = { ...current, ...payload };
        if (!(await ensureApiKeyForAnalysis(context, config))) return;
        const provider = new LLMClient();
        await provider.chat("Reply with OK.", "Connection test for AI PR Insight.", config);
        const updated = await loadLLMConfig(context);
        webviewProvider.postLLMConfig(updated);
        vscode.window.showInformationMessage("LLM 연결 테스트에 성공했습니다.");
      } catch (err) {
        webviewProvider.postError(
          `연결 테스트 실패: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    },
    onReanalyze: async () => {
      if (!session) return;
      await runFullAnalysis({
        context,
        webviewProvider,
        editorController,
        repoInput: session.repo,
        prNumber: session.prNumber,
      });
    },
    onClearHighlight: () => {
      editorController.clearHighlights();
    },
    onChat: async (payload) => {
      try {
        const config = await loadLLMConfig(context);
        const analysisContext = session
          ? buildRichChatContext(session)
          : "No analysis context available.";
        const response = await llm.chat(payload.message, analysisContext, config);
        webviewProvider.postChatResponse(response);
      } catch (err) {
        webviewProvider.postChatResponse(
          `Error: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    },
    onPostComment: async (payload) => {
      if (!session) {
        webviewProvider.postCommentResult(false, "No active session");
        return;
      }
      try {
        const github = new GitHubClient(session.githubToken);
        if (payload.filename && payload.line) {
          const sha = await github.getHeadSha(
            session.repo.owner,
            session.repo.repo,
            session.prNumber
          );
          await github.createReviewComment(
            session.repo.owner,
            session.repo.repo,
            session.prNumber,
            payload.body,
            payload.filename,
            payload.line,
            sha
          );
        } else {
          await github.createPRComment(
            session.repo.owner,
            session.repo.repo,
            session.prNumber,
            payload.body
          );
        }
        webviewProvider.postCommentResult(true);
        vscode.window.showInformationMessage("PR 코멘트가 게시되었습니다.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        webviewProvider.postCommentResult(false, msg);
        vscode.window.showErrorMessage(`코멘트 실패: ${msg}`);
      }
    },
  });

  const reverseDisposable = editorController.registerReverseMapping(
    () => session?.result.mappingTable ?? [],
    (match) => webviewProvider.postSummaryHighlight(match.summaryBlockId, match.sentenceIndex)
  );
  context.subscriptions.push(reverseDisposable);
}

function toUserMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "알 수 없는 오류";
  if (message.includes("401") || message.includes("Bad credentials")) {
    return "인증에 실패했습니다. 토큰을 확인해주세요";
  }
  if (message.includes("404")) {
    return "PR을 찾을 수 없습니다";
  }
  if (message.toLowerCase().includes("rate limit")) {
    return "API 할당량을 초과했습니다. 잠시 후 다시 시도해주세요";
  }
  return message;
}

async function promptForMissingApiKey(
  context: vscode.ExtensionContext,
  provider: LLMProvider
): Promise<void> {
  const keyName = getApiKeySecretName(provider);
  if (!keyName) return;

  const existing = await context.secrets.get(keyName);
  if (existing) return;

  const shouldSet = await vscode.window.showWarningMessage(
    `${getProviderLabel(provider)} provider를 선택했습니다. API 키를 지금 입력할까요?`,
    "입력하기",
    "나중에"
  );
  if (shouldSet === "입력하기") {
    await setApiKeyForProvider(context, provider);
  }
}

async function ensureApiKeyForAnalysis(
  context: vscode.ExtensionContext,
  config: LLMConfig
): Promise<boolean> {
  if (config.provider === "ollama") return true;

  const hasKey =
    (config.provider === "gemini" && !!config.geminiApiKey) ||
    (config.provider === "claude" && !!config.claudeApiKey) ||
    (config.provider === "chatgpt" && !!config.openaiApiKey);
  if (hasKey) return true;

  const shouldSet = await vscode.window.showWarningMessage(
    `${getProviderLabel(config.provider)} API 키가 설정되지 않았습니다. 지금 입력하시겠습니까?`,
    "입력하기",
    "취소"
  );
  if (shouldSet !== "입력하기") return false;

  await setApiKeyForProvider(context, config.provider);
  config.geminiApiKey = (await context.secrets.get(GEMINI_API_KEY)) ?? undefined;
  config.claudeApiKey = (await context.secrets.get(CLAUDE_API_KEY)) ?? undefined;
  config.openaiApiKey = (await context.secrets.get(OPENAI_API_KEY)) ?? undefined;

  return (
    (config.provider === "gemini" && !!config.geminiApiKey) ||
    (config.provider === "claude" && !!config.claudeApiKey) ||
    (config.provider === "chatgpt" && !!config.openaiApiKey)
  );
}

async function setApiKeyForProvider(
  context: vscode.ExtensionContext,
  provider: LLMProvider
): Promise<void> {
  if (provider === "gemini") {
    await setGeminiApiKeyCommand(context);
    return;
  }
  if (provider === "claude") {
    await setClaudeApiKeyCommand(context);
    return;
  }
  if (provider === "chatgpt") {
    await setOpenAIApiKeyCommand(context);
    return;
  }
  vscode.window.showInformationMessage("Ollama는 로컬 provider라 API 키 설정이 필요하지 않습니다.");
}

function getApiKeySecretName(provider: LLMProvider): string | undefined {
  if (provider === "gemini") return GEMINI_API_KEY;
  if (provider === "claude") return CLAUDE_API_KEY;
  if (provider === "chatgpt") return OPENAI_API_KEY;
  return undefined;
}

function getProviderLabel(provider: LLMProvider): string {
  if (provider === "chatgpt") return "ChatGPT";
  if (provider === "gemini") return "Gemini";
  if (provider === "claude") return "Claude";
  return "Ollama";
}

function getModelSettingName(provider: LLMProvider): keyof LLMConfig {
  if (provider === "chatgpt") return "chatgptModel";
  if (provider === "gemini") return "geminiModel";
  if (provider === "claude") return "claudeModel";
  return "ollamaModel";
}

function getDefaultModelForProvider(provider: LLMProvider): string {
  if (provider === "chatgpt") return "gpt-5.5";
  if (provider === "gemini") return "gemini-2.5-flash";
  if (provider === "claude") return "claude-sonnet-4-20250514";
  return "llama3";
}

function getModelOptions(provider: LLMProvider): string[] {
  if (provider === "chatgpt") return ["gpt-5.5", "gpt-4o", "gpt-4o-mini"];
  if (provider === "gemini") return ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash"];
  if (provider === "claude") {
    return ["claude-sonnet-4-20250514", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"];
  }
  return ["llama3", "llama3.1", "mistral", "codellama"];
}

async function askRepository(): Promise<RepoInput | undefined> {
  const input = await vscode.window.showInputBox({
    title: "Repository",
    prompt: "owner/repo 형식으로 입력하세요",
    placeHolder: "예: octocat/Hello-World",
    validateInput: (value) =>
      value.trim().match(/^[^/\s]+\/[^/\s]+$/) ? undefined : "owner/repo 형식이어야 합니다",
  });
  if (!input) return undefined;
  const [owner, repo] = input.split("/");
  return { owner, repo };
}

async function askPRNumber(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: "Analyze Pull Request",
    prompt: "분석할 PR 번호를 입력하세요",
    placeHolder: "예: 1",
    value: "1",
    validateInput: (value) => (/^\d+$/.test(value.trim()) ? undefined : "숫자만 입력해주세요"),
  });
}

async function getOrCreateToken(context: vscode.ExtensionContext): Promise<string | undefined> {
  const existingToken = await context.secrets.get(GITHUB_TOKEN_KEY);
  if (existingToken) return existingToken;
  const token = await vscode.window.showInputBox({
    title: "GitHub Personal Access Token",
    prompt: "GitHub PAT를 입력해주세요",
    password: true,
    ignoreFocusOut: true,
  });
  if (!token) return undefined;
  await context.secrets.store(GITHUB_TOKEN_KEY, token.trim());
  return token.trim();
}

async function loadLLMConfig(context: vscode.ExtensionContext): Promise<LLMConfig> {
  const conf = vscode.workspace.getConfiguration("aiPrInsight.llm");
  const provider = conf.get<LLMProvider>("provider", "gemini");
  const geminiApiKey = await context.secrets.get(GEMINI_API_KEY);
  const claudeApiKey = await context.secrets.get(CLAUDE_API_KEY);
  const openaiApiKey = await context.secrets.get(OPENAI_API_KEY);
  const githubToken = await context.secrets.get(GITHUB_TOKEN_KEY);
  return {
    provider,
    ollamaEndpoint: conf.get<string>("ollamaEndpoint", "http://localhost:11434"),
    ollamaModel: conf.get<string>("ollamaModel", "llama3"),
    geminiModel: conf.get<string>("geminiModel", "gemini-2.5-flash"),
    claudeModel: conf.get<string>("claudeModel", "claude-sonnet-4-20250514"),
    geminiApiKey: geminiApiKey ?? undefined,
    claudeApiKey: claudeApiKey ?? undefined,
    openaiApiKey: openaiApiKey ?? undefined,
    chatgptModel: conf.get<string>("chatgptModel", "gpt-5.5"),
    language: conf.get<UILanguage>("language", "ko"),
    hasGeminiApiKey: !!geminiApiKey,
    hasClaudeApiKey: !!claudeApiKey,
    hasOpenAIApiKey: !!openaiApiKey,
    hasGitHubToken: !!githubToken,
  };
}

function buildRichChatContext(s: AnalysisSession): string {
  const fileSummaries = s.diff.files.map((f) => {
    const patchPreview = f.patch.length > 2000 ? f.patch.slice(0, 2000) + "\n...(truncated)" : f.patch;
    return `--- File: ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) ---\n${patchPreview}`;
  });

  const commentsSummary =
    s.diff.comments.length > 0
      ? s.diff.comments
          .map((c) => {
            const loc = c.path ? ` [${c.path}${c.line ? `:${c.line}` : ""}]` : "";
            return `${c.author}${loc}: ${c.body}`;
          })
          .join("\n")
      : "No comments";

  return [
    `PR #${s.prNumber}: ${s.diff.prTitle}`,
    `Branch: ${s.diff.headBranch} → ${s.diff.baseBranch}`,
    `Description: ${s.diff.prBody || "(none)"}`,
    "",
    `AI Analysis Summary: ${s.result.prSummary}`,
    "",
    "=== PR Comments ===",
    commentsSummary,
    "",
    "=== Changed Files ===",
    ...fileSummaries,
  ].join("\n");
}

async function saveLLMConfig(config: LLMConfig): Promise<void> {
  const conf = vscode.workspace.getConfiguration("aiPrInsight.llm");
  await conf.update("provider", config.provider, vscode.ConfigurationTarget.Global);
  if (config.ollamaEndpoint) {
    await conf.update("ollamaEndpoint", config.ollamaEndpoint, vscode.ConfigurationTarget.Global);
  }
  if (config.ollamaModel) {
    await conf.update("ollamaModel", config.ollamaModel, vscode.ConfigurationTarget.Global);
  }
  if (config.geminiModel) {
    await conf.update("geminiModel", config.geminiModel, vscode.ConfigurationTarget.Global);
  }
  if (config.claudeModel) {
    await conf.update("claudeModel", config.claudeModel, vscode.ConfigurationTarget.Global);
  }
  if (config.chatgptModel) {
    await conf.update("chatgptModel", config.chatgptModel, vscode.ConfigurationTarget.Global);
  }
  if (config.language) {
    await conf.update("language", config.language, vscode.ConfigurationTarget.Global);
  }
}
