import * as vscode from 'vscode';
import { CasePanel } from './casePanel';
import { buildProject } from './ctest';
import { chooseExecutable, readSettings } from './settings';
import { TestTree } from './testTree';

const REFRESH_DELAY_MS = 300;
const SHOW_OUTPUT = 'Показать вывод';
const CASE_PREFIX = 'case:';

async function runBuild(tree: TestTree, output: vscode.OutputChannel): Promise<void> {
  const settings = readSettings();
  if (settings === undefined) {
    vscode.window.showErrorMessage('Откройте папку проекта, чтобы собрать его.');
    return;
  }

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Testudio++: сборка проекта'
    },
    async function () {
      return buildProject(settings.buildDir);
    }
  );

  output.clear();
  output.appendLine(result.output);

  if (result.exitCode === 0) {
    await tree.refresh();
    vscode.window.showInformationMessage('Сборка завершена.');
    return;
  }

  let text = 'Сборка не удалась, код возврата ' + result.exitCode + '.';
  if (result.missing) {
    text = 'Не найден cmake: проверьте, что он есть в PATH.';
  } else if (result.exitCode === null) {
    text = 'Сборка не запущена: ' + result.output;
  }
  const choice = await vscode.window.showErrorMessage(text, SHOW_OUTPUT);
  if (choice === SHOW_OUTPUT) {
    output.show();
  }
}

async function runSelectExecutable(): Promise<void> {
  const chosen = await chooseExecutable();
  if (chosen !== undefined) {
    vscode.window.showInformationMessage('Тестируемая программа: ' + chosen);
  }
}

function caseNameFromItem(item: vscode.TestItem | undefined): string | undefined {
  if (!item || typeof item.id !== 'string') {
    return undefined;
  }
  if (!item.id.startsWith(CASE_PREFIX)) {
    return undefined;
  }
  return item.id.slice(CASE_PREFIX.length);
}

async function runOpenCase(
  context: vscode.ExtensionContext,
  tree: TestTree,
  item: vscode.TestItem | undefined
): Promise<void> {
  let name = caseNameFromItem(item);
  if (name === undefined) {
    const names = tree.getCaseNames();
    if (names.length === 0) {
      vscode.window.showInformationMessage('Кейсов не найдено: проверьте настройку testudio.testdataPath.');
      return;
    }
    name = await vscode.window.showQuickPick(names, { placeHolder: 'Выберите кейс' });
    if (name === undefined) {
      return;
    }
  }
  CasePanel.show(context, tree, name);
}

export function activate(context: vscode.ExtensionContext): void {
  const controller = vscode.tests.createTestController('testudio', 'Testudio++');
  const output = vscode.window.createOutputChannel('Testudio++');
  const tree = new TestTree(controller);

  let timer: NodeJS.Timeout | undefined;
  let watcher: vscode.FileSystemWatcher | undefined;

  function scheduleRefresh(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(function () {
      timer = undefined;
      tree.refresh();
    }, REFRESH_DELAY_MS);
  }

  function resetWatcher(): void {
    if (watcher !== undefined) {
      watcher.dispose();
      watcher = undefined;
    }
    const settings = readSettings();
    if (settings === undefined) {
      return;
    }
    const pattern = new vscode.RelativePattern(settings.testdataDir, '**');
    watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(scheduleRefresh);
    watcher.onDidChange(scheduleRefresh);
    watcher.onDidDelete(scheduleRefresh);
  }

  controller.refreshHandler = function (): Promise<void> {
    return tree.refresh();
  };

  context.subscriptions.push(controller);
  context.subscriptions.push(output);
  context.subscriptions.push(
    vscode.commands.registerCommand('testudio.build', function (): Promise<void> {
      return runBuild(tree, output);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('testudio.selectExecutable', function (): Promise<void> {
      return runSelectExecutable();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('testudio.openCase', function (item?: vscode.TestItem): Promise<void> {
      return runOpenCase(context, tree, item);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('testudio.newCase', function (): void {
      CasePanel.showNew(context, tree);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(function (event: vscode.ConfigurationChangeEvent): void {
      if (event.affectsConfiguration('testudio')) {
        resetWatcher();
        scheduleRefresh();
      }
    })
  );
  context.subscriptions.push({
    dispose: function (): void {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (watcher !== undefined) {
        watcher.dispose();
      }
    }
  });

  resetWatcher();
  tree.refresh();
}

export function deactivate(): void {}
