# Project Golem — исходный код

Исходный проект: https://github.com/CyberMagician/Project_Golem

В каталоге `vendor/Project_Golem/` сохранены исходные файлы Project Golem из ветки `main`: сервер Flask, WebGL/Three.js интерфейс, генератор эмбеддингов, зависимости, README, лицензия Apache-2.0 и NOTICE.

Это **визуализатор семантической памяти, а не система агентов**.

## Запуск оригинала на Windows

Из каталога `vendor/Project_Golem/app`:

```powershell
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe ingest.py
.venv\Scripts\python.exe GolemServer.py
```

Откройте http://127.0.0.1:8000/ после запуска. Построение мозга скачивает модели и внешние данные; требует интернет и достаточно памяти/дискового пространства. Оригинальный интерфейс использует Three.js из CDN и без сети может не отображаться.

**Важно:** исходный Flask-сервер пока отдельный от основного Node.js сервера Amayori. Наличие исходников не означает автоматическую интеграцию с архивом чатов или запуск через Amayori.bat. Не публикуйте пользовательские чаты и API-ключи в GitHub.
