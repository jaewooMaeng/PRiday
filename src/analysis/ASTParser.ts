export interface ASTNode {
  type: string;
  name: string;
  lineRange: { start: number; end: number };
  children: ASTNode[];
}

interface ParseInput {
  filename: string;
  content: string;
}

let TreeSitterParser: unknown = null;

export class ASTParser {
  private parser: unknown = null;
  private languages = new Map<string, unknown>();
  private ready = false;

  public async initialize(extensionPath: string): Promise<void> {
    let log: { appendLine: (msg: string) => void } = { appendLine: () => {} };
    try { log = require("../utils/logger").getLogger(); } catch { /* noop */ }
    try {
      TreeSitterParser = require("web-tree-sitter");
      const path = require("path");
      const fs = require("fs");

      await (TreeSitterParser as any).init({
        locateFile: (filename: string) =>
          path.join(extensionPath, "node_modules", "web-tree-sitter", filename),
      });
      this.parser = new (TreeSitterParser as any)();

      const grammarDir = path.join(extensionPath, "parsers");
      if (fs.existsSync(grammarDir)) {
        const grammars: Record<string, string> = {
          ".py": "tree-sitter-python.wasm",
          ".js": "tree-sitter-javascript.wasm",
          ".ts": "tree-sitter-typescript.wasm",
          ".tsx": "tree-sitter-tsx.wasm",
        };
        for (const [ext, wasmFile] of Object.entries(grammars)) {
          const wasmPath = path.join(grammarDir, wasmFile);
          if (fs.existsSync(wasmPath)) {
            const lang = await (TreeSitterParser as any).Language.load(wasmPath);
            this.languages.set(ext, lang);
            log.appendLine(`[ASTParser] Loaded tree-sitter grammar for ${ext}`);
          }
        }
      }

      this.ready = this.languages.size > 0;
      log.appendLine(`[ASTParser] tree-sitter ready: ${this.ready} (${this.languages.size} languages)`);
    } catch (err) {
      log.appendLine(`[ASTParser] tree-sitter init failed, using regex fallback: ${err}`);
      this.ready = false;
    }
  }

  public parse({ filename, content }: ParseInput): ASTNode[] {
    if (this.ready && this.parser) {
      const ext = this.getExtension(filename);
      const lang = this.languages.get(ext);
      if (lang) {
        return this.parseWithTreeSitter(content, lang);
      }
    }
    return this.parseWithRegex(filename, content);
  }

  private parseWithTreeSitter(content: string, lang: unknown): ASTNode[] {
    try {
      (this.parser as any).setLanguage(lang);
      const tree = (this.parser as any).parse(content);
      return this.extractNodes(tree.rootNode);
    } catch {
      return [];
    }
  }

  private extractNodes(node: any): ASTNode[] {
    const result: ASTNode[] = [];
    const interesting = new Set([
      "function_definition",
      "class_definition",
      "function_declaration",
      "class_declaration",
      "method_definition",
      "arrow_function",
      "export_statement",
    ]);

    for (const child of node.namedChildren) {
      if (interesting.has(child.type)) {
        const nameNode =
          child.childForFieldName?.("name") ??
          child.namedChildren?.find((c: any) => c.type === "identifier" || c.type === "property_identifier");
        result.push({
          type: child.type,
          name: nameNode?.text ?? "<anonymous>",
          lineRange: {
            start: child.startPosition.row + 1,
            end: child.endPosition.row + 1,
          },
          children: this.extractNodes(child),
        });
      } else {
        result.push(...this.extractNodes(child));
      }
    }
    return result;
  }

  private parseWithRegex(filename: string, content: string): ASTNode[] {
    if (filename.endsWith(".py")) {
      return this.parsePython(content);
    }
    if (filename.endsWith(".ts") || filename.endsWith(".tsx") || filename.endsWith(".js") || filename.endsWith(".jsx")) {
      return this.parseTsLike(content);
    }
    if (filename.endsWith(".java") || filename.endsWith(".kt")) {
      return this.parseJavaLike(content);
    }
    if (filename.endsWith(".go")) {
      return this.parseGo(content);
    }
    return [];
  }

