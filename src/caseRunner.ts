import { spawn } from 'child_process';
import { substituteDir } from './bytes';
import { TestCase } from './testCase';

export interface RunResult {
  passed: boolean;
  exitCode: number | null;
  stdout: Buffer;
  timedOut: boolean;
  message: string;
  durationMs: number;
}

function buildArgs(testCase: TestCase): string[] {
  const args: string[] = [];
  for (const arg of testCase.args) {
    args.push(arg.split('{dir}').join(testCase.folder));
  }
  return args;
}

function judge(exitCode: number, stdout: Buffer, expected: Buffer): { passed: boolean; message: string } {
  if (exitCode !== 0) {
    return { passed: false, message: 'код возврата ' + exitCode };
  }
  if (!stdout.equals(expected)) {
    return { passed: false, message: 'вывод не совпадает с эталоном' };
  }
  return { passed: true, message: '' };
}

export async function runCase(
  testCase: TestCase,
  executable: string,
  workDir: string,
  timeoutSeconds: number
): Promise<RunResult> {
  if (testCase.problem !== undefined) {
    return {
      passed: false,
      exitCode: null,
      stdout: Buffer.alloc(0),
      timedOut: false,
      message: testCase.problem,
      durationMs: 0
    };
  }

  const args = buildArgs(testCase);
  const expected = substituteDir(testCase.expected, testCase.folder);
  const startedAt = Date.now();

  return new Promise<RunResult>(function (resolve) {
    const chunks: Buffer[] = [];
    let finished = false;

    function finish(result: RunResult): void {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve(result);
    }

    const child = spawn(executable, args, {
      cwd: workDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timer = setTimeout(function () {
      child.kill('SIGKILL');
      finish({
        passed: false,
        exitCode: null,
        stdout: Buffer.concat(chunks),
        timedOut: true,
        message: 'превышено ' + timeoutSeconds + ' с',
        durationMs: Date.now() - startedAt
      });
    }, timeoutSeconds * 1000);

    child.stdout.on('data', function (chunk: Buffer) {
      if (!finished) {
        chunks.push(chunk);
      }
    });

    child.stderr.resume();

    child.on('error', function (error: NodeJS.ErrnoException) {
      const code = error.code === undefined ? error.message : error.code;
      finish({
        passed: false,
        exitCode: null,
        stdout: Buffer.concat(chunks),
        timedOut: false,
        message: 'не удалось запустить программу: ' + code,
        durationMs: Date.now() - startedAt
      });
    });

    child.on('close', function (code: number | null, signal: NodeJS.Signals | null) {
      const stdout = Buffer.concat(chunks);
      const durationMs = Date.now() - startedAt;
      if (signal !== null || code === null) {
        finish({
          passed: false,
          exitCode: null,
          stdout,
          timedOut: false,
          message: 'завершена сигналом ' + signal,
          durationMs
        });
        return;
      }
      const verdict = judge(code, stdout, expected);
      finish({
        passed: verdict.passed,
        exitCode: code,
        stdout,
        timedOut: false,
        message: verdict.message,
        durationMs
      });
    });
  });
}
