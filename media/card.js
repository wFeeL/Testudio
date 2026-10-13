const vscode = acquireVsCodeApi();
const root = document.getElementById('root');

const STATUS_TEXT = {
  passed: 'Пройден',
  failed: 'Упал',
  unknown: 'Не запускался'
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

function shouldShowAccept(data) {
  if (data.actual === undefined) {
    return false;
  }
  if (data.exitCode === null) {
    return false;
  }
  return data.expected.text !== data.actual.text;
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
  if (shouldShowAccept(data)) {
    buttons.appendChild(makeButton('Принять фактический вывод', 'accept'));
  }
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
    column.appendChild(makeElement('div', 'muted', 'кейс ещё не запускался'));
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

function render(data) {
  root.textContent = '';
  root.appendChild(makeHeader(data));
  root.appendChild(makeArgs(data.args));
  root.appendChild(makeFiles(data.files));
  root.appendChild(makeOutputs(data));
}

window.addEventListener('message', function (event) {
  const message = event.data;
  if (message.type === 'show') {
    render(message.data);
  }
});

vscode.postMessage({ type: 'ready' });
