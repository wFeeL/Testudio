import { ChildProcess, ChildProcessByStdio, spawn } from 'child_process';
import { Readable } from 'stream';
import { substituteDir } from './bytes';
import { TestCase } from './testCase';

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

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

function spawnFailure(error: NodeJS.ErrnoException, stdout: Buffer, startedAt: number): RunResult {
  const code = error.code === undefined ? error.message : error.code;
  return {
    passed: false,
    exitCode: null,
    stdout: stdout,
    timedOut: false,
    message: 'не удалось запустить программу: ' + code,
    durationMs: Date.now() - startedAt
  };
}

function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
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
    let receivedBytes = 0;
    let finished = false;

    function finish(result: RunResult): void {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve(result);
    }

    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(executable, args, {
        cwd: workDir,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      resolve(spawnFailure(error as NodeJS.ErrnoException, Buffer.alloc(0), startedAt));
      return;
    }

    const timer = setTimeout(function () {
      killProcessTree(child);
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
      if (finished) {
        return;
      }
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_OUTPUT_BYTES) {
        killProcessTree(child);
        finish({
          passed: false,
          exitCode: null,
          stdout: Buffer.concat(chunks),
          timedOut: false,
          message: 'вывод больше ' + Math.floor(MAX_OUTPUT_BYTES / (1024 * 1024)) + ' МБ',
          durationMs: Date.now() - startedAt
        });
        return;
      }
      chunks.push(chunk);
    });

    child.stderr.resume();

    child.on('error', function (error: NodeJS.ErrnoException) {
      finish(spawnFailure(error, Buffer.concat(chunks), startedAt));
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
