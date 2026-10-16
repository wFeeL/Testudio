<div align="center">

# Testudio++

Расширение для VS Code: тесты проекта на CMake в панели Testing, запуск и правка кейсов с входными данными прямо в редакторе.

<img alt="VS Code ^1.100" src="https://img.shields.io/badge/VS%20Code-%5E1.100-007ACC?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU%2BVmlzdWFsIFN0dWRpbyBDb2RlPC90aXRsZT48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMjMuMTUgMi41ODdMMTguMjEuMjFhMS40OTQgMS40OTQgMCAwIDAtMS43MDUuMjlsLTkuNDYgOC42My00LjEyLTMuMTI4YS45OTkuOTk5IDAgMCAwLTEuMjc2LjA1N0wuMzI3IDcuMjYxQTEgMSAwIDAgMCAuMzI2IDguNzRMMy44OTkgMTIgLjMyNiAxNS4yNmExIDEgMCAwIDAgLjAwMSAxLjQ3OUwxLjY1IDE3Ljk0YS45OTkuOTk5IDAgMCAwIDEuMjc2LjA1N2w0LjEyLTMuMTI4IDkuNDYgOC42M2ExLjQ5MiAxLjQ5MiAwIDAgMCAxLjcwNC4yOWw0Ljk0Mi0yLjM3N0ExLjUgMS41IDAgMCAwIDI0IDIwLjA2VjMuOTM5YTEuNSAxLjUgMCAwIDAtLjg1LTEuMzUyem0tNS4xNDYgMTQuODYxTDEwLjgyNiAxMmw3LjE3OC01LjQ0OHYxMC44OTZ6Ii8%2BPC9zdmc%2B">
<img alt="TypeScript 5.9" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white">
<img alt="CMake 3.20+" src="https://img.shields.io/badge/CMake-3.20%2B-064F8C?logo=cmake&logoColor=white">
<img alt="Лицензия MIT" src="https://img.shields.io/badge/license-MIT-3DA639?logo=opensourceinitiative&logoColor=white">

<br><br>

