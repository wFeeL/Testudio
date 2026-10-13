import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { isEditableText, restoreDir, substituteDir } from './bytes';
import { RunResult } from './caseRunner';
import { describeError } from './errors';
import { readSettings } from './settings';
import {
  CaseDraft,
  CaseFile,
  EXPECTED_FILE,
  TestCase,
  checkDraft,
  createCase,
  deleteCase,
  nextCaseNumber,
  renameCase,
  updateCase
} from './testCase';
import { TestTree, showLimited } from './testTree';

export interface CardText {
  text: string;
  simple: boolean;
}

export type CardMode = 'view' | 'edit' | 'create';
export type CardStatus = 'passed' | 'failed' | 'unknown';

export interface CardData {
  mode: CardMode;
  name: string;
  status: CardStatus;
  exitCode: number | null;
  message: string;
  args: string[];
  argsEditable: boolean;
  files: { name: string; content: CardText }[];
  expected: CardText;
  actual: CardText | undefined;
  canAccept: boolean;
}

interface PageFile {
  name: string;
  content: string;
}

interface PageDraft {
  name: string;
  args: string[] | undefined;
  expected: string | undefined;
  files: PageFile[];
}

interface PageMessage {
  type: string;
  draft?: PageDraft;
}

const ACCEPT_LABEL = 'Принять';
const DELETE_LABEL = 'Удалить';

function toCardText(data: Buffer): CardText {
  if (isEditableText(data)) {
    return { text: data.toString('utf8'), simple: true };
  }
  return { text: showLimited(data), simple: false };
}

export function buildCardData(testCase: TestCase, result: RunResult | undefined): CardData {
  const files: { name: string; content: CardText }[] = [];
  for (const file of testCase.inputFiles) {
    files.push({ name: file.name, content: toCardText(file.content) });
  }

  let status: CardStatus = 'unknown';
  let exitCode: number | null = null;
  let message = '';
  let actual: CardText | undefined;
  let canAccept = false;
  const expectedBytes = substituteDir(testCase.expected, testCase.folder);

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
    canAccept = result.exitCode !== null && !result.stdout.equals(expectedBytes);
  }

  return {
    mode: 'view',
    name: testCase.name,
    status: status,
    exitCode: exitCode,
    message: message,
    args: testCase.args,
    argsEditable: testCase.argsEditable,
    files: files,
    expected: toCardText(expectedBytes),
    actual: actual,
    canAccept: canAccept
  };
}

export function buildFormData(testCase: TestCase): CardData {
  const files: { name: string; content: CardText }[] = [];
  for (const file of testCase.inputFiles) {
    files.push({ name: file.name, content: toCardText(file.content) });
  }
  return {
    mode: 'edit',
    name: testCase.name,
    status: 'unknown',
    exitCode: null,
    message: '',
    args: testCase.args,
    argsEditable: testCase.argsEditable,
    files: files,
    expected: toCardText(testCase.expected),
    actual: undefined,
    canAccept: false
  };
}

export function buildNewData(name: string): CardData {
  return {
    mode: 'create',
    name: name,
    status: 'unknown',
    exitCode: null,
    message: '',
    args: [],
    argsEditable: true,
    files: [],
    expected: { text: '', simple: true },
    actual: undefined,
    canAccept: false
  };
}

export function buildDraft(page: PageDraft, original: TestCase | undefined): CaseDraft {
  const inputFiles: CaseFile[] = [];
  for (const file of page.files) {
    inputFiles.push({ name: file.name, content: Buffer.from(file.content, 'utf8') });
  }
  let expected: Buffer = Buffer.alloc(0);
  if (page.expected !== undefined) {
    expected = Buffer.from(page.expected, 'utf8');
  } else if (original !== undefined) {
    expected = original.expected;
  }
  let args: string[] = [];
  let keepArgs = false;
  if (page.args !== undefined) {
    args = page.args;
  } else if (original !== undefined) {
    args = original.args;
    keepArgs = true;
  }
  if (original !== undefined) {
    for (const file of original.inputFiles) {
      if (!isEditableText(file.content)) {
        inputFiles.push(file);
      }
    }
  }
  return { name: page.name, args: args, keepArgs: keepArgs, expected: expected, inputFiles: inputFiles };
}

