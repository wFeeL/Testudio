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

export async function findTool(name: string, configured: string | undefined): Promise<string> {
  if (configured !== undefined) {
    return configured;
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
    const candidate = path.join(dir, name);
    if (await isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return name;
}

export function missingToolMessage(name: string, settingKey: string, configured: string | undefined): string {
  if (configured !== undefined) {
    return name + ' не найден по пути из настройки ' + settingKey + ': ' + configured;
  }
  const places = FALLBACK_DIRS.join(', ');
  return name + ' не найден в PATH и в каталогах ' + places + '. Укажите путь к нему в настройке ' + settingKey + '.';
}
