import * as fs from 'fs';
import * as path from 'path';

const FALLBACK_DIRS: string[] = ['/opt/homebrew/bin', '/usr/local/bin', '/Applications/CMake.app/Contents/bin'];

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    const info = await fs.promises.stat(filePath);
    if (!info.isFile()) {
      return false;
    }
    await fs.promises.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function isBareName(text: string): boolean {
  return !text.includes('/') && !text.includes(path.sep);
}

export async function findTool(name: string, configured: string | undefined): Promise<string> {
  let toolName = name;
  if (configured !== undefined) {
    if (!isBareName(configured)) {
      return configured;
    }
    toolName = configured;
  }
  const dirs: string[] = [];
  const pathText = process.env.PATH;
  if (pathText !== undefined) {
    for (const dir of pathText.split(path.delimiter)) {
      if (dir !== '') {
        dirs.push(dir);
      }
    }
  }
  for (const dir of FALLBACK_DIRS) {
    dirs.push(dir);
  }
  for (const dir of dirs) {
    const candidate = path.join(dir, toolName);
    if (await isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return toolName;
}

export function missingToolMessage(name: string, settingKey: string, configured: string | undefined): string {
  const places = FALLBACK_DIRS.join(', ');
  if (configured !== undefined && isBareName(configured)) {
    return name + ' не найден: имя «' + configured + '» из настройки ' + settingKey + ' не нашлось в PATH и в каталогах ' + places + '.';
  }
  if (configured !== undefined) {
    return name + ' не найден по пути из настройки ' + settingKey + ': ' + configured;
  }
  return name + ' не найден в PATH и в каталогах ' + places + '. Укажите путь к нему в настройке ' + settingKey + '.';
}