function isValidPageDraft(page: PageDraft): boolean {
  if (typeof page !== 'object' || page === null) {
    return false;
  }
  if (typeof page.name !== 'string') {
    return false;
  }
  if (page.expected !== undefined && typeof page.expected !== 'string') {
    return false;
  }
  if (page.args !== undefined) {
    if (!Array.isArray(page.args)) {
      return false;
    }
    for (const arg of page.args) {
      if (typeof arg !== 'string') {
        return false;
      }
    }
  }
  if (!Array.isArray(page.files)) {
    return false;
  }
  for (const file of page.files) {
    if (typeof file !== 'object' || file === null) {
      return false;
    }
    if (typeof file.name !== 'string' || typeof file.content !== 'string') {
      return false;
    }
  }
  return true;
}

function knownCases(tree: TestTree): TestCase[] {
  const cases: TestCase[] = [];
  for (const name of tree.getCaseNames()) {
    const testCase = tree.getCase(name);
    if (testCase !== undefined) {
      cases.push(testCase);
    }
  }
  return cases;
}

function fillTemplate(template: string, key: string, value: string): string {
  return template.split('{{' + key + '}}').join(value);
}

export class CasePanel {
  private static panels: Map<string, CasePanel> = new Map<string, CasePanel>();
  private static creating: CasePanel | undefined;

