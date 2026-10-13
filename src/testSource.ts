import * as fs from 'fs';
import * as path from 'path';

export interface TestSource {
  file: string;
  line: number;
}

const SOURCE_EXTENSIONS: string[] = ['.cpp', '.cc', '.cxx', '.h', '.hpp'];
const SKIPPED_DIRECTORIES: string[] = ['node_modules', '_deps'];
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1000000;
const TEST_LINE = /^\s*(TEST|TEST_F|TEST_P)\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/;

export function gtestNameFromCtest(shortName: string): string {
  const parts: string[] = shortName.split('/');
  for (const part of parts) {
    if (part.includes('.')) {
      return part;
    }
  }
  return shortName;
}

function isSkippedDirectory(name: string, fullPath: string, buildDir: string): boolean {
  if (name.startsWith('.')) {
    return true;
  }
  if (SKIPPED_DIRECTORIES.includes(name)) {
    return true;
  }
  return path.resolve(fullPath) === path.resolve(buildDir);
}

async function listSourceFiles(root: string, buildDir: string): Promise<string[]> {
  const files: string[] = [];
  const pending: string[] = [root];
  while (pending.length > 0 && files.length < MAX_FILES) {
    const directory = pending.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort(function (a: fs.Dirent, b: fs.Dirent): number {
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!isSkippedDirectory(entry.name, fullPath, buildDir)) {
          pending.push(fullPath);
        }
      } else if (entry.isFile() && SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }
  files.sort();
  return files.slice(0, MAX_FILES);
}

async function readSourceText(file: string): Promise<string | undefined> {
  try {
    const info = await fs.promises.stat(file);
    if (info.size > MAX_FILE_BYTES) {
      return undefined;
    }
    return await fs.promises.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

export async function findTestSources(root: string, buildDir: string): Promise<Map<string, TestSource>> {
  const sources = new Map<string, TestSource>();
  const files = await listSourceFiles(root, buildDir);
  for (const file of files) {
    const text = await readSourceText(file);
    if (text === undefined) {
      continue;
    }
    const lines: string[] = text.split('\n');
    for (let index = 0; index < lines.length; index++) {
      const match = TEST_LINE.exec(lines[index]);
      if (match === null) {
        continue;
      }
      const name = match[2] + '.' + match[3];
      if (!sources.has(name)) {
        sources.set(name, { file: file, line: index + 1 });
      }
    }
  }
  return sources;
}
