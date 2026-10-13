import * as vscode from 'vscode';
import { SHOW_LIMIT, showBytes, substituteDir } from './bytes';
import { RunResult, runCase } from './caseRunner';
import { caseUri } from './caseUri';
import {
  listCtestTests,
  runCtestTest,
  splitCtestTests,
  stripCtestComment,
  suiteNameFromCtest
} from './ctest';
import { describeError } from './errors';
import { ensureExecutable, readSettings, Settings } from './settings';
import { TestCase, listCases } from './testCase';

export type ResultListener = (caseName: string, result: RunResult) => void;
export type RefreshListener = () => void;

const GROUP_DATA_ID = 'group:data';
const GROUP_CPP_ID = 'group:cpp';
export const CASE_PREFIX = 'case:';
const CPP_PREFIX = 'cpp:';
const SUITE_PREFIX = 'suite:';

export function showLimited(data: Buffer): string {
  if (data.length <= SHOW_LIMIT) {
    return showBytes(data);
  }
  const note = '\n[показано ' + SHOW_LIMIT + ' из ' + data.length + ' байт]';
  return showBytes(data.subarray(0, SHOW_LIMIT)) + note;
}

function toTerminal(text: string): string {
  return text.split('\n').join('\r\n');
}

function testLabel(testName: string, suiteName: string): string {
  const prefix = suiteName + '.';
  if (testName.startsWith(prefix)) {
    return testName.slice(prefix.length);
  }
  return testName;
}

function isRunnable(id: string): boolean {
  return id.startsWith(CASE_PREFIX) || id.startsWith(CPP_PREFIX);
}

function collectLeaves(item: vscode.TestItem, excluded: Set<string>, leaves: vscode.TestItem[]): void {
  if (excluded.has(item.id)) {
    return;
  }
  if (isRunnable(item.id)) {
    leaves.push(item);
    return;
  }
  for (const [, child] of item.children) {
    collectLeaves(child, excluded, leaves);
  }
}

export class TestTree {
  private controller: vscode.TestController;
  private runProfile: vscode.TestRunProfile;
  private cases: Map<string, TestCase> = new Map<string, TestCase>();
  private caseItems: Map<string, vscode.TestItem> = new Map<string, vscode.TestItem>();
  private results: Map<string, RunResult> = new Map<string, RunResult>();
  private listener: ResultListener | undefined;
  private refreshListener: RefreshListener | undefined;
  private ctestMessageShown: boolean = false;
  private refreshRunning: Promise<void> | undefined;
  private refreshQueued: boolean = false;