  private panel: vscode.WebviewPanel;
  private tree: TestTree;
  private caseName: string;
  private mode: CardMode;

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
    const created = new CasePanel(context, tree, caseName, 'view');
    CasePanel.panels.set(caseName, created);
    CasePanel.attach(tree);
  }

  static showNew(context: vscode.ExtensionContext, tree: TestTree): void {
    if (CasePanel.creating !== undefined) {
      CasePanel.creating.panel.reveal();
      return;
    }
    const created = new CasePanel(context, tree, '', 'create');
    CasePanel.creating = created;
    CasePanel.attach(tree);
  }

  private static attach(tree: TestTree): void {
    tree.setResultListener(CasePanel.onResult);
    tree.setRefreshListener(CasePanel.onRefresh);
  }

  private static onResult(caseName: string): void {
    const target = CasePanel.panels.get(caseName);
    if (target !== undefined) {
      target.update();
    }
  }

  private static onRefresh(): void {
    for (const [, target] of CasePanel.panels) {
      target.update();
    }
  }

  private constructor(
    context: vscode.ExtensionContext,
    tree: TestTree,
    caseName: string,
    mode: CardMode
  ) {
    this.tree = tree;
    this.caseName = caseName;
    this.mode = mode;
    let title = 'Кейс ' + caseName;
    if (mode === 'create') {
      title = 'Новый кейс';
    }
    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('testudio.case', title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [mediaRoot]
    });
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
    if (CasePanel.creating === this) {
      CasePanel.creating = undefined;
    } else if (CasePanel.panels.get(this.caseName) === this) {
      CasePanel.panels.delete(this.caseName);
    }
    if (CasePanel.panels.size === 0 && CasePanel.creating === undefined) {
      this.tree.setResultListener(undefined);
      this.tree.setRefreshListener(undefined);
    }
  }

  private rekey(newName: string): void {
    CasePanel.panels.delete(this.caseName);
    this.caseName = newName;
    CasePanel.panels.set(newName, this);
    this.panel.title = 'Кейс ' + newName;
  }

  private update(): void {
    if (this.mode === 'view') {
      this.render();
    }
  }

  private render(): void {
    if (this.mode === 'create') {
      const name = nextCaseNumber(knownCases(this.tree)) + '_';
      this.panel.webview.postMessage({ type: 'show', data: buildNewData(name) });
      return;
    }
    const testCase = this.tree.getCase(this.caseName);
    if (testCase === undefined) {
      this.panel.dispose();
      return;
    }
    let data: CardData;
    if (this.mode === 'edit') {
      data = buildFormData(testCase);
    } else {
      data = buildCardData(testCase, this.tree.getLastResult(this.caseName));
    }
    this.panel.webview.postMessage({ type: 'show', data: data });
  }

  private showView(): void {
    this.mode = 'view';
    if (this.tree.getCase(this.caseName) !== undefined) {
      this.render();
    }
  }

  private sendError(text: string): void {
    this.panel.webview.postMessage({ type: 'error', text: text });
  }

  private async handleMessage(message: PageMessage): Promise<void> {
    try {
      if (message.type === 'ready') {
        this.render();
      } else if (message.type === 'run') {
        await this.runAgain();
      } else if (message.type === 'diff') {
        await this.showDiff();
      } else if (message.type === 'accept') {
        await this.acceptActual();
      } else if (message.type === 'edit') {
        this.mode = 'edit';
        this.render();
      } else if (message.type === 'cancel') {
        this.cancelForm();
      } else if (message.type === 'rename') {
        await this.renameThis();
      } else if (message.type === 'delete') {
        await this.deleteThis();
      } else if (message.type === 'save') {
        await this.saveForm(message.draft);
      }
    } catch (error) {
      const text = describeError(error);
      vscode.window.showErrorMessage('Карточка ' + this.caseName + ': ' + text);
      if (this.mode === 'view') {
        this.update();
      } else {
        this.sendError(text);
      }
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

  private cancelForm(): void {
    if (this.mode === 'create') {
      this.panel.dispose();
      return;
    }
    this.mode = 'view';
    this.render();
  }

  private async renameThis(): Promise<void> {
    const testCase = this.tree.getCase(this.caseName);
    if (testCase === undefined) {
      vscode.window.showWarningMessage('Кейс не найден, обновите дерево тестов.');
      return;
    }
    const existing = this.tree.getCaseNames();
    const oldName = testCase.name;
    const newName = await vscode.window.showInputBox({
      prompt: 'Новое имя кейса',
      value: oldName,
      validateInput: function (value: string): string | undefined {
        const draft: CaseDraft = {
          name: value,
          args: [],
          keepArgs: false,
          expected: Buffer.alloc(0),
          inputFiles: []
        };
        return checkDraft(draft, existing, oldName);
      }
    });
    if (newName === undefined || newName === oldName) {
      return;
    }
    await renameCase(testCase.folder, newName);
    this.rekey(newName);
    await this.tree.refresh();
    this.showView();
  }

  private async deleteThis(): Promise<void> {
    const testCase = this.tree.getCase(this.caseName);
    if (testCase === undefined) {
      vscode.window.showWarningMessage('Кейс не найден, обновите дерево тестов.');
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      'Удалить кейс ' + this.caseName + ' вместе со всеми его файлами?',
      { modal: true },
      DELETE_LABEL
    );
    if (choice !== DELETE_LABEL) {
      return;
    }
    await deleteCase(testCase.folder);
    await this.tree.refresh();
    this.panel.dispose();
  }

  private async saveForm(page: PageDraft | undefined): Promise<void> {
    if (page === undefined) {
      return;
    }
    if (this.mode !== 'edit' && this.mode !== 'create') {
      return;
    }
    if (!isValidPageDraft(page)) {
      this.sendError('Форма отправила неверные данные: закройте карточку и откройте её заново.');
      return;
    }
    let original: TestCase | undefined;
    if (this.mode === 'edit') {
      original = this.tree.getCase(this.caseName);
      if (original === undefined) {
        this.sendError('Кейс пропал из дерева: закройте карточку и обновите дерево тестов.');
        return;
      }
    }
    const draft = buildDraft(page, original);
    let originalName: string | undefined;
    if (original !== undefined) {
      originalName = original.name;
    }
    const problem = checkDraft(draft, this.tree.getCaseNames(), originalName);
    if (problem !== undefined) {
      this.sendError(problem);
      return;
    }

    try {
      if (original === undefined) {
        const settings = readSettings();
        if (settings === undefined) {
          throw new Error('откройте папку проекта');
        }
        await createCase(settings.testdataDir, draft);
        CasePanel.creating = undefined;
      } else {
        await updateCase(original, draft);
        this.tree.forgetResult(original.name);
      }
    } catch (error) {
      this.sendError('Не удалось записать: ' + describeError(error));
      return;
    }

    this.mode = 'view';
    this.rekey(draft.name);
    await this.tree.refresh();
    this.showView();
  }
}
