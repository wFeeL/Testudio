import { ChildProcess } from 'child_process';

const liveProcesses = new Set<ChildProcess>();

export function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

export function trackProcess(child: ChildProcess): void {
  liveProcesses.add(child);
  child.on('close', function () {
    liveProcesses.delete(child);
  });
  child.on('error', function () {
    liveProcesses.delete(child);
  });
}

export function killAllProcesses(): void {
  for (const child of liveProcesses) {
    killProcessTree(child);
  }
  liveProcesses.clear();
}
