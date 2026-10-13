import * as vscode from 'vscode';
import { TestCase, deleteCase } from './testCase';

const DELETE_LABEL = 'Удалить';

export async function confirmAndDeleteCase(testCase: TestCase): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    'Удалить кейс ' + testCase.name + ' вместе со всеми его файлами?',
    { modal: true },
    DELETE_LABEL
  );
  if (choice !== DELETE_LABEL) {
    return false;
  }
  await deleteCase(testCase.folder);
  return true;
}
