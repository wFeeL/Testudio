import { Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface CaseFile {
  name: string;
  content: Buffer;
}

export interface TestCase {
  name: string;
  folder: string;
  args: string[];
  expected: Buffer;
  inputFiles: CaseFile[];
  problem: string | undefined;
}

const ARGS_FILE = 'args.txt';
const EXPECTED_FILE = 'expected.txt';

export function isValidCaseName(name: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(name);
}

export function parseArgs(text: string): string[] {
  const args: string[] = [];
  for (const line of text.split('\n')) {
    const arg = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (arg !== '') {
      args.push(arg);
    }
  }
  return args;
}

export function formatArgs(args: string[]): string {
  let text = '';
  for (const arg of args) {
    text += arg + '\n';
  }
  return text;
}

function compareNames(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

export async function readCase(folder: string): Promise<TestCase> {
  const name = path.basename(folder);
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const fileNames: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      fileNames.push(entry.name);
    }
  }
  fileNames.sort(compareNames);

  let problem: string | undefined;
  let args: string[] = [];
  let expected = Buffer.alloc(0);
  const inputFiles: CaseFile[] = [];

  if (fileNames.includes(ARGS_FILE)) {
    const text = await fs.readFile(path.join(folder, ARGS_FILE), 'utf8');
    args = parseArgs(text);
  } else {
    problem = 'нет args.txt';
  }

  if (fileNames.includes(EXPECTED_FILE)) {
    expected = await fs.readFile(path.join(folder, EXPECTED_FILE));
  } else if (problem === undefined) {
    problem = 'нет expected.txt';
  }

  if (problem === undefined && !isValidCaseName(name)) {
    problem = 'недопустимое имя: только буквы, цифры и _';
  }

  for (const fileName of fileNames) {
    if (fileName === ARGS_FILE || fileName === EXPECTED_FILE) {
      continue;
    }
    const content = await fs.readFile(path.join(folder, fileName));
    inputFiles.push({ name: fileName, content });
  }

  return { name, folder, args, expected, inputFiles, problem };
}

export async function listCases(testdataDir: string): Promise<TestCase[]> {
  const root = path.resolve(testdataDir);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      names.push(entry.name);
    }
  }
  names.sort(compareNames);
  const cases: TestCase[] = [];
  for (const name of names) {
    cases.push(await readCase(path.join(root, name)));
  }
  return cases;
}

export function nextCaseNumber(cases: TestCase[]): string {
  let max = 0;
  for (const testCase of cases) {
    const match = /^(\d+)_/.exec(testCase.name);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return String(max + 1).padStart(2, '0');
}
