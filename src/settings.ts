import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface Settings {
  workspaceRoot: string;
  testdataDir: string;
  buildDir: string;
  executablePath: string | undefined;
  timeoutSeconds: number;
}

const DEFAULT_TESTDATA = 'tests/testdata';
const DEFAULT_BUILD = 'build';
const DEFAULT_TIMEOUT = 10;

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
  return {
    workspaceRoot: workspaceRoot,
    testdataDir: path.resolve(workspaceRoot, testdataPath),
    buildDir: path.resolve(workspaceRoot, buildDirectory),
    executablePath: executablePath,
    timeoutSeconds: timeoutSeconds
  };
}

export async function chooseExecutable(): Promise<string | undefined> {
  const workspaceRoot = getWorkspaceRoot();
  if (workspaceRoot === undefined) {
    return undefined;
  }
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
  const chosen = picked[0].fsPath;
  let stored = chosen;
  if (isInside(workspaceRoot, chosen)) {
    stored = path.relative(workspaceRoot, chosen);
  }
  const config = vscode.workspace.getConfiguration('testudio');
  await config.update('executablePath', stored, vscode.ConfigurationTarget.Workspace);
  return chosen;
}

export async function ensureExecutable(settings: Settings): Promise<string | undefined> {
  if (settings.executablePath !== undefined && fs.existsSync(settings.executablePath)) {
    return settings.executablePath;
  }
  return chooseExecutable();
}
