const vscode = acquireVsCodeApi();
const root = document.getElementById('root');

const STATUS_TEXT = {
  passed: 'Пройден',
  failed: 'Упал',
  unknown: 'Нет результата в этом сеансе'
};

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className !== '') {
    element.className = className;
  }
  if (text !== '') {
    element.textContent = text;
  }
  return element;
}

function makeButton(label, type) {
  const button = makeElement('button', 'button', label);
  button.addEventListener('click', function () {
    vscode.postMessage({ type: type });
  });
  return button;
}

function makeRunButton() {
  const button = makeElement('button', 'button', 'Запустить');
  button.addEventListener('click', function () {
    button.disabled = true;
    vscode.postMessage({ type: 'run' });
  });
  return button;
}

function makeHeader(data) {
  const section = makeElement('div', '', '');
  section.appendChild(makeElement('h1', '', data.name));

  const summary = makeElement('div', 'summary', '');
  summary.appendChild(makeElement('span', 'status status-' + data.status, STATUS_TEXT[data.status]));
  if (data.exitCode === null) {
    summary.appendChild(makeElement('span', 'muted', 'код возврата: нет'));
  } else {
    summary.appendChild(makeElement('span', '', 'код возврата: ' + data.exitCode));
  }
  section.appendChild(summary);

  if (data.message !== '') {
    section.appendChild(makeElement('div', 'message', data.message));
  }

  const buttons = makeElement('div', 'buttons', '');
  buttons.appendChild(makeRunButton());
  if (data.status === 'failed' && data.actual !== undefined) {
    buttons.appendChild(makeButton('Diff', 'diff'));
  }
  if (data.canAccept) {
    buttons.appendChild(makeButton('Принять фактический вывод', 'accept'));
  }
  buttons.appendChild(makeButton('Изменить', 'edit'));
  buttons.appendChild(makeButton('Переименовать', 'rename'));
  buttons.appendChild(makeButton('Удалить', 'delete'));
  section.appendChild(buttons);
  return section;
}

