import * as vscode from 'vscode';

const CASE_SCHEME = 'testudio-case';
export const CASE_VIEW_TYPE = 'testudio.caseCard';
const CASE_SUFFIX = '.testudiocase';

export function caseUri(name: string): vscode.Uri {
  return vscode.Uri.from({ scheme: CASE_SCHEME, path: '/' + name + CASE_SUFFIX });
}

export function caseNameFromUri(uri: vscode.Uri): string | undefined {
  if (uri.scheme !== CASE_SCHEME) {
    return undefined;
  }
  if (!uri.path.startsWith('/') || !uri.path.endsWith(CASE_SUFFIX)) {
    return undefined;
  }
  const name = uri.path.slice(1, uri.path.length - CASE_SUFFIX.length);
  if (name === '') {
    return undefined;
  }
  return name;
}