[Функционал](#-функционал) | [Установка](#-установка) | [Запуск](#-запуск) | [Как использовать](#-как-использовать) | [Настройки](#-настройки) | [Автор](#-автор)

<br><br>

<img src="images/overview.png" alt="Панель Testing с деревом кейсов testdata и карточка кейса 16_AllOptions" width="900">

</div>

## 🧩 Функционал

### 🌳 Дерево тестов и запуск

- Панель Testing показывает две группы: «Кейсы testdata» (кейсы с входными данными) и «Тесты C++» (тесты ctest по наборам). Пустая группа не показывается.
- Запускать можно все тесты сразу, группу или один тест.
- Дерево обновляется после сборки и само, когда меняется список тестов ctest.

### 🗂️ Карточка кейса

- Открывается кликом по кейсу, кнопкой в его строке или командой «Testudio++: Открыть карточку».
- Показывает имя, статус, код возврата, аргументы, входные файлы, ожидаемый и фактический вывод рядом.
- Кнопка «Diff» для упавшего кейса открывает встроенное сравнение ожидаемого и фактического вывода.
- Кнопка «Принять фактический вывод» заменяет `expected.txt` фактическим выводом после подтверждения.
- Нулевые байты, `\r` и байты вне UTF-8 видны в карточке как `\0`, `\r` и `\xNN`.

### ✏️ Создание и правка кейсов

- Кейс создается и правится формой в той же карточке.
- До записи на диск форма проверяет имя кейса (латинские буквы, цифры и `_`), аргументы (без пустых строк) и имена входных файлов (без `/`, без повторов, не `args.txt` и не `expected.txt`).
- Переименование и удаление кейса доступны из карточки, удаление еще и из дерева.

![Форма правки кейса 16_AllOptions: имя, аргументы, входные файлы, ожидаемый вывод](images/case-form.png)

### 🧪 Тесты C++

- Тесты ctest показываются по наборам. Клик по тесту открывает его код, если плагин нашел в исходниках макрос `TEST`, `TEST_F` или `TEST_P` с таким именем (так устроены тесты gtest).
- При падении теста сообщение ctest и вывод gtest показываются прямо в редакторе, рядом со строкой теста.

![Дерево «Тесты C++» с упавшим FromInt.Positive42 и сообщением об ошибке gtest в коде теста](images/cpp-tests.png)

### 🏗️ Настройка и сборка проекта

- Команды «Testudio++: Настроить проект» (`cmake -S . -B build`) и «Testudio++: Собрать проект» (`cmake --build`) запускаются из палитры команд.
- Если дерево пустое, плагин пишет почему и предлагает кнопку «Настроить и собрать» (проект не настроен) или «Собрать» (проект настроен, но тесты не собраны).
- Вывод cmake виден в окне «Testudio++». При ошибке его открывает кнопка «Показать вывод».

## 📦 Установка

| Что | Версия | Зачем |
|---|---|---|
| <img alt="VS Code" src="https://img.shields.io/badge/VS%20Code-007ACC?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU%2BVmlzdWFsIFN0dWRpbyBDb2RlPC90aXRsZT48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMjMuMTUgMi41ODdMMTguMjEuMjFhMS40OTQgMS40OTQgMCAwIDAtMS43MDUuMjlsLTkuNDYgOC42My00LjEyLTMuMTI4YS45OTkuOTk5IDAgMCAwLTEuMjc2LjA1N0wuMzI3IDcuMjYxQTEgMSAwIDAgMCAuMzI2IDguNzRMMy44OTkgMTIgLjMyNiAxNS4yNmExIDEgMCAwIDAgLjAwMSAxLjQ3OUwxLjY1IDE3Ljk0YS45OTkuOTk5IDAgMCAwIDEuMjc2LjA1N2w0LjEyLTMuMTI4IDkuNDYgOC42M2ExLjQ5MiAxLjQ5MiAwIDAgMCAxLjcwNC4yOWw0Ljk0Mi0yLjM3N0ExLjUgMS41IDAgMCAwIDI0IDIwLjA2VjMuOTM5YTEuNSAxLjUgMCAwIDAtLjg1LTEuMzUyem0tNS4xNDYgMTQuODYxTDEwLjgyNiAxMmw3LjE3OC01LjQ0OHYxMC44OTZ6Ii8%2BPC9zdmc%2B"> | 1.100 или новее | редактор, в котором работает расширение |
| <img alt="Node.js и npm" src="https://img.shields.io/badge/Node.js%20%2B%20npm-5FA04E?logo=nodedotjs&logoColor=white"> | Node.js 22 или новее, npm идет в комплекте | сборка из исходников: `npm install`, `npm run compile`, `npx vsce package`. Для самой работы расширения не нужны |
| <img alt="Git" src="https://img.shields.io/badge/Git-F05032?logo=git&logoColor=white"> | любая | `git clone` |
| <img alt="CMake" src="https://img.shields.io/badge/CMake-064F8C?logo=cmake&logoColor=white"> | 3.20 или новее, вместе с ctest | группа «Тесты C++» и команды «Настроить проект», «Собрать проект». Для кейсов testdata не нужен |

Поддерживаются macOS и Linux.

```bash
git clone https://github.com/wFeeL/Testudio.git
cd Testudio
npm install
```

## 🚀 Запуск

Способов два.

### Способ 1: из исходников

```bash
npm run compile
```

Откройте папку Testudio в VS Code и нажмите F5. Откроется отдельное окно «Extension Development Host» с подключенным расширением. В этом окне откройте свой CMake-проект.

### Способ 2: установить готовый файл `.vsix`

```bash
npm run compile
npx vsce package
code --install-extension testudio-0.1.0.vsix
```

`npx vsce package` создает файл `testudio-0.1.0.vsix`. Установить его можно и из интерфейса: панель Extensions, меню «...», «Install from VSIX...». После установки расширение работает в любом окне VS Code.

## 🧭 Как использовать

1. Откройте в VS Code папку проекта с `CMakeLists.txt` в корне и подтвердите доверие папке (Trust). Расширение включается, когда в корне открытой папки есть `CMakeLists.txt`. Плагин запускает программы и тесты проекта, поэтому в недоверенной папке он не работает. Поддерживается одна папка рабочей области.
2. Откройте панель Testing (значок колбы в боковой панели).
3. Если дерево пустое, нажмите «Настроить и собрать» или «Собрать» в подсказке плагина. То же делают команды из палитры: нажмите Cmd+Shift+P (macOS) или Ctrl+Shift+P (Linux), наберите `Testudio` и выберите «Testudio++: Настроить проект» и «Testudio++: Собрать проект». Вручную это `cmake -S . -B build` и `cmake --build build`.

   <img src="images/commands.png" alt="Палитра команд с пятью командами Testudio++" width="600">

4. Запустите тесты кнопками панели Testing: все сразу, группу или один тест.
5. При первом запуске кейса плагин спросит, какую программу тестировать. Сменить выбор можно командой «Testudio++: Выбрать тестируемую программу».
6. Кликните по кейсу, чтобы открыть его карточку.
7. Если кейс упал, нажмите «Diff», чтобы сравнить ожидаемый и фактический вывод. Если фактический вывод верный, нажмите «Принять фактический вывод».
8. Чтобы создать кейс, выполните команду «Testudio++: Новый кейс». Первый кейс создается только так: группа без кейсов скрыта, а папки с кейсами может еще не быть. Следующие кейсы можно создавать еще и правым кликом по группе «Кейсы testdata».
9. Правка, переименование и удаление кейса делаются кнопками «Изменить», «Переименовать» и «Удалить» в карточке. Удалить кейс можно и из дерева.
10. Для тестов C++ клик по тесту открывает его код. Проект плагин перед запуском не собирает: пересоберите его командой «Testudio++: Собрать проект».

## 📁 Формат кейса

Кейс это папка в `tests/testdata/` обычно с номером в начале имени, например `04_OnlyNewlines`. В ней лежат `args.txt` (аргументы по одному на строке), `expected.txt` (ожидаемый вывод) и входные файлы программы. Строка `{dir}` в `args.txt` и `expected.txt` означает путь к папке кейса.

```text
tests/testdata/04_OnlyNewlines/
  args.txt        {dir}/input.txt
  expected.txt    3 0 3 {dir}/input.txt
  input.txt
```

Кейс пройден, если программа завершилась с кодом 0, а вывод побайтово совпал с `expected.txt`. Программа запускается без оболочки и с пустым вводом в корне открытой папки. Не уложилась в таймаут, значит кейс упал.

## 🔧 Настройки

Обычно ничего менять не нужно, значения по умолчанию подходят для проекта со стандартной раскладкой. Если понадобится, откройте настройки VS Code (Cmd+, на macOS, Ctrl+, на Linux или меню Code/File, Settings), введите в поиск `testudio`. Все опции собраны в группе «Testudio++».

Чтобы задать значение только для одного проекта, переключитесь на вкладку Workspace или запишите ключи в файл `.vscode/settings.json` в корне проекта:

```json
{
  "testudio.buildDirectory": "build-debug",
  "testudio.timeoutSeconds": 30
}
```

<details>
<summary>Все настройки</summary>

| Ключ | По умолчанию | Что делает |
|---|---|---|
| `testudio.testdataPath` | `tests/testdata` | каталог с кейсами относительно корня открытой папки |
| `testudio.buildDirectory` | `build` | каталог сборки для `ctest` и `cmake --build` |
| `testudio.executablePath` | не задан | тестируемая программа; если путь не задан или файла нет, при первом запуске кейса откроется выбор файла |
| `testudio.cmakePath` | не задан | путь к `cmake` или его имя без `/`; если пусто, поиск в `PATH`, затем в `/opt/homebrew/bin`, `/usr/local/bin`, `/Applications/CMake.app/Contents/bin` |
| `testudio.ctestPath` | не задан | то же для `ctest` |
| `testudio.timeoutSeconds` | `10` | таймаут запуска одного теста в секундах |

</details>

## ⚠️ Ограничения

- Windows не проверялся.
- Поддерживается одна папка рабочей области, `CMakeLists.txt` должен лежать в ее корне.
- Если в `files.watcherExclude` исключен каталог сборки, дерево после сборки само не обновится, нажмите кнопку обновления в панели Testing.
- Править в форме можно только обычный текст: корректный UTF-8 без нулевых байтов и без `\r`, не больше 100000 байт. Остальные файлы остаются прежними.
- Тесты C++ плагин только показывает и запускает. Проект он не собирает перед запуском и `CMakeLists.txt` не меняет.

## 📄 Лицензия

MIT, текст в файле [LICENSE](LICENSE).

## 👤 Автор

<div align="center">

<a href="https://wfeels.site"><img alt="wfeels.site" src="https://img.shields.io/badge/wfeels.site-2F5BFF?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI%2BPHBhdGggZmlsbD0iI2ZmZiIgZD0iTTQgNy41NjEgTDEwLjQ5MiAyNC40MzkgTDE2IDEzLjAzMiBMMjEuNTA4IDI0LjQzOSBMMjggNy41NjEgTDIzLjcxNCA3LjU2MSBMMjEuMDkyIDE0LjM3OSBMMTcuOCA3LjU2MSBMMTQuMiA3LjU2MSBMMTAuOTA4IDE0LjM3OSBMOC4yODYgNy41NjEgWiIvPjwvc3ZnPg%3D%3D"></a>

Сабуров Даниил Денисович, M3109.

Лабораторная работа №3 по дисциплине «Инструментальные средства разработки ПО».

</div>
