import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { isSimpleText, restoreDir, substituteDir } from './bytes';
import { RunResult } from './caseRunner';
import { TestCase } from './testCase';
import { SHOW_LIMIT, TestTree, showLimited } from './testTree';

export interface CardText {
  text: string;
  simple: boolean;
}

export interface CardData {
  mode: 'view' | 'edit' | 'create';
  name: string;
  status: 'passed' | 'failed' | 'unknown';
  exitCode: number | null;
  message: string;
  args: string[];
  files: { name: string; content: CardText }[];
  expected: CardText;
  actual: CardText | undefined;
}

interface PageMessage {
  type: string;
}

const EXPECTED_FILE = 'expected.txt';
const ACCEPT_LABEL = 'Принять';

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function toCardText(data: Buffer): CardText {
  if (data.length <= SHOW_LIMIT && isSimpleText(data)) {
    return { text: data.toString('utf8'), simple: true };
  }
  return { text: showLimited(data), simple: false };
}

export function buildCardData(testCase: TestCase, result: RunResult | undefined): CardData {
  const files: { name: string; content: CardText }[] = [];
  for (const file of testCase.inputFiles) {
    files.push({ name: file.name, content: toCardText(file.content) });
  }

  let status: CardData['status'] = 'unknown';
  let exitCode: number | null = null;
  let message = '';
  let actual: CardText | undefined;

  if (result === undefined) {
    if (testCase.problem !== undefined) {
      message = testCase.problem;
    }
  } else {
    if (result.passed) {
      status = 'passed';
    } else {
      status = 'failed';
    }
    exitCode = result.exitCode;
    message = result.message;
    actual = toCardText(result.stdout);
  }

  return {
    mode: 'view',
    name: testCase.name,
    status: status,
    exitCode: exitCode,
    message: message,
    args: testCase.args,
    files: files,
    expected: toCardText(substituteDir(testCase.expected, testCase.folder)),
    actual: actual
  };
}

function fillTemplate(template: string, key: string, value: string): string {
  return template.split('{{' + key + '}}').join(value);
}

export class CasePanel {
  private static panels: Map<string, CasePanel> = new Map<string, CasePanel>();

  private panel: vscode.WebviewPanel;
  private tree: TestTree;
  private caseName: string;

  static show(context: vscode.ExtensionContext, tree: TestTree, caseName: string): void {
    const existing = CasePanel.panels.get(caseName);
    if (existing !== undefined) {
      existing.panel.reveal();
      existing.update();
      return;
    }
    if (tree.getCase(caseName) === undefined) {
      vscode.window.showErrorMessage('Кейс ' + caseName + ' не найден, обновите дерево тестов.');
      return;
    }
    const created = new CasePanel(context, tree, caseName);
    CasePanel.panels.set(caseName, created);
    tree.setResultListener(CasePanel.onResult);
  }

  private static onResult(caseName: string): void {
    const target = CasePanel.panels.get(caseName);
    if (target !== undefined) {
      target.update();
    }
  }

  private constructor(context: vscode.ExtensionContext, tree: TestTree, caseName: string) {
    this.tree = tree;
    this.caseName = caseName;
    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel(
      'testudio.case',
      'Кейс ' + caseName,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [mediaRoot]
      }
    );
    this.panel.webview.html = this.buildHtml(mediaRoot);
    this.panel.webview.onDidReceiveMessage((message: PageMessage): Promise<void> => this.handleMessage(message));
    this.panel.onDidDispose(() => this.onDispose());
  }

  private buildHtml(mediaRoot: vscode.Uri): string {
    const webview = this.panel.webview;
    const template = readFileSync(vscode.Uri.joinPath(mediaRoot, 'card.html').fsPath, 'utf8');
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'card.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'card.js'));
    const nonce = randomBytes(16).toString('hex');
    let html = template;
    html = fillTemplate(html, 'cspSource', webview.cspSource);
    html = fillTemplate(html, 'nonce', nonce);
    html = fillTemplate(html, 'styleUri', styleUri.toString());
    html = fillTemplate(html, 'scriptUri', scriptUri.toString());
    return html;
  }

  private onDispose(): void {
    CasePanel.panels.delete(this.caseName);
    if (CasePanel.panels.size === 0) {
      this.tree.setResultListener(undefined);
    }
  }

  private update(): void {
    const testCase = this.tree.getCase(this.caseName);
    if (testCase === undefined) {
      this.panel.dispose();
      return;
    }
    const data = buildCardData(testCase, this.tree.getLastResult(this.caseName));
    this.panel.webview.postMessage({ type: 'show', data: data });
  }

  private async handleMessage(message: PageMessage): Promise<void> {
    try {
      if (message.type === 'ready') {
        this.update();
      } else if (message.type === 'run') {
        await this.runAgain();
      } else if (message.type === 'diff') {
        await this.showDiff();
      } else if (message.type === 'accept') {
        await this.acceptActual();
      }
    } catch (error) {
      vscode.window.showErrorMessage('Карточка ' + this.caseName + ': ' + describeError(error));
      this.update();
    }
  }

  private async runAgain(): Promise<void> {
    await this.tree.runCases([this.caseName]);
    this.update();
  }

  private async showDiff(): Promise<void> {
    const testCase = this.tree.getCase(this.caseName);
    const result = this.tree.getLastResult(this.caseName);
    if (testCase === undefined || result === undefined) {
      vscode.window.showWarningMessage('Сначала запустите кейс: сравнивать пока не с чем.');
      return;
    }
    const tempDir = path.join(os.tmpdir(), 'testudio');
    await fs.mkdir(tempDir, { recursive: true });
    const actualPath = path.join(tempDir, this.caseName + '.actual.txt');
    await fs.writeFile(actualPath, restoreDir(result.stdout, testCase.folder));
    const expectedUri = vscode.Uri.file(path.join(testCase.folder, EXPECTED_FILE));
    const actualUri = vscode.Uri.file(actualPath);
    await vscode.commands.executeCommand(
      'vscode.diff',
      expectedUri,
      actualUri,
      this.caseName + ': ожидалось и получено'
    );
  }

  private async acceptActual(): Promise<void> {
    const testCase = this.tree.getCase(this.caseName);
    const result = this.tree.getLastResult(this.caseName);
    if (testCase === undefined || result === undefined) {
      vscode.window.showWarningMessage('Сначала запустите кейс: принимать пока нечего.');
      return;
    }
    if (result.exitCode === null) {
      vscode.window.showWarningMessage('Программа не завершилась, её вывод неполный: принять его нельзя.');
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      'Заменить ' + EXPECTED_FILE + ' кейса ' + this.caseName + ' фактическим выводом программы?',
      { modal: true },
      ACCEPT_LABEL
    );
    if (choice !== ACCEPT_LABEL) {
      return;
    }
    await fs.writeFile(path.join(testCase.folder, EXPECTED_FILE), restoreDir(result.stdout, testCase.folder));
    await this.tree.refresh();
    await this.tree.runCases([this.caseName]);
    this.update();
  }
}
