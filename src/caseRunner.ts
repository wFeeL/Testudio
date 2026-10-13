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

function makeResult(durationMs: number, stdout: Buffer, message: string): RunResult {
  return {
    passed: false,
    exitCode: null,
    stdout: stdout,
    timedOut: false,
    message: message,
    durationMs: durationMs
  };
}

function describeSpawnError(error: NodeJS.ErrnoException): string {
  if (error.code === 'EACCES') {
    return 'не удалось запустить программу: у файла нет права на запуск';
  }
  const code = error.code === undefined ? error.message : error.code;
  return 'не удалось запустить программу: ' + code;
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
    return makeResult(0, Buffer.alloc(0), testCase.problem);
  }

  const args = buildArgs(testCase);
  const expected = substituteDir(testCase.expected, testCase.folder);
  const startedAt = Date.now();

  return new Promise<RunResult>(function (resolve) {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let finished = false;

    let child: ChildProcessByStdio<null, Readable, null>;
    try {
      child = spawn(executable, args, {
        cwd: workDir,
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore']
      });
    } catch (error) {
      const message = describeSpawnError(error as NodeJS.ErrnoException);
      resolve(makeResult(Date.now() - startedAt, Buffer.alloc(0), message));
      return;
    }

    const timer = setTimeout(function () {
      killProcessTree(child);
      const result = makeResult(Date.now() - startedAt, Buffer.concat(chunks), 'превышено ' + timeoutSeconds + ' с');
      result.timedOut = true;
      finish(result);
    }, timeoutSeconds * 1000);

    function finish(result: RunResult): void {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve(result);
    }

    child.stdout.on('data', function (chunk: Buffer) {
      if (finished) {
        return;
      }
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_OUTPUT_BYTES) {
        killProcessTree(child);
        const limitMb = Math.floor(MAX_OUTPUT_BYTES / (1024 * 1024));
        finish(makeResult(Date.now() - startedAt, Buffer.concat(chunks), 'вывод больше ' + limitMb + ' МБ'));
        return;
      }
      chunks.push(chunk);
    });

    child.on('error', function (error: NodeJS.ErrnoException) {
      finish(makeResult(Date.now() - startedAt, Buffer.concat(chunks), describeSpawnError(error)));
    });

    child.on('close', function (code: number | null, signal: NodeJS.Signals | null) {
      const stdout = Buffer.concat(chunks);
      const durationMs = Date.now() - startedAt;
      if (code === null) {
        finish(makeResult(durationMs, stdout, 'завершена сигналом ' + signal));
        return;
      }
      const verdict = judge(code, stdout, expected);
      finish({
        passed: verdict.passed,
        exitCode: code,
        stdout: stdout,
        timedOut: false,
        message: verdict.message,
        durationMs: durationMs
      });
    });
  });
}
