import * as vscode from 'vscode';
import { confirmAndDeleteCase } from './caseDelete';
import { registerCaseEditor } from './caseEditor';
import { CasePanel } from './casePanel';
import { CASE_VIEW_TYPE, caseUri } from './caseUri';
import { CommandResult, buildProject, configureProject } from './ctest';
import { killAllProcesses } from './processes';
import { Settings, chooseExecutable, readSettings } from './settings';
import { CASE_PREFIX, TestTree } from './testTree';
import { findTool, missingToolMessage } from './tools';

const REFRESH_DELAY_MS = 300;
const SHOW_OUTPUT = 'Показать вывод';

let cmakeRunning = false;

function readSettingsOrWarn(action: string): Settings | undefined {
  const settings = readSettings();
  if (settings === undefined) {
    vscode.window.showErrorMessage('Откройте папку проекта, чтобы ' + action + ' его.');
  }
  return settings;
}

async function runCmake(
  settings: Settings,
  output: vscode.OutputChannel,
  title: string,
  name: string,
  start: (cmakeCommand: string) => Promise<CommandResult>
): Promise<boolean> {
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: title
    },
    async function () {
      const cmakeCommand = await findTool('cmake', settings.cmakePath);
      return start(cmakeCommand);
    }
  );

  output.clear();
  output.appendLine(result.output);

  if (result.exitCode === 0) {
    return true;
  }

  let text = name + ' не удалась, код возврата ' + result.exitCode + '.';
  if (result.missing) {
    text = missingToolMessage('cmake', 'testudio.cmakePath', settings.cmakePath);
  } else if (result.exitCode === null) {
    text = name + ' не запущена: ' + result.output;
  }
  const choice = await vscode.window.showErrorMessage(text, SHOW_OUTPUT);
  if (choice === SHOW_OUTPUT) {
    output.show();
  }
  return false;
}

async function configureStep(settings: Settings, output: vscode.OutputChannel): Promise<boolean> {
  return runCmake(settings, output, 'Testudio++: настройка проекта', 'Настройка', function (cmakeCommand: string) {
    return configureProject(cmakeCommand, settings.workspaceRoot, settings.buildDir);
  });
}

async function buildStep(settings: Settings, output: vscode.OutputChannel): Promise<boolean> {
  return runCmake(settings, output, 'Testudio++: сборка проекта', 'Сборка', function (cmakeCommand: string) {
    return buildProject(cmakeCommand, settings.buildDir);
  });
}

async function runExclusive(tree: TestTree, work: () => Promise<string | undefined>): Promise<void> {
  if (cmakeRunning) {
    vscode.window.showInformationMessage('Настройка или сборка уже идёт.');
    return;
  }
  cmakeRunning = true;
  tree.setCmakeRunning(true);
  let doneText: string | undefined;
  try {
    doneText = await work();
  } finally {
    cmakeRunning = false;
    tree.setCmakeRunning(false);
    await tree.refresh();
  }
  if (doneText !== undefined) {
    vscode.window.showInformationMessage(doneText);
  }
}

function runConfigure(tree: TestTree, output: vscode.OutputChannel): Promise<void> {
  return runExclusive(tree, async function (): Promise<string | undefined> {
    const settings = readSettingsOrWarn('настроить');
    if (settings === undefined) {
      return undefined;
    }
    const done = await configureStep(settings, output);
    return done ? 'Настройка завершена.' : undefined;
  });
}

function runBuild(tree: TestTree, output: vscode.OutputChannel): Promise<void> {
  return runExclusive(tree, async function (): Promise<string | undefined> {
    const settings = readSettingsOrWarn('собрать');
    if (settings === undefined) {
      return undefined;
    }
    const done = await buildStep(settings, output);
    return done ? 'Сборка завершена.' : undefined;
  });
}

function runConfigureAndBuild(tree: TestTree, output: vscode.OutputChannel): Promise<void> {
  return runExclusive(tree, async function (): Promise<string | undefined> {
    const settings = readSettingsOrWarn('настроить и собрать');
    if (settings === undefined) {
      return undefined;
    }
    const configured = await configureStep(settings, output);
    if (!configured) {
      return undefined;
    }
    const built = await buildStep(settings, output);
    return built ? 'Настройка и сборка завершены.' : undefined;
  });
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

async function runOpenCase(tree: TestTree, item: vscode.TestItem | undefined): Promise<void> {
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
  await vscode.commands.executeCommand('vscode.openWith', caseUri(name), CASE_VIEW_TYPE);
}

async function runDeleteCase(tree: TestTree, item: vscode.TestItem | undefined): Promise<void> {
  const name = caseNameFromItem(item);
  if (name === undefined) {
    return;
  }
  const testCase = tree.getCase(name);
  if (testCase === undefined) {
    vscode.window.showWarningMessage('Кейс не найден, обновите дерево тестов.');
    return;
  }
  const deleted = await confirmAndDeleteCase(testCase);
  if (!deleted) {
    return;
  }
  CasePanel.closeFor(name);
  await tree.refresh();
}

export function activate(context: vscode.ExtensionContext): void {
  const controller = vscode.tests.createTestController('testudio', 'Testudio++');
  const output = vscode.window.createOutputChannel('Testudio++');
  const tree = new TestTree(controller);

  let timer: NodeJS.Timeout | undefined;
  let watcher: vscode.FileSystemWatcher | undefined;
  let buildWatcher: vscode.FileSystemWatcher | undefined;

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
    if (buildWatcher !== undefined) {
      buildWatcher.dispose();
      buildWatcher = undefined;
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

    const buildPattern = new vscode.RelativePattern(
      settings.buildDir,
      '**/{CTestTestfile,*_tests,*_include}.cmake'
    );
    buildWatcher = vscode.workspace.createFileSystemWatcher(buildPattern);
    buildWatcher.onDidCreate(scheduleRefresh);
    buildWatcher.onDidChange(scheduleRefresh);
    buildWatcher.onDidDelete(scheduleRefresh);
  }

  controller.refreshHandler = function (): Promise<void> {
    return tree.refresh();
  };

  context.subscriptions.push(controller);
  context.subscriptions.push(output);
  context.subscriptions.push(
    vscode.commands.registerCommand('testudio.configure', function (): Promise<void> {
      return runConfigure(tree, output);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('testudio.configureAndBuild', function (): Promise<void> {
      return runConfigureAndBuild(tree, output);
    })
  );
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
      return runOpenCase(tree, item);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('testudio.deleteCase', function (item?: vscode.TestItem): Promise<void> {
      return runDeleteCase(tree, item);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('testudio.newCase', function (): void {
      CasePanel.showNew(context, tree);
    })
  );
  context.subscriptions.push(registerCaseEditor(context, tree));
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
      if (buildWatcher !== undefined) {
        buildWatcher.dispose();
      }
    }
  });

  resetWatcher();
  tree.refresh();
}

export function deactivate(): void {
  killAllProcesses();
}
