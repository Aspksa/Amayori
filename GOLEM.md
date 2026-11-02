# Project Golem — полный импорт исходников

Источник: https://github.com/CyberMagician/Project_Golem

В GitHub Actions предусмотрен импорт **всех файлов исходного репозитория** в `modules/project-golem/` без изменения их содержимого. Исключается только служебная папка `.git`. Оригинальные файлы LICENSE/NOTICE (если присутствуют) сохраняются. Версия источника фиксируется в `modules/project-golem/.upstream-commit`.

Workflow: `.github/workflows/import-golem.yml`. После слияния он должен автоматически запуститься при появлении workflow в `main`. Его также можно запустить вручную через Actions → Import complete Project Golem source → Run workflow.

**Проверяйте статус Actions:** наличие workflow ещё не доказывает успешный импорт. Для записи нужен разрешённый `GITHUB_TOKEN` с `contents: write`; политики GitHub могут заблокировать push. Импорт исходников не устанавливает Python-зависимости, модели и не запускает сервер Golem. Для настройки без Docker потребуется отдельная интеграция.
