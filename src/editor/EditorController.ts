import * as vscode from "vscode";
import type { MappingEntry } from "../types/summary";

export class EditorController {
  private readonly strongDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    border: "1px solid rgba(59, 130, 246, 0.4)",
    borderRadius: "3px",
    isWholeLine: true,
    overviewRulerColor: "rgba(59, 130, 246, 0.8)",
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });

  private readonly weakDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(59, 130, 246, 0.06)",
    border: "1px dashed rgba(59, 130, 246, 0.2)",
    isWholeLine: true,
  });

  public async highlightCode(
    filename: string,
    lineStart: number,
    lineEnd: number,
    confidence = 1
  ): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(filename);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    const range = new vscode.Range(
      Math.max(0, lineStart - 1),
      0,
      Math.max(0, lineEnd - 1),
      Number.MAX_SAFE_INTEGER
    );
    editor.setDecorations(confidence >= 0.3 ? this.strongDecoration : this.weakDecoration, [range]);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }

  public clearHighlights(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    editor.setDecorations(this.strongDecoration, []);
    editor.setDecorations(this.weakDecoration, []);
  }

  public registerReverseMapping(
    mappingTableRef: () => MappingEntry[],
    onMatch: (match: MappingEntry) => void
  ): vscode.Disposable {
    return vscode.window.onDidChangeTextEditorSelection((event) => {
      const selection = event.selections[0];
      if (!selection || selection.isEmpty) {
        return;
      }
      const lineStart = selection.start.line + 1;
      const lineEnd = selection.end.line + 1;
      const filename = event.textEditor.document.fileName;
      const found = mappingTableRef().find(
        (item) =>
          item.filename === filename &&
          item.codeLineStart <= lineEnd &&
          item.codeLineEnd >= lineStart
      );
      if (found) {
        onMatch(found);
      }
    });
  }
}