  private parsePython(content: string): ASTNode[] {
    const lines = content.split("\n");
    const nodes: ASTNode[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const fnMatch = lines[i]?.match(/^\s*def\s+([a-zA-Z_]\w*)\s*\(/);
      const clsMatch = lines[i]?.match(/^\s*class\s+([a-zA-Z_]\w*)/);
      const match = fnMatch ?? clsMatch;
      if (!match) continue;

      const name = match[1];
      const type = fnMatch ? "function_definition" : "class_definition";
      const start = i + 1;
      let end = start;
      const indent = (lines[i]?.match(/^(\s*)/) ?? [""])[0].length;
      for (let j = i + 1; j < lines.length; j += 1) {
        const lineContent = lines[j];
        if (lineContent && lineContent.trim().length > 0) {
          const lineIndent = (lineContent.match(/^(\s*)/) ?? [""])[0].length;
          if (lineIndent <= indent) break;
        }
        end = j + 1;
      }
      nodes.push({ type, name, lineRange: { start, end }, children: [] });
    }
    return nodes;
  }

  private parseTsLike(content: string): ASTNode[] {
    const lines = content.split("\n");
    const nodes: ASTNode[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const fnMatch = lines[i]?.match(/(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_]\w*)\s*[(<]/);
      const clsMatch = lines[i]?.match(/(?:export\s+)?class\s+([a-zA-Z_]\w*)/);
      const arrowMatch = lines[i]?.match(/(?:export\s+)?(?:const|let)\s+([a-zA-Z_]\w*)\s*=\s*(?:async\s+)?\(/);
      const match = fnMatch ?? clsMatch ?? arrowMatch;
      if (!match) continue;

      const type = clsMatch ? "class_declaration" : "function_declaration";
      let end = i + 1;
      let braceDepth = 0;
      for (let j = i; j < lines.length; j += 1) {
        for (const ch of (lines[j] ?? "")) {
          if (ch === "{") braceDepth++;
          if (ch === "}") braceDepth--;
        }
        end = j + 1;
        if (braceDepth <= 0 && j > i) break;
      }
      nodes.push({ type, name: match[1], lineRange: { start: i + 1, end }, children: [] });
    }
    return nodes;
  }

  private parseJavaLike(content: string): ASTNode[] {
    const lines = content.split("\n");
    const nodes: ASTNode[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i]?.match(/(?:public|private|protected|static|\s)+\s+(?:class|interface)\s+([a-zA-Z_]\w*)/);
      const fnMatch = lines[i]?.match(/(?:public|private|protected|static|\s)+\s+\w+\s+([a-zA-Z_]\w*)\s*\(/);
      const m = match ?? fnMatch;
      if (!m) continue;
      nodes.push({
        type: match ? "class_definition" : "function_definition",
        name: m[1],
        lineRange: { start: i + 1, end: Math.min(i + 10, lines.length) },
        children: [],
      });
    }
    return nodes;
  }

  private parseGo(content: string): ASTNode[] {
    const lines = content.split("\n");
    const nodes: ASTNode[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i]?.match(/^func\s+(?:\([^)]*\)\s+)?([a-zA-Z_]\w*)\s*\(/);
      if (!match) continue;
      let end = i + 1;
      let braceDepth = 0;
      for (let j = i; j < lines.length; j += 1) {
        for (const ch of (lines[j] ?? "")) {
          if (ch === "{") braceDepth++;
          if (ch === "}") braceDepth--;
        }
        end = j + 1;
        if (braceDepth <= 0 && j > i) break;
      }
      nodes.push({ type: "function_definition", name: match[1], lineRange: { start: i + 1, end }, children: [] });
    }
    return nodes;
  }

  private getExtension(filename: string): string {
    const dot = filename.lastIndexOf(".");
    return dot >= 0 ? filename.substring(dot) : "";
  }
}
