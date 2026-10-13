import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { describeError } from './errors';

export interface Settings {
  workspaceRoot: string;
  testdataDir: string;
  buildDir: string;
  executablePath: string | undefined;
  cmakePath: string | undefined;
  ctestPath: string | undefined;
  timeoutSeconds: number;
}

const DEFAULT_TESTDATA = 'tests/testdata';
const DEFAULT_BUILD = 'build';
const DEFAULT_TIMEOUT = 10;
const CHOOSE_ANOTHER = 'Выбрать другой файл';

function readText(config: vscode.WorkspaceConfiguration, key: string, fallback: string): string {
  const value = config.get<string>(key, fallback).trim();
  if (value === '') {
    return fallback;
  }
  return value;
}

function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (folders === undefined || folders.length === 0) {
    return undefined;
  }
  return folders[0].uri.fsPath;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (relative === '' || path.isAbsolute(relative)) {
    return false;
  }
  if (relative === '..' || relative.startsWith('..' + path.sep)) {
    return false;
  }
  return true;
}

export function readSettings(): Settings | undefined {
  const workspaceRoot = getWorkspaceRoot();
  if (workspaceRoot === undefined) {
    return undefined;
  }
  const config = vscode.workspace.getConfiguration('testudio');
  const testdataPath = readText(config, 'testdataPath', DEFAULT_TESTDATA);
  const buildDirectory = readText(config, 'buildDirectory', DEFAULT_BUILD);
  const executableText = readText(config, 'executablePath', '');
  let timeoutSeconds = config.get<number>('timeoutSeconds', DEFAULT_TIMEOUT);
  if (timeoutSeconds < 1) {
    timeoutSeconds = DEFAULT_TIMEOUT;
  }
  let executablePath: string | undefined;
  if (executableText !== '') {
    executablePath = path.resolve(workspaceRoot, executableText);
  }
  const cmakeText = readText(config, 'cmakePath', '');
  let cmakePath: string | undefined;
  if (cmakeText !== '') {
    cmakePath = path.resolve(workspaceRoot, cmakeText);
  }
  const ctestText = readText(config, 'ctestPath', '');
  let ctestPath: string | undefined;
  if (ctestText !== '') {
    ctestPath = path.resolve(workspaceRoot, ctestText);
  }
  return {
    workspaceRoot: workspaceRoot,
    testdataDir: path.resolve(workspaceRoot, testdataPath),
    buildDir: path.resolve(workspaceRoot, buildDirectory),
    executablePath: executablePath,
    cmakePath: cmakePath,
    ctestPath: ctestPath,
    timeoutSeconds: timeoutSeconds
  };
}

async function checkExecutable(filePath: string): Promise<string | undefined> {
  let info: fs.Stats;
  try {
    info = await fs.promises.stat(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return 'Файл не найден: ' + filePath;
    }
    return 'Не удалось проверить файл ' + filePath + ': ' + describeError(error);
  }
  if (info.isDirectory()) {
    return 'Выбрана папка, а не программа: ' + filePath;
  }
  if (!info.isFile()) {
    return 'Выбран не обычный файл, а программа должна быть файлом: ' + filePath;
  }
  try {
    await fs.promises.access(filePath, fs.constants.X_OK);
  } catch {
    return 'У файла нет права на запуск: ' + filePath + '. Выдайте его командой chmod +x или выберите другой файл.';
  }
  return undefined;
}

async function askAnotherFile(problem: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(problem, { modal: true }, CHOOSE_ANOTHER);
  return choice === CHOOSE_ANOTHER;
}

export async function chooseExecutable(): Promise<string | undefined> {
  const workspaceRoot = getWorkspaceRoot();
  if (workspaceRoot === undefined) {
    return undefined;
  }
  let chosen: string | undefined;
  while (chosen === undefined) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(workspaceRoot),
      openLabel: 'Выбрать',
      title: 'Выберите тестируемую программу'
    });
    if (picked === undefined || picked.length === 0) {
      return undefined;
    }
    const problem = await checkExecutable(picked[0].fsPath);
    if (problem === undefined) {
      chosen = picked[0].fsPath;
    } else if (!(await askAnotherFile(problem))) {
      return undefined;
    }
  }
  let stored = chosen;
  if (isInside(workspaceRoot, chosen)) {
    stored = path.relative(workspaceRoot, chosen);
  }
  const config = vscode.workspace.getConfiguration('testudio');
  await config.update('executablePath', stored, vscode.ConfigurationTarget.Workspace);
  return chosen;
}

export async function ensureExecutable(settings: Settings): Promise<string | undefined> {
  const configured = settings.executablePath;
  if (configured !== undefined && fs.existsSync(configured)) {
    const problem = await checkExecutable(configured);
    if (problem === undefined) {
      return configured;
    }
    if (!(await askAnotherFile(problem))) {
      return undefined;
    }
  }
  return chooseExecutable();
}
