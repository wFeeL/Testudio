import { Dirent, Stats } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { isEditableText } from './bytes';

export interface CaseFile {
  name: string;
  content: Buffer;
}

export interface TestCase {
  name: string;
  folder: string;
  args: string[];
  argsEditable: boolean;
  expected: Buffer;
  inputFiles: CaseFile[];
  problem: string | undefined;
}

const ARGS_FILE = 'args.txt';
export const EXPECTED_FILE = 'expected.txt';

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

function canEditArgs(raw: Buffer, args: string[]): boolean {
  if (raw.includes(0x00)) {
    return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return false;
  }
  for (const arg of args) {
    if (arg.includes('\r')) {
      return false;
    }
  }
  return true;
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
  const linkNames: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      fileNames.push(entry.name);
    } else if (entry.isSymbolicLink()) {
      linkNames.push(entry.name);
    }
  }
  fileNames.sort(compareNames);

  let problem: string | undefined;
  let args: string[] = [];
  let argsEditable = true;
  let expected = Buffer.alloc(0);
  const inputFiles: CaseFile[] = [];

  if (fileNames.includes(ARGS_FILE)) {
    const raw = await fs.readFile(path.join(folder, ARGS_FILE));
    args = parseArgs(raw.toString('utf8'));
    argsEditable = canEditArgs(raw, args);
  } else if (linkNames.includes(ARGS_FILE)) {
    problem = ARGS_FILE + ' это симлинк: симлинки не поддерживаются';
  } else {
    problem = 'нет args.txt';
  }

  if (fileNames.includes(EXPECTED_FILE)) {
    expected = await fs.readFile(path.join(folder, EXPECTED_FILE));
  } else if (problem === undefined) {
    if (linkNames.includes(EXPECTED_FILE)) {
      problem = EXPECTED_FILE + ' это симлинк: симлинки не поддерживаются';
    } else {
      problem = 'нет expected.txt';
    }
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

  return { name, folder, args, argsEditable, expected, inputFiles, problem };
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

export interface CaseDraft {
  name: string;
  args: string[];
  keepArgs: boolean;
  expected: Buffer;
  inputFiles: CaseFile[];
}

const NEW_FOLDER_PREFIX = '.testudio-new-';

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function checkFileName(name: string, taken: string[]): string | undefined {
  if (name === '') {
    return 'Имя входного файла не может быть пустым.';
  }
  if (name.includes('/') || name === '.' || name === '..') {
    return 'Недопустимое имя входного файла: ' + name;
  }
  if (name.includes('\0')) {
    return 'Имя входного файла не может содержать нулевой байт.';
  }
  if (Buffer.byteLength(name, 'utf8') > 255) {
    return 'Имя входного файла длиннее 255 байт.';
  }
  const key = name.toLowerCase();
  if (key === ARGS_FILE || key === EXPECTED_FILE) {
    return 'Имя ' + name + ' занято под служебный файл кейса.';
  }
  if (taken.includes(key)) {
    return 'Имя входного файла ' + name + ' повторяется.';
  }
  taken.push(key);
  return undefined;
}

export function checkDraft(
  draft: CaseDraft,
  existingNames: string[],
  originalName: string | undefined
): string | undefined {
  if (!isValidCaseName(draft.name)) {
    return 'Имя кейса: только латинские буквы, цифры и _, не пустое.';
  }
  if (draft.name !== originalName && existingNames.includes(draft.name)) {
    return 'Кейс ' + draft.name + ' уже есть.';
  }
  if (!draft.keepArgs) {
    for (const arg of draft.args) {
      if (arg === '') {
        return 'Пустой аргумент не допускается: уберите пустую строку.';
      }
      if (arg.includes('\n') || arg.includes('\r')) {
        return 'Аргумент не может содержать перевод строки.';
      }
    }
  }
  const taken: string[] = [];
  for (const file of draft.inputFiles) {
    const problem = checkFileName(file.name, taken);
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}

async function writeCaseFiles(folder: string, draft: CaseDraft): Promise<void> {
  await fs.writeFile(path.join(folder, ARGS_FILE), formatArgs(draft.args));
  await fs.writeFile(path.join(folder, EXPECTED_FILE), draft.expected);
  for (const file of draft.inputFiles) {
    await fs.writeFile(path.join(folder, file.name), file.content);
  }
}

export async function createCase(testdataDir: string, draft: CaseDraft): Promise<void> {
  const problem = checkDraft(draft, [], undefined);
  if (problem !== undefined) {
    throw new Error(problem);
  }
  const root = path.resolve(testdataDir);
  const target = path.join(root, draft.name);
  if (await pathExists(target)) {
    throw new Error('Кейс ' + draft.name + ' уже есть.');
  }
  const temp = path.join(path.dirname(root), NEW_FOLDER_PREFIX + draft.name);
  await fs.rm(temp, { recursive: true, force: true });
  try {
    await fs.mkdir(temp, { recursive: true });
    await writeCaseFiles(temp, draft);
    await fs.mkdir(root, { recursive: true });
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { recursive: true, force: true });
    throw error;
  }
}

function sameArgs(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function findFile(files: CaseFile[], name: string): CaseFile | undefined {
  for (const file of files) {
    if (file.name === name) {
      return file;
    }
  }
  return undefined;
}

async function lstatOrUndefined(target: string): Promise<Stats | undefined> {
  try {
    return await fs.lstat(target);
  } catch {
    return undefined;
  }
}

async function checkWritable(folder: string, names: string[]): Promise<void> {
  for (const name of names) {
    const info = await lstatOrUndefined(path.join(folder, name));
    if (info === undefined) {
      continue;
    }
    if (info.isSymbolicLink()) {
      throw new Error('Файл ' + name + ' в папке кейса является симлинком: запись отклонена.');
    }
    if (!info.isFile()) {
      throw new Error('Имя ' + name + ' занято каталогом внутри папки кейса.');
    }
  }
}

export async function updateCase(testCase: TestCase, draft: CaseDraft): Promise<string> {
  const problem = checkDraft(draft, [], testCase.name);
  if (problem !== undefined) {
    throw new Error(problem);
  }
  const renamed = draft.name !== testCase.name;
  if (renamed && (await pathExists(path.join(path.dirname(testCase.folder), draft.name)))) {
    throw new Error('Кейс ' + draft.name + ' уже есть.');
  }

  const everything = testCase.problem !== undefined;
  const writes: CaseFile[] = [];
  if (!draft.keepArgs && (everything || !sameArgs(draft.args, testCase.args))) {
    writes.push({ name: ARGS_FILE, content: Buffer.from(formatArgs(draft.args), 'utf8') });
  }
  if (everything || !draft.expected.equals(testCase.expected)) {
    writes.push({ name: EXPECTED_FILE, content: draft.expected });
  }
  for (const file of draft.inputFiles) {
    const old = findFile(testCase.inputFiles, file.name);
    if (old === undefined || !old.content.equals(file.content)) {
      writes.push(file);
    }
  }

  const draftKeys: string[] = [];
  for (const file of draft.inputFiles) {
    draftKeys.push(file.name.toLowerCase());
  }
  const removals: string[] = [];
  for (const old of testCase.inputFiles) {
    if (!draftKeys.includes(old.name.toLowerCase()) && isEditableText(old.content)) {
      removals.push(old.name);
    }
  }

  const writeNames: string[] = [];
  for (const file of writes) {
    writeNames.push(file.name);
  }
  await checkWritable(testCase.folder, writeNames);

  for (const file of writes) {
    await fs.writeFile(path.join(testCase.folder, file.name), file.content);
  }
  for (const name of removals) {
    await fs.rm(path.join(testCase.folder, name));
  }

  if (renamed) {
    return renameCase(testCase.folder, draft.name);
  }
  return testCase.folder;
}

export async function deleteCase(folder: string): Promise<void> {
  await fs.rm(folder, { recursive: true });
}

export async function renameCase(folder: string, newName: string): Promise<string> {
  if (!isValidCaseName(newName)) {
    throw new Error('Имя кейса: только латинские буквы, цифры и _, не пустое.');
  }
  const target = path.join(path.dirname(folder), newName);
  if (target === folder) {
    return folder;
  }
  if (await pathExists(target)) {
    throw new Error('Кейс ' + newName + ' уже есть.');
  }
  await fs.rename(folder, target);
  return target;
}
