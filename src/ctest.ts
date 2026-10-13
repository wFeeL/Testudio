import { spawn } from 'child_process';
import * as fs from 'fs';

export interface CommandResult {
  exitCode: number | null;
  output: string;
  missing: boolean;
}

export interface CtestSplit {
  caseTests: string[];
  missingCaseTests: string[];
  cppTests: string[];
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutSeconds: number
): Promise<CommandResult> {
  return new Promise<CommandResult>(function (resolve) {
    const chunks: Buffer[] = [];
    let finished = false;
    let timedOut = false;

    function finish(result: CommandResult): void {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve(result);
    }

    const child = spawn(command, args, {
      cwd: cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timer = setTimeout(function () {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutSeconds * 1000);

    child.stdout.on('data', function (chunk: Buffer) {
      chunks.push(chunk);
    });

    child.stderr.on('data', function (chunk: Buffer) {
      chunks.push(chunk);
    });

    child.on('error', function (error: NodeJS.ErrnoException) {
      const missing = error.code === 'ENOENT';
      const output = Buffer.concat(chunks).toString('utf8');
      finish({ exitCode: null, output: output + error.message, missing: missing });
    });

    child.on('close', function (code: number | null) {
      let output = Buffer.concat(chunks).toString('utf8');
      if (timedOut) {
        output = output + '\nпревышено ' + timeoutSeconds + ' с';
      }
      finish({ exitCode: code, output: output, missing: false });
    });
  });
}

export async function listCtestTests(buildDir: string): Promise<string[] | undefined> {
  if (!fs.existsSync(buildDir)) {
    return undefined;
  }
  const result = await runCommand('ctest', ['--test-dir', buildDir, '--show-only=json-v1'], buildDir, 60);
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

export function caseNameFromCtest(testName: string): string | undefined {
  const slash = testName.lastIndexOf('/');
  if (slash < 0) {
    return undefined;
  }
  return testName.slice(slash + 1);
}

export function splitCtestTests(testNames: string[], caseNames: string[]): CtestSplit {
  const known = new Set<string>(caseNames);
  const prefixes = new Set<string>();

  for (const testName of testNames) {
    const caseName = caseNameFromCtest(testName);
    if (caseName !== undefined && known.has(caseName)) {
      prefixes.add(testName.slice(0, testName.lastIndexOf('/')));
    }
  }

  const caseTests: string[] = [];
  const missingCaseTests: string[] = [];
  const cppTests: string[] = [];

  for (const testName of testNames) {
    const caseName = caseNameFromCtest(testName);
    if (caseName !== undefined && known.has(caseName)) {
      caseTests.push(testName);
    } else if (caseName !== undefined && prefixes.has(testName.slice(0, testName.lastIndexOf('/')))) {
      missingCaseTests.push(testName);
    } else {
      cppTests.push(testName);
    }
  }

  return { caseTests: caseTests, missingCaseTests: missingCaseTests, cppTests: cppTests };
}

export function suiteNameFromCtest(testName: string): string {
  const dot = testName.indexOf('.');
  if (dot < 0) {
    return testName;
  }
  return testName.slice(0, dot);
}

export function escapeRegex(text: string): string {
  return text.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}

export async function runCtestTest(
  buildDir: string,
  testName: string,
  timeoutSeconds: number
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
  return runCommand('ctest', args, buildDir, timeoutSeconds + 30);
}

export async function buildProject(buildDir: string): Promise<CommandResult> {
  if (!fs.existsSync(buildDir)) {
    return { exitCode: null, output: 'каталог сборки не найден: ' + buildDir, missing: false };
  }
  return runCommand('cmake', ['--build', buildDir], buildDir, 600);
}