function makeArgs(args) {
  const section = makeElement('div', '', '');
  section.appendChild(makeElement('h2', '', 'Аргументы'));
  if (args.length === 0) {
    section.appendChild(makeElement('div', 'muted', 'нет аргументов'));
    return section;
  }
  const list = makeElement('ul', 'args', '');
  for (const arg of args) {
    const item = makeElement('li', '', '');
    item.appendChild(makeElement('code', '', arg));
    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}

function makeTextBlock(content) {
  const block = makeElement('div', '', '');
  if (!content.simple) {
    block.appendChild(makeElement('div', 'note', 'показано с видимыми \\0, \\r, \\xNN'));
  }
  if (content.text === '') {
    block.appendChild(makeElement('div', 'muted', 'пусто'));
    return block;
  }
  block.appendChild(makeElement('pre', 'code', content.text));
  return block;
}

function makeFiles(files) {
  const section = makeElement('div', '', '');
  section.appendChild(makeElement('h2', '', 'Входные файлы'));
  if (files.length === 0) {
    section.appendChild(makeElement('div', 'muted', 'нет входных файлов'));
    return section;
  }
  for (const file of files) {
    section.appendChild(makeElement('div', 'file-name', file.name));
    section.appendChild(makeTextBlock(file.content));
  }
  return section;
}

function makeColumn(title, content) {
  const column = makeElement('div', 'column', '');
  column.appendChild(makeElement('h2', '', title));
  if (content === undefined) {
    column.appendChild(makeElement('div', 'muted', 'нет результата в этом сеансе, запустите кейс'));
  } else {
    column.appendChild(makeTextBlock(content));
  }
  return column;
}

function makeOutputs(data) {
  const columns = makeElement('div', 'columns', '');
  columns.appendChild(makeColumn('Ожидаемый вывод', data.expected));
  columns.appendChild(makeColumn('Фактический вывод', data.actual));
  return columns;
}

function renderView(data) {
  root.textContent = '';
  root.appendChild(makeHeader(data));
  root.appendChild(makeArgs(data.args));
  root.appendChild(makeFiles(data.files));
  root.appendChild(makeOutputs(data));
}

let formError = null;
let saveButton = null;
let nameInput = null;
let argsArea = null;
let expectedArea = null;
let fileList = null;
let fileRows = [];

function makeInput(value) {
  const input = makeElement('input', 'field', '');
  input.type = 'text';
  input.value = value;
  return input;
}

function countRows(text) {
  const lines = text.split('\n').length;
  if (lines < 3) {
    return 3;
  }
  if (lines > 15) {
    return 15;
  }
  return lines;
}

function makeArea(value) {
  const area = makeElement('textarea', 'field area', '');
  area.rows = countRows(value);
  area.value = value;
  area.spellcheck = false;
  return area;
}

function makeReadOnly(content) {
  const block = makeElement('div', '', '');
  block.appendChild(makeElement('div', 'note', 'двоичный или с \\r, правка недоступна'));
  if (content.text === '') {
    block.appendChild(makeElement('div', 'muted', 'пусто'));
    return block;
  }
  block.appendChild(makeElement('pre', 'code', content.text));
  return block;
}

function showArgs(args) {
  const lines = [];
  for (const arg of args) {
    lines.push(arg.split('\r').join('\\r'));
  }
  return lines.join('\n');
}

function removeFileRow(row) {
  const kept = [];
  for (const other of fileRows) {
    if (other !== row) {
      kept.push(other);
    }
  }
  fileRows = kept;
  row.box.remove();
}

function addFileRow(name, content) {
  const box = makeElement('div', 'file-row', '');
  const fileNameInput = makeInput(name);
  fileNameInput.placeholder = 'имя файла';
  const area = makeArea(content);
  const row = { box: box, nameInput: fileNameInput, area: area };

  const remove = makeElement('button', 'button button-secondary', 'Убрать');
  remove.addEventListener('click', function () {
    removeFileRow(row);
  });

  const head = makeElement('div', 'file-head', '');
  head.appendChild(fileNameInput);
  head.appendChild(remove);
  box.appendChild(head);
  box.appendChild(area);
  fileList.appendChild(box);
  fileRows.push(row);
}

function splitArgs(text) {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function collectDraft() {
  const files = [];
  for (const row of fileRows) {
    files.push({ name: row.nameInput.value, content: row.area.value });
  }
  let expected = undefined;
  if (expectedArea !== null) {
    expected = expectedArea.value;
  }
  let args = undefined;
  if (argsArea !== null) {
    args = splitArgs(argsArea.value);
  }
  return {
    name: nameInput.value,
    args: args,
    expected: expected,
    files: files
  };
}

function showFormError(text) {
  if (formError === null) {
    return;
  }
  formError.textContent = text;
  formError.scrollIntoView();
  if (saveButton !== null) {
    saveButton.disabled = false;
  }
}

function makeFormButtons() {
  const buttons = makeElement('div', 'buttons', '');
  saveButton = makeElement('button', 'button', 'Сохранить');
  saveButton.addEventListener('click', function () {
    formError.textContent = '';
    saveButton.disabled = true;
    vscode.postMessage({ type: 'save', draft: collectDraft() });
  });
  buttons.appendChild(saveButton);
  buttons.appendChild(makeButton('Отмена', 'cancel'));
  return buttons;
}

function renderForm(data) {
  root.textContent = '';
  fileRows = [];
  expectedArea = null;

  let title = 'Правка кейса ' + data.name;
  if (data.mode === 'create') {
    title = 'Новый кейс';
  }
  root.appendChild(makeElement('h1', '', title));
  formError = makeElement('div', 'error', '');
  root.appendChild(formError);

  root.appendChild(makeElement('h2', '', 'Имя'));
  root.appendChild(makeElement('div', 'note', 'латинские буквы, цифры и _'));
  nameInput = makeInput(data.name);
  root.appendChild(nameInput);

  root.appendChild(makeElement('h2', '', 'Аргументы'));
  root.appendChild(makeElement('div', 'note', 'по одному на строку, пустая строка недопустима, {dir} подставит папку кейса'));
  if (data.argsEditable) {
    argsArea = makeArea(data.args.join('\n'));
    root.appendChild(argsArea);
  } else {
    argsArea = null;
    root.appendChild(makeReadOnly({ text: showArgs(data.args) }));
  }

  root.appendChild(makeElement('h2', '', 'Входные файлы'));
  fileList = makeElement('div', '', '');
  root.appendChild(fileList);
  for (const file of data.files) {
    if (file.content.simple) {
      addFileRow(file.name, file.content.text);
    } else {
      fileList.appendChild(makeElement('div', 'file-name', file.name));
      fileList.appendChild(makeReadOnly(file.content));
    }
  }
  const addButton = makeElement('button', 'button button-secondary', 'Добавить файл');
  addButton.addEventListener('click', function () {
    addFileRow('', '');
  });
  const addBox = makeElement('div', 'buttons', '');
  addBox.appendChild(addButton);
  root.appendChild(addBox);

  root.appendChild(makeElement('h2', '', 'Ожидаемый вывод'));
  if (data.expected.simple) {
    expectedArea = makeArea(data.expected.text);
    root.appendChild(expectedArea);
  } else {
    root.appendChild(makeReadOnly(data.expected));
  }

  root.appendChild(makeFormButtons());
}

function render(data) {
  if (data.mode === 'view') {
    renderView(data);
  } else {
    renderForm(data);
  }
}

window.addEventListener('message', function (event) {
  const message = event.data;
  if (message.type === 'show') {
    render(message.data);
  } else if (message.type === 'error') {
    showFormError(message.text);
  }
});

vscode.postMessage({ type: 'ready' });