  constructor(controller: vscode.TestController) {
    this.controller = controller;
    this.runProfile = controller.createRunProfile(
      'Запуск',
      vscode.TestRunProfileKind.Run,
      (request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> =>
        this.runRequest(request, token),
      true
    );
  }

  refresh(): Promise<void> {
    if (this.refreshRunning !== undefined) {
      this.refreshQueued = true;
      return this.refreshRunning;
    }
    this.refreshRunning = this.refreshUntilQuiet();
    return this.refreshRunning;
  }

  private async refreshUntilQuiet(): Promise<void> {
    try {
      do {
        this.refreshQueued = false;
        await this.refreshOnce();
      } while (this.refreshQueued);
    } finally {
      this.refreshRunning = undefined;
    }
  }

  private async refreshOnce(): Promise<void> {
    const settings = readSettings();
    if (settings === undefined) {
      return;
    }

    let cases: TestCase[];
    try {
      cases = await listCases(settings.testdataDir);
    } catch (error) {
      vscode.window.showErrorMessage('Не удалось прочитать кейсы: ' + describeError(error));
      return;
    }
    const ctestNames = await listCtestTests(settings.buildDir);

    const caseNames: string[] = [];
    for (const testCase of cases) {
      caseNames.push(testCase.name);
    }

    let cppTests: string[] = [];
    if (ctestNames !== undefined) {
      cppTests = splitCtestTests(ctestNames, caseNames);
    } else {
      this.warnCtestUnavailable();
    }

    this.cases.clear();
    this.caseItems.clear();
    const dataGroup = this.controller.createTestItem(GROUP_DATA_ID, 'Кейсы testdata');

    for (const testCase of cases) {
      this.cases.set(testCase.name, testCase);
      const item = this.controller.createTestItem(
        CASE_PREFIX + testCase.name,
        testCase.name,
        caseUri(testCase.name)
      );
      if (testCase.problem !== undefined) {
        item.description = testCase.problem;
      }
      dataGroup.children.add(item);
      this.caseItems.set(testCase.name, item);
    }

    for (const name of this.results.keys()) {
      if (!this.cases.has(name)) {
        this.results.delete(name);
      }
    }

    const groups: vscode.TestItem[] = [dataGroup];
    if (ctestNames !== undefined) {
      groups.push(this.buildCppGroup(cppTests));
    }
    this.controller.items.replace(groups);

    if (this.refreshListener !== undefined) {
      this.refreshListener();
    }
  }

  getCase(name: string): TestCase | undefined {
    return this.cases.get(name);
  }

  getCaseNames(): string[] {
    const names: string[] = [];
    for (const name of this.cases.keys()) {
      names.push(name);
    }
    return names;
  }

  async runCases(names: string[]): Promise<void> {
    const items: vscode.TestItem[] = [];
    for (const name of names) {
      const item = this.caseItems.get(name);
      if (item !== undefined) {
        items.push(item);
      }
    }
    if (items.length === 0) {
      return;
    }
    const request = new vscode.TestRunRequest(items, undefined, this.runProfile);
    const source = new vscode.CancellationTokenSource();
    try {
      await this.runRequest(request, source.token);
    } finally {
      source.dispose();
    }
  }

  setResultListener(listener: ResultListener | undefined): void {
    this.listener = listener;
  }

  setRefreshListener(listener: RefreshListener | undefined): void {
    this.refreshListener = listener;
  }

  getLastResult(name: string): RunResult | undefined {
    return this.results.get(name);
  }

  forgetResult(name: string): void {
    this.results.delete(name);
  }

  private warnCtestUnavailable(): void {
    if (this.ctestMessageShown) {
      return;
    }
    this.ctestMessageShown = true;
    vscode.window.showWarningMessage('ctest недоступен или проект не собран');
  }

  private buildCppGroup(cppTests: string[]): vscode.TestItem {
    const group = this.controller.createTestItem(GROUP_CPP_ID, 'Тесты C++');
    const suites = new Map<string, vscode.TestItem>();
    for (const testName of cppTests) {
      const suiteName = suiteNameFromCtest(testName);
      let suiteItem = suites.get(suiteName);
      if (suiteItem === undefined) {
        suiteItem = this.controller.createTestItem(SUITE_PREFIX + suiteName, suiteName);
        suites.set(suiteName, suiteItem);
        group.children.add(suiteItem);
      }
      const label = testLabel(stripCtestComment(testName), suiteName);
      suiteItem.children.add(this.controller.createTestItem(CPP_PREFIX + testName, label));
    }
    return group;
  }

  private async runRequest(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
    const settings = readSettings();
    if (settings === undefined) {
      return;
    }

    const excluded = new Set<string>();
    if (request.exclude !== undefined) {
      for (const item of request.exclude) {
        excluded.add(item.id);
      }
    }

    const leaves: vscode.TestItem[] = [];
    if (request.include !== undefined) {
      for (const item of request.include) {
        collectLeaves(item, excluded, leaves);
      }
    } else {
      for (const [, item] of this.controller.items) {
        collectLeaves(item, excluded, leaves);
      }
    }

    const run = this.controller.createTestRun(request);
    try {
      for (const item of leaves) {
        run.enqueued(item);
      }

      let hasCases = false;
      for (const item of leaves) {
        if (item.id.startsWith(CASE_PREFIX)) {
          hasCases = true;
        }
      }
      let executable: string | undefined;
      if (hasCases) {
        executable = await ensureExecutable(settings);
      }

      for (const item of leaves) {
        if (token.isCancellationRequested) {
          run.skipped(item);
          continue;
        }
        run.started(item);
        try {
          await this.runLeaf(item, run, settings, executable);
        } catch (error) {
          run.errored(item, new vscode.TestMessage(describeError(error)));
        }
      }
    } finally {
      run.end();
    }
  }

  private async runLeaf(
    item: vscode.TestItem,
    run: vscode.TestRun,
    settings: Settings,
    executable: string | undefined
  ): Promise<void> {
    if (item.id.startsWith(CASE_PREFIX)) {
      await this.runDataCase(item, run, settings, executable);
    } else {
      await this.runCppTest(item, run, settings);
    }
  }

  private async runDataCase(
    item: vscode.TestItem,
    run: vscode.TestRun,
    settings: Settings,
    executable: string | undefined
  ): Promise<void> {
    const name = item.id.slice(CASE_PREFIX.length);
    const testCase = this.cases.get(name);
    if (testCase === undefined) {
      run.errored(item, new vscode.TestMessage('кейс не найден, обновите дерево'));
      return;
    }
    if (testCase.problem !== undefined) {
      run.errored(item, new vscode.TestMessage(testCase.problem));
      return;
    }
    if (executable === undefined) {
      run.errored(item, new vscode.TestMessage('тестируемая программа не выбрана'));
      return;
    }

    const result = await runCase(testCase, executable, settings.workspaceRoot, settings.timeoutSeconds);
    this.results.set(name, result);

    if (result.passed) {
      run.passed(item, result.durationMs);
    } else if (result.exitCode === null) {
      run.failed(item, new vscode.TestMessage(result.message), result.durationMs);
    } else {
      const expected = substituteDir(testCase.expected, testCase.folder);
      const message = vscode.TestMessage.diff(
        result.message,
        showLimited(expected),
        showLimited(result.stdout)
      );
      run.failed(item, message, result.durationMs);
    }

    if (this.listener !== undefined) {
      this.listener(name, result);
    }
  }

  private async runCppTest(item: vscode.TestItem, run: vscode.TestRun, settings: Settings): Promise<void> {
    const testName = item.id.slice(CPP_PREFIX.length);
    const startedAt = Date.now();
    const result = await runCtestTest(settings.buildDir, testName, settings.timeoutSeconds);
    const duration = Date.now() - startedAt;

    if (result.output !== '') {
      run.appendOutput(toTerminal(result.output), undefined, item);
    }

    if (result.missing) {
      run.errored(item, new vscode.TestMessage('ctest не найден в PATH'), duration);
    } else if (result.exitCode === null) {
      run.errored(item, new vscode.TestMessage(result.output), duration);
    } else if (result.exitCode === 0) {
      run.passed(item, duration);
    } else {
      const text = 'код возврата ctest ' + result.exitCode + '\n' + result.output;
      run.failed(item, new vscode.TestMessage(text), duration);
    }
  }
}
