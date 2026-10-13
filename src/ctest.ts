import { spawn } from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { killProcessTree, trackProcess } from './processes';

export interface CommandResult {
  exitCode: number | null;
  output: string;
  missing: boolean;
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutSeconds: number,
  token?: vscode.CancellationToken
): Promise<CommandResult> {
  return new Promise<CommandResult>(function (resolve) {
    const chunks: Buffer[] = [];
    let finished = false;

    function finish(result: CommandResult): void {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      if (cancelListener !== undefined) {
        cancelListener.dispose();
      }
      resolve(result);
    }

    const child = spawn(command, args, {
      cwd: cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    trackProcess(child);

    let cancelListener: vscode.Disposable | undefined;
    if (token !== undefined) {
      cancelListener = token.onCancellationRequested(function () {
        killProcessTree(child);
        const output = Buffer.concat(chunks).toString('utf8');
        finish({ exitCode: null, output: output + '\nпрогон отменён', missing: false });
      });
    }

    const timer = setTimeout(function () {
      killProcessTree(child);
      const output = Buffer.concat(chunks).toString('utf8');
      finish({ exitCode: null, output: output + '\nпревышено ' + timeoutSeconds + ' с', missing: false });
    }, timeoutSeconds * 1000);

    child.stdout.on('data', function (chunk: Buffer) {
      if (!finished) {
        chunks.push(chunk);
      }
    });

    child.stderr.on('data', function (chunk: Buffer) {
      if (!finished) {
        chunks.push(chunk);
      }
    });

    child.on('error', function (error: NodeJS.ErrnoException) {
      const missing = error.code === 'ENOENT';
      const output = Buffer.concat(chunks).toString('utf8');
      finish({ exitCode: null, output: output + error.message, missing: missing });
    });

    child.on('close', function (code: number | null) {
      const output = Buffer.concat(chunks).toString('utf8');
      finish({ exitCode: code, output: output, missing: false });
    });
  });
}

export async function listCtestTests(buildDir: string, ctestCommand: string): Promise<string[] | undefined> {
  if (!fs.existsSync(buildDir)) {
    return undefined;
  }
  const result = await runCommand(ctestCommand, ['--test-dir', buildDir, '--show-only=json-v1'], buildDir, 60);
  if (result.missing || result.exitCode !== 0) {
    return undefined;
  }
  try {
    const data = JSON.parse(result.output);
    const names: string[] = [];
    for (const test of data.tests) {
      names.push(String(test.name));
    }
    return names;
  } catch {
    return undefined;
  }
}

const PARAM_COMMENT = '  # ';

export function stripCtestComment(testName: string): string {
  const index = testName.indexOf(PARAM_COMMENT);
  if (index < 0) {
    return testName;
  }
  return testName.slice(0, index);
}

export function caseNameFromCtest(testName: string): string | undefined {
  const shortName = stripCtestComment(testName);
  const slash = shortName.lastIndexOf('/');
  if (slash < 0) {
    return undefined;
  }
  return shortName.slice(slash + 1);
}

function prefixFromCtest(testName: string): string {
  const shortName = stripCtestComment(testName);
  return shortName.slice(0, shortName.lastIndexOf('/'));
}

export function splitCtestTests(testNames: string[], caseNames: string[]): string[] {
  const known = new Set<string>(caseNames);
  const prefixes = new Set<string>();

  for (const testName of testNames) {
    const caseName = caseNameFromCtest(testName);
    if (caseName !== undefined && known.has(caseName)) {
      prefixes.add(prefixFromCtest(testName));
    }
  }

  const cppTests: string[] = [];
  for (const testName of testNames) {
    const caseName = caseNameFromCtest(testName);
    if (caseName === undefined || !prefixes.has(prefixFromCtest(testName))) {
      cppTests.push(testName);
    }
  }
  return cppTests;
}

export function suiteNameFromCtest(testName: string): string {
  const shortName = stripCtestComment(testName);
  const dot = shortName.indexOf('.');
  if (dot < 0) {
    return shortName;
  }
  return shortName.slice(0, dot);
}

export function escapeRegex(text: string): string {
  return text.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}

export async function runCtestTest(
  ctestCommand: string,
  buildDir: string,
  testName: string,
  timeoutSeconds: number,
  token: vscode.CancellationToken
): Promise<CommandResult> {
  if (!fs.existsSync(buildDir)) {
    return { exitCode: null, output: 'каталог сборки не найден: ' + buildDir, missing: false };
  }
  const args = [
    '--test-dir',
    buildDir,
    '-R',
    '^' + escapeRegex(testName) + '$',
    '--output-on-failure',
    '--timeout',
    String(timeoutSeconds)
  ];
  return runCommand(ctestCommand, args, buildDir, timeoutSeconds + 30, token);
}

export async function buildProject(cmakeCommand: string, buildDir: string): Promise<CommandResult> {
  if (!fs.existsSync(buildDir)) {
    return { exitCode: null, output: 'каталог сборки не найден: ' + buildDir, missing: false };
  }
  return runCommand(cmakeCommand, ['--build', buildDir], buildDir, 600);
}
