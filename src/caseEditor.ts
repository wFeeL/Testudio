import * as vscode from 'vscode';
import { CasePanel } from './casePanel';
import { CASE_VIEW_TYPE, caseNameFromUri } from './caseUri';
import { TestTree } from './testTree';

export function registerCaseEditor(context: vscode.ExtensionContext, tree: TestTree): vscode.Disposable {
  const provider: vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> = {
    openCustomDocument: function (uri: vscode.Uri): vscode.CustomDocument {
      return {
        uri: uri,
        dispose: function (): void {}
      };
    },
    resolveCustomEditor: async function (document: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
      const name = caseNameFromUri(document.uri);
      if (name === undefined) {
        panel.dispose();
        return;
      }
      if (tree.getCase(name) === undefined) {
        await tree.refresh();
      }
      if (tree.getCase(name) === undefined) {
        vscode.window.showErrorMessage('Кейс ' + name + ' не найден, обновите дерево тестов.');
        panel.dispose();
        return;
      }
      CasePanel.open(context, tree, panel, name);
    }
  };
  return vscode.window.registerCustomEditorProvider(CASE_VIEW_TYPE, provider, {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: false
  });
}
