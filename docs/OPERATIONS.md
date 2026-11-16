# МедКонтроль: эксплуатация

Короткий runbook. Все команды выполняются на сервере в каталоге приложения (в примерах `/srv/medcontrol/app`), если не сказано иное. Подключение с рабочей машины:

```bash
ssh user@server
```

## Деплой

Код попадает на сервер архивом из git, образы собираются на месте (на слабом NAS это 3–5 минут). Один скрипт с рабочей машины делает всё:

```bash
# с рабочей машины, из любого места внутри репозитория (после merge в main)
DEPLOY_HOST=user@server DEPLOY_DIR=/srv/medcontrol/app scripts/release.sh
```

Перед этим дождаться зелёного CI: `gh pr checks --watch`.

`release.sh` (переменные `DEPLOY_HOST`, `DEPLOY_DIR`, `DEPLOY_KEY`; без `DEPLOY_DIR` каталог приложения на сервере `/srv/dtc/app`) распаковывает `origin/main` в каталог приложения и запускает там `sh scripts/deploy.sh <sha>-<время>`. Вывод дописывается в `.release.log` в корне репозитория на рабочей машине. `deploy.sh` (POSIX sh: на многих NAS нет bash) работает с `umask 077`, потому что дампы и логи содержат медицинские данные, и:
1. делает дамп базы в `backups/predeploy/<tag>.dump` (хранятся 5 последних);
2. собирает все образы с новым тегом (`dtc/<сервис>:<tag>`, тег пишется в `.env` как `IMAGE_TAG`, прошлый — в `.deploy/previous`);
3. переключает контейнеры (`docker compose up -d --remove-orphans`);
4. пересоздаёт edge (`up -d --force-recreate --no-deps edge`): Caddyfile примонтирован одним файлом, после распаковки архива у него новый inode, и без пересоздания Caddy работал бы со старым конфигом (например, без новой CSP);
5. ждёт `/health` и печатает `/health?deep=1`;
6. удаляет образы, кроме текущего и предыдущего тега.

**Скрипты работают и без `.env`.** `deploy.sh` создаёт пустой `.env`, чтобы записать в него активный тег образов (`IMAGE_TAG`); имя пользователя и базы берутся по умолчанию, как в `docker-compose.yml`. `backup.sh` и `restore.sh` тоже обходятся без `.env`. `rollback.sh` без `.env` останавливается: возвращаться не к чему. `cloud-setup.sh` читает `.env` и дописывает в него `CLOUD_REMOTE`, пустой файл подойдёт.

**Сборка на NAS.** В Dockerfile пакеты ставятся через `apk add --no-cache --no-scripts`. Песочница сборки на некоторых NAS убивает триггер busybox сигналом 9, и без `--no-scripts` образ gateway не собирается. Добавляя пакеты в Dockerfile, сохраняйте этот флаг.

Откат за минуту, без пересборки (предыдущий тег хранится в `.deploy/previous`):

```bash
# на сервере
cd /srv/medcontrol/app && sh scripts/rollback.sh       # или sh scripts/rollback.sh <tag>
```

Миграции только вперёд: старый код работает на новой схеме, данные не теряются. Исключения отмечены в CHANGELOG как «откат только с восстановлением копии» (миграция 035, отметка каждого приёма): через них откатываться вместе с дампом `backups/predeploy/<tag>.dump`. Если новая версия испортила данные, восстановить `backups/predeploy/<tag>.dump` по `docs/RESTORE.md`.

Вручную: `git archive --format=tar origin/main | ssh … "cd /srv/medcontrol/app && tar -x"`, затем на сервере `docker compose up -d --build gateway frontend`. Если менялся `edge/Caddyfile`, отдельно `docker compose up -d --force-recreate --no-deps edge`. Во время перезапуска gateway (10–20 секунд: миграции, каталог, единицы) сайт отвечает 502. Это нормально.

## Выпуск версии

1. Проверить образцы бланков: `node scripts/lab-samples.mjs`. Есть новые: сначала парсер ([LAB-PARSERS.md](LAB-PARSERS.md), «Перед выпуском версии»). Код выхода 3 значит, что сервис не подключён: выпускать без этого.
2. Номер версии в одном PR: `gateway/package.json`, `frontend/package.json`, `desktop/package.json` и их `package-lock.json`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml` и `Cargo.lock`, `gateway/src/server.js` (заголовок Swagger). В `CHANGELOG.md` раздел «Не выпущено» становится разделом версии с датой, сверху остаётся пустой «Не выпущено».
3. Пересобрать список лицензий: `node scripts/third-party.mjs > THIRD-PARTY-NOTICES.md` (нужны установленные зависимости в `gateway`, `frontend`, `desktop`).
4. Дождаться зелёного CI и влить PR.
5. Создать GitHub Release с тегом `vX.Y.Z` на коммите в `main`, текст из `CHANGELOG.md` на русском и коротким пересказом на английском.
6. Настольная версия собирается сама: тег запускает workflow `desktop`, он прикладывает к Release установщики под постоянными именами, на них ведут ссылки в README. Если Release ещё не создан, workflow создаёт его с короткой заметкой; текст можно заменить потом. Сборки пока без подписи разработчика ([DESKTOP.md](DESKTOP.md)).

Готовых образов Docker нет: серверная версия собирается из исходников командой `docker compose up -d --build`.

## Демо-стенд

`scripts/demo.sh` поднимает отдельный проект `medcontrol-demo` на порту 3101 с вымышленной пациенткой: эндометриоз и железодефицитная анемия, восемь месяцев гормональной терапии. Настройки демо — `scripts/demo.env`: свой проект Docker, своя подсеть (`172.31.252.0/24`), свои тома, `ENV_FILE=scripts/demo.env` вместо `.env`, без сервиса backup (`--scale backup=0`). Поэтому демо не видит настоящих ключей и токенов и не трогает `BACKUP_DIR`.

```bash
scripts/demo.sh                    # поднять, пройти первый запуск, загрузить демо-данные; печатает пароль
DEMO_LANG=en scripts/demo.sh       # то же на английском: единицы и форматы США
DEMO_PASSWORD=… scripts/demo.sh    # свой пароль (от 10 символов, не простой)
scripts/demo.sh reset              # стереть демо-базу и начать заново
scripts/demo.sh down               # остановить и удалить демо
```

Демо-данные строит `gateway/src/tools/demoSeed.js` внутри контейнера gateway: анализы проходят через тот же `commitParsed`, что и загрузка PDF (бланки генерируются `pdfkit`), остальное — через HTTP API. Даты считаются от сегодняшнего дня. В пустую установку скрипт можно запустить и вручную: `docker compose exec -u node gateway node src/tools/demoSeed.js` (откажется, если анализы уже есть; `--force` добавит поверх).

## Настольная редакция без Tauri

`scripts/desktop-dev.sh` запускает gateway и сервер Next так, как их будет запускать настольное приложение: `DTC_EDITION=desktop`,
база PGlite, JS-движок PDF, всё только на `127.0.0.1`. Без Docker и без Postgres; нужен Node 22 и `npm ci` в `gateway/` и `frontend/`.
Данные по умолчанию в `data/desktop-dev` внутри репозитория (папка в `.gitignore`), не в настоящей папке приложения.

```bash
scripts/desktop-dev.sh                                      # сайт http://127.0.0.1:3701, gateway на 3700
DTC_DATA_DIR=/tmp/mc GATEWAY_PORT=3800 APP_PORT=3801 scripts/desktop-dev.sh
```

## Дополнительные службы (профили compose)

Базовый набор (postgres, gateway, frontend, edge, backup) работает без настройки. Остальное включается строкой `COMPOSE_PROFILES` в `.env`, значения через запятую, затем `docker compose up -d`:

| Профиль | Что запускает | Что ещё нужно в `.env` |
|---|---|---|
| `dicom` | Orthanc, архив снимков и просмотрщик | `ORTHANC_PASSWORD` (`openssl rand -hex 24`), без него Orthanc не стартует; папка дисков `DICOM_DIR`. См. «Снимки (DICOM)» |
| `watchdog` | сторож | `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID`: сторож берёт их только из `.env`. См. «Здоровье и сторож» |
| `egress` | исходящий прокси через VPN роутера | `EGRESS_PROXY=http://egress:8888`, `EGRESS_PARENT`, `EGRESS_IP`. См. «Сеть» |
| `python` | сервис `ingestion` | `PDF_ENGINE=python`. Нужен только для сравнения движков ([LAB-PARSERS.md](LAB-PARSERS.md), «Два движка»): по умолчанию PDF читает gateway |

Пример: `COMPOSE_PROFILES=dicom,watchdog`.

Образец бланка отправляется, только если в `.env` задан `LAB_SAMPLES_URL`; без него на экране только копирование текста. Отдельный сервис приёма описан в `samples/README.md`.

## Здоровье и сторож

- `/health` проверяет только базу (для Docker и скриптов). Снаружи `/api/gateway/health` и `health?deep=1` отвечают 404: прокси frontend пропускает только `/health/import` и `/health/status` (Apple Health). Проверять здоровье можно только изнутри сервера. `/health?deep=1` дополнительно проверяет парсер PDF (поле `checks.ingestion`; при `PDF_ENGINE=js` значение `off`, сервис не нужен), Orthanc, выход в интернет через egress, возраст бэкапа и настройки (Telegram, ИИ); отвечает 503 без базы и списком `degraded` при частичных проблемах:
  `docker compose exec gateway wget -qO- 'http://127.0.0.1:3000/health?deep=1'`.
- Контейнер `watchdog` (профиль `watchdog`) каждые 5 минут (`WATCHDOG_INTERVAL`) опрашивает `http://gateway:3000/health?deep=1` по сети стека и пишет в Telegram: «🚨 МедКонтроль не отвечает» после двух провалов подряд, «✅ снова отвечает» при восстановлении, «⚠️ есть проблемы» при деградации (раз в сутки на один и тот же список). Лог: `docker compose logs -f watchdog`. Сообщения сторожа идут по `TELEGRAM_PROXY_WATCHDOG` (обычно `direct`), при неудаче через прокси — напрямую: тревога о падении VPN не должна зависеть от VPN.
- Внешний контроль (если выключился сам сервер или Docker): завести бесплатный «heartbeat» на healthchecks.io или UptimeRobot, адрес пинга положить в `.env` как `HEALTHCHECKS_URL`. Сторож пингует его при каждой успешной проверке; если пинги пропадут, внешний сервис напишет на почту/в Telegram сам.

## Сеть: Telegram и ИИ, при необходимости через VPN

Два исходящих пути с разными требованиями:

- **ИИ** — напрямую или, если провайдер модели не принимает адреса вашей страны, через egress-прокси (`EGRESS_PROXY=http://egress:8888`, профиль `egress`). Прокси пропускает только адреса из `egress/filter`: сейчас это OpenRouter, Anthropic, ChatGPT, DeepSeek, Telegram и `api.ipify.org`. Для образцов бланков добавьте в этот файл адрес `LAB_SAMPLES_URL`, затем `docker compose up -d --build egress`. Контейнер `egress` имеет свой адрес в домашней сети (`EGRESS_IP`), и роутер заворачивает это устройство в VPN (политика маршрутизации по устройству). Если VPN роутера упал, ИИ через прокси не работает.
- **Telegram** — можно отдельно от ИИ: `TELEGRAM_PROXY=direct` и `TELEGRAM_PROXY_WATCHDOG=direct` в `.env`. Так напоминания и тревоги сторожа не зависят от VPN. Если провайдер начнёт блокировать Telegram, убрать `direct` (тогда Telegram пойдёт через `EGRESS_PROXY`) и перезапустить: `docker compose up -d gateway watchdog`. Даже с прокси gateway при его падении пробует прямой маршрут.

Проверка: Настройки → «Помощник ИИ» → «Дополнительно: модели и расход» → «Откуда идут запросы» должно показывать адрес VPN, не провайдера. С сервера: `docker compose exec gateway wget -qO- 'http://127.0.0.1:3000/health?deep=1'`, поле `checks.egress`.

## Логи и состояние

```bash
docker compose ps
docker compose logs --since 30m gateway | grep -v '"level":30'   # только warn/error; URL в логе без query-строки
docker compose logs -f backup
docker compose logs orthanc --tail 50
```

Что проверить, если «что-то не так»:
- `/health?deep=1` изнутри сервера (см. «Здоровье и сторож»): `docker compose exec gateway wget -qO- 'http://127.0.0.1:3000/health?deep=1'`;
- Настройки → «Помощник ИИ»: «Проверить» и «Откуда идут запросы» (должен быть адрес VPN, не провайдера);
- Настройки → «Для администратора сервера»: карточка «Бэкапы» без проблем;
- утренняя строка о бэкапе пришла в Telegram.

## Перезапуск сервиса

```bash
docker compose up -d gateway          # применить новый .env
docker compose restart gateway        # просто перезапустить
docker compose exec gateway node -e 'console.log(process.env.APP_URL)'   # заглянуть в окружение
```

## Тесты

Юнит-тесты gateway (чистые функции: правила тревог, каталог и коды анализов, даты, единицы, RECIST, тексты бота, дневник одной строкой, разбор Apple Health, импорт заметок, словарь ошибок):

```bash
cd gateway && npm test
```

Интеграционные тесты (миграции на пустой базе, запись анализов, планировщик с подменённым временем, бот с подменённым транспортом, курсы, версии анамнеза, заметки и тексты файлов, Apple Health, поиск) создают по отдельной одноразовой базе на файл и удаляют её после себя. Без `TEST_DATABASE_URL` они пропускаются:

```bash
# нужен любой Postgres; локально удобно взять контейнер стека. Postgres живёт во внутренней сети <проект>_data
# (проект называется medcontrol при любом имени папки, сеть — medcontrol_data; `docker compose ls` покажет)
docker run --rm --network medcontrol_data -v "$PWD":/w -w /w/gateway -e TEST_DATABASE_URL=postgres://dtc:dtc@postgres:5432/dtc node:22-alpine npm run test:integration
```

Те же интеграционные тесты без Postgres: `cd gateway && TEST_DB=pglite npm run test:integration`.

GitHub Actions (`.github/workflows/ci.yml`) гоняет юнит- и интеграционные тесты gateway (на Postgres, он поднимается как сервис, и на PGlite), typecheck и сборку frontend, проверку импорта и pytest парсеров ingestion на каждый PR и push в `main`. Мержить только после зелёного CI. Ядро препаратов, исследований и вех тестируется без HTTP; парсеры лабораторий проверяются на общих текстовых фикстурах с обеих сторон (Python и JS), текстовый слой pdf.js — на сгенерированных PDF. Нет тестов на сами HTTP-маршруты, экспорт ZIP, отказы LLM, фронтенд и на настоящих бланках лабораторий (нужны обезличенные файлы).

## Вход

- Два способа: «Войти по ключу» (passkey: Face ID / Touch ID, без пароля; ключ = владение телефоном + биометрия) и пароль + ключ. Ключи добавляются в Настройках, и для этого нужно ввести пароль ещё раз.
- Защита от перебора: 5 неверных паролей с одного адреса → блокировка на 1 минуту, дальше удваивается (до часа); общий предохранитель 25 неудач со всех адресов закрывает вход по паролю. Вход по ключу общий предохранитель не закрывает, и неудачный вход по ключу не считается ошибкой.
- Адрес клиента: edge (Caddy) доверяет `X-Forwarded-For` только от частных адресов (роутер, HTTPS-прокси) и передаёт дальше настоящий адрес клиента; gateway доверяет этому заголовку только из частных сетей. Блокируется атакующий, а не весь роутер.
- «Выйти» стирает токен только в браузере. «Выйти везде» в Настройках отзывает все выданные токены.
- Ключ интеграции Apple Health: Настройки → Apple Health → «Создать ключ» (показывается один раз, хранится хэш), «Отозвать» отключает.
- Не от root работают gateway, frontend, ingestion и watchdog; gateway стартует от root только чтобы отдать папку `/data` пользователю `node`, и сразу понижает права через su-exec. У всех сервисов `no-new-privileges`; у postgres, gateway, ingestion, frontend, edge, backup, watchdog сброшены все capabilities, кроме нужных для смены владельца и пользователя; у gateway, ingestion, frontend, edge, watchdog файловая система только для чтения (запись в тома и `/tmp`). Если после правки Dockerfile сервис падает с `EROFS` или `operation not permitted`, дело в этих ограничениях.

## Секреты и пароли

Все секреты в `.env` рядом с `docker-compose.yml`, права 600. После правки любого ключа: `docker compose up -d gateway` (для `ORTHANC_PASSWORD` ещё `orthanc`, для `TELEGRAM_*` ещё `watchdog`).

| Ключ | Что делает | Как сменить |
|---|---|---|
| `DTC_PASSWORD` | вход в МедКонтроль; необязателен: без него пароль задаётся на странице первого запуска и хранится в базе (сменить: Настройки → «Вход и защита» → «Сменить пароль»). Заданный здесь пароль важнее мастера. Он должен быть не короче 8 символов, иначе gateway не стартует; если он короче 10 символов или слишком простой (правила нового пароля), gateway стартует и пишет в журнал предупреждение `DTC_PASSWORD in .env is weak` | `sed -i 's/^DTC_PASSWORD=.*/DTC_PASSWORD=НОВЫЙ/' .env` |
| `JWT_SECRET` | подпись сессий; пусто — создаётся сам в `DATA_DIR/jwt.secret`; смена разлогинивает всех | задать в `.env` или удалить файл и перезапустить gateway |
| `ORTHANC_USER`, `ORTHANC_PASSWORD` | вход gateway и edge в Orthanc (пользователь их не вводит; пароль случайный, `openssl rand -hex 24`) | заменить, `docker compose up -d orthanc gateway` |
| `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `YANDEX_API_KEY`, `GIGACHAT_AUTH_KEY`, `LLM_CUSTOM_API_KEY` | ИИ | заменить, перезапустить gateway (или поменять в Настройках → «Помощник ИИ», если ключ не в `.env`) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | бот и сторож | заменить, `docker compose up -d gateway watchdog` |
| `POSTGRES_PASSWORD` (и пароль в `DATABASE_URL`) | доступ к базе для gateway и backup | сначала `ALTER USER` в Postgres, потом `.env`, потом `docker compose up -d` (см. чек-лист безопасности) |
| ключ интеграции Apple Health | приём данных от Health Auto Export | Настройки → Apple Health → «Отозвать», «Создать ключ», вписать новый в приложение |
| `DTC_MFA=off` | отключить шаг с ключом, если потеряны все passkey | поставить, войти, удалить старые ключи, добавить новый, вернуть `on` |
| токены ИИ-агентов (MCP) | доступ внешних агентов к данным (docs/MCP.md) | Настройки → «Доступ для ИИ-агентов» → «Отозвать» или «Выключить доступ» (отзывает все); `DTC_MCP=off` в `.env` и `docker compose up -d gateway` запрещает совсем |

«Выйти везде» в Настройках → «Вход и защита» завершает все сессии, отзывает токены ИИ-агентов (MCP) и ключ Apple Health. Если сессию украли (потерян телефон с открытым МедКонтролем): «Выйти везде», смена пароля, проверить журнал MCP и Telegram-сообщения о новых ключах и токенах.

## Модели ИИ

Сервис и модели меняются в Настройках → «Помощник ИИ» без перезапуска; выбор там перекрывает `.env`. Через `.env`: `LLM_PROVIDER` (`openrouter` | `anthropic` | `openai` | `deepseek` | `yandex` | `gigachat` | `custom`), `LLM_MODEL` (основная), `LLM_MODEL_FAST` (быстрая), ключи сервисов. Пустые модели — модели сервиса по умолчанию (`gateway/src/lib/llmProviders.js`).

- **OpenRouter, Anthropic, ChatGPT** читают PDF и картинки. **DeepSeek, YandexGPT, GigaChat и свой адрес** — только текст: PDF уходит текстовым слоем (pdf.js в gateway), а сканы и фото документов сначала распознаются в gateway (Tesseract в WebAssembly, `lib/ocr.js`, модели русского и английского ставятся с npm-пакетами, в интернет ничего не уходит) и тоже уходят текстом. Распознавание идёт по одному файлу за раз, страница занимает от половины секунды до нескольких секунд, не больше 20 страниц на файл. Снимки КТ и МРТ таким сервисам не отправить, интерфейс об этом скажет.
- Запросы к OpenRouter, Anthropic, OpenAI и DeepSeek идут через `EGRESS_PROXY`, если он задан; к Яндексу, Сберу и своему адресу — напрямую.
- **YandexGPT (Алиса AI):** нужны API-ключ сервисного аккаунта с ролью `ai.languageModels.user` и идентификатор каталога. Модель по умолчанию `gpt://<каталог>/yandexgpt/latest`, быстрая `yandexgpt-lite`; другую модель (например, Алиса AI LLM) можно вписать в «Дополнительно».
- **GigaChat:** ключ авторизации из личного кабинета разработчика Сбера; gateway сам получает 30-минутный токен. Серверы Сбера подписаны корневым сертификатом Минцифры, которого нет в Node.js и браузерах. Он входит в МедКонтроль (`gateway/src/certs/russian_trusted_root_ca.pem`, с gosuslugi.ru/crt) и используется только для адресов GigaChat (`lib/sberTls.js`), остальные соединения ему не доверяют. Ничего настраивать не нужно; если раньше в `.env` был задан `NODE_EXTRA_CA_CERTS` с этим сертификатом, его можно убрать.
- **Свой адрес:** любой OpenAI-совместимый API, например Ollama (`http://<сервер>:11434/v1`) или LM Studio (`http://<сервер>:1234/v1`). Адрес должен быть доступен из контейнера gateway: `localhost` внутри контейнера — это сам контейнер, указывайте адрес машины в сети или `host.docker.internal`. Сервисы самого стека (`postgres`, `gateway` и другие), `0.0.0.0` и адреса метаданных облаков не принимаются.
- Сменить сервис, адрес или ключ можно только с паролем МедКонтроля; первые 15 минут после входа с паролем он не спрашивается. То же для бота и чата Telegram.

## Справочник анализов

Маркеры и их канонические единицы описаны в `gateway/src/lib/catalogSeed.js`. Чтобы добавить показатель: новая запись с уникальным `key`, русским названием, категорией, единицей, `sortOrder` (частные раньше общих), `aliases` и `pattern`. Если нужна конвертация единиц, добавить коэффициент в `gateway/src/lib/units.js`. После перезапуска gateway каталог обновится, старые названия перепривяжутся, значения пересчитаются (лог `catalog:` и `units:`). Перед этим сделайте бэкап: `docker compose exec backup bash /backup-loop.sh once`.

## Бэкапы

- Ночью в `BACKUP_AT` (03:30 по часам службы backup, см. следующий пункт): дамп, файлы, `.env` → `BACKUP_DIR/<дата>` (по умолчанию `../medcontrol-backups`, рядом с папкой кода; путь виден в карточке «Бэкапы»); зеркало на второй диск `MIRROR_DIR`; по воскресеньям проверка восстановления в тестовую базу.
- Часовой пояс: службы backup, watchdog и orthanc работают по переменной `TZ` из `.env`, по умолчанию `Europe/Moscow`, какой бы пояс ни был выбран в программе. По нему считаются время `BACKUP_AT`, день проверки восстановления, даты в именах копий и время в сообщениях сторожа. Свой пояс: строка в `.env`, например `TZ=Europe/Berlin` или `TZ=America/New_York`, затем `docker compose up -d`.
- Разовый прогон: `docker compose exec backup bash /backup-loop.sh once`.
- Статус: `cat $BACKUP_DIR/status.json`, карточка «Бэкапы» в Настройках, строка в Telegram в 08:30.
- Права: сервис backup работает с `umask 077` (копии 700/600, `env` 600), но `status.json` пишет с правами 644. Gateway работает не от root и читает статус через том `/backups`, поэтому сама папка `BACKUP_DIR` должна быть 711 (проход без чтения списка), а не 700; сервис backup выставляет это сам. Если в Настройках «Сервис backup ещё не отчитывался», а `status.json` свежий, проверьте эти права.
- Облако: служба backup выгружает копии через rclone в remote, названный в `CLOUD_REMOTE` (имя с двоеточием), по файлу `rclone.conf` из папки `RCLONE_DIR`. Подойдёт любое хранилище, с которым работает rclone. Копии ложатся в `<CLOUD_REMOTE>/backups` и `<CLOUD_REMOTE>/dicom`.
  - `scripts/cloud-setup.sh` настраивает один вариант как пример: S3-совместимое хранилище и шифрование rclone crypt поверх него. Заведите бакет, затем `YC_ACCESS_KEY=… YC_SECRET_KEY=… YC_BUCKET=… bash scripts/cloud-setup.sh`. Адрес и регион по умолчанию от Yandex Object Storage, для другого хранилища задайте `YC_ENDPOINT` и `YC_REGION`. Скрипту нужен `.env`, хватит пустого (`touch .env && chmod 600 .env`): он допишет туда `CLOUD_REMOTE=yc-crypt:` и `RCLONE_DIR`. Ключ шифрования из `$RCLONE_DIR/CRYPT-KEY.txt` перенесите в менеджер паролей, затем `docker compose up -d backup` и разовый прогон.
  - Своё хранилище: настройте remote командой `rclone config` на любой машине, положите получившийся `rclone.conf` в папку на сервере, укажите её в `RCLONE_DIR`, а имя remote в `CLOUD_REMOTE`. Чтобы копия в облаке была зашифрована, remote должен быть типа crypt. Если он другого типа, копия всё равно выгружается, но служба пишет в журнал предупреждение `UNENCRYPTED`, а в утренней строке Telegram и на карточке бэкапов появляется «копия в облако уходит без шифрования».
- Восстановление: `docs/RESTORE.md`.

## Apple Health: история из export.zip

Здоровье на iPhone → профиль → «Экспортировать все данные» → `export.zip` (сотни мегабайт). Распаковать, положить `export.xml` на сервер (например, в `/srv/medcontrol/apple_health/`) и запустить:

```bash
cd /srv/medcontrol/app && docker compose exec -T gateway node src/tools/appleHealthXml.js < /srv/medcontrol/apple_health/export.xml
```

Читает файл построчно, берёт давление, вес, температуру, пульс покоя, пульс и шаги, кладёт в `health_samples` и пересчитывает дневник по дням. Повторный запуск ничего не дублирует. Текущие данные дальше приходят сами через Health Auto Export (Настройки → Apple Health).

## Снимки (DICOM)

Нужен профиль `dicom` и `ORTHANC_PASSWORD` (см. «Дополнительные службы»).

1. Скопировать папку диска целиком в папку `DICOM_DIR` (например, по SMB), имя вида `2026-05-21_КТ_ОГК`.
2. В МедКонтроле: «Снимки» → «Архив снимков» → «Импортировать». Дата и метод читаются из заголовков, исследование привязывается или создаётся.
3. Просмотрщик: «Открыть снимки» на карточке, пароль не нужен: edge пускает только с пропуском, который выдаёт вошедшему раздел «Снимки», и сам подставляет `ORTHANC_PASSWORD`. Снаружи доступны только чтение и просмотр, запись в Orthanc через сайт закрыта. Пароль Orthanc руками больше не вводится, поэтому он должен быть длинным и случайным: `openssl rand -hex 24` (gateway предупреждает в журнале, если он короче 16 знаков).
4. Хранилище Orthanc не бэкапится: после восстановления повторить импорт по папкам.

## Типичные поломки

| Симптом | Причина | Что делать |
|---|---|---|
| 502 на сайте полминуты после деплоя | gateway применяет миграции | подождать; если дольше минуты, `docker compose logs gateway` |
| gateway в цикле перезапуска, в логе `migration failed` | ошибка в новой миграции | откатить код на предыдущий коммит; миграция транзакционная, база цела |
| gateway не стартует: `DTC_PASSWORD in .env must be at least 8 characters and not a common word` | пароль в `.env` короче 8 символов или словарное слово (пароль от 8 символов, но слабый по правилам нового пароля, старту не мешает: в журнале будет `DTC_PASSWORD in .env is weak`) | задать другой пароль или убрать `DTC_PASSWORD`, тогда пароль задаёт мастер первого запуска |
| Telegram молчит | в логе `telegram bot: poll error` или `ETIMEDOUT 149.154…`: нет связи с `api.telegram.org`; либо не задан токен или chat id | `grep TELEGRAM_ .env`; `docker compose logs --since 1h gateway \| grep -i telegram`; Настройки → «Отправить тест». Если провайдер блокирует Telegram — убрать `TELEGRAM_PROXY=direct`, чтобы Telegram шёл через egress, и `docker compose up -d gateway watchdog`; либо в роутере направить 149.154.160.0/20 и 91.108.56.0/22 через VPN. Бот после сбоя сам повторяет попытки с паузой до 5 минут |
| ИИ не отвечает: «Сервис не ответил вовремя» (504 `timeout`), «Нет связи с сервером» (502 `network`), в логе `upstream timeout` или `egress` | VPN роутера упал или сбросил политику; egress-контейнер не запущен | Настройки → «Откуда идут запросы» (ошибка или адрес провайдера — проблема в VPN); `docker compose ps egress`; в роутере проверить, что устройство egress (`EGRESS_IP`) в политике VPN и VPN активен; `docker compose restart egress`. Если адрес VPN, но ответа нет — Настройки → «Помощник ИИ» → «Проверить», возможно, перегружен провайдер модели. ChatGPT и DeepSeek через прокси не проходят, пока их адреса не добавлены в `egress/filter` |
| ИИ отвечает 403 / «Откуда идут запросы» показывает адрес провайдера | egress-прокси не идёт через VPN, провайдер модели не принимает адреса вашей страны | в роутере перевести устройство egress (`EGRESS_IP`) в политику VPN; `docker compose restart egress` |
| После деплоя нет новых заголовков (CSP), `/_next/image` не закрыт, старое поведение `/orthanc` | edge работает со старым Caddyfile (новый inode после распаковки) | `docker compose up -d --force-recreate --no-deps edge`; проверить `curl -sI http://127.0.0.1:3001/ \| grep -i content-security` |
| Страница пустая или не грузит скрипты, в консоли браузера `Content-Security-Policy` | CSP на edge запрещает внешний ресурс | ресурсы должны быть со своего домена; правка в `edge/Caddyfile`, затем пересоздать edge |
| Настройки → Бэкапы: «Сервис backup ещё не отчитывался», хотя бэкапы есть | gateway не может прочитать `status.json` | `ls -ld $BACKUP_DIR` (нужно 711), `ls -l $BACKUP_DIR/status.json` (нужно 644) |
| Просмотрщик снимков пишет «Просмотр снимков закрыт» | пропуск истёк (8 часов) или был «Выйти везде» | открыть «Снимки» в МедКонтроле и снова «Открыть снимки» |
| Просмотрщик отвечает 502 | edge не достучался до gateway (проверка пропуска) | `docker compose ps gateway`, `docker compose logs edge` |
| Бэкап-тревога утром | смотреть `status.json`: `dump_error`, `mirror.error`, `cloud.error` | чаще всего не смонтирован `MIRROR_DIR` или нет места |
| Напоминание о приёме пришло, хотя приём отмечен | отметка сделана после 11:00 | ничего, это по правилам |
| `docker compose build` на NAS падает на `apk add` (signal 9, busybox trigger) | песочница сборки NAS | в Dockerfile `apk add --no-cache --no-scripts …` |
| Apple Health: Health Auto Export получает 413 | тело запроса больше 25 МБ (лимит прокси frontend) | в приложении уменьшить период одной отправки |

## Безопасность сервера: чек-лист владельца

Это настройки сервера и роутера, код их не меняет. Порядок — по убыванию риска. Перед каждым пунктом проверьте, что вход по ключу SSH работает, чтобы не закрыть себе доступ.

**Высокий риск**
- [ ] SSH: в `/etc/ssh/sshd_config` поставить `PermitRootLogin prohibit-password` и `PasswordAuthentication no`, перезапустить sshd, проверить вход по ключу из второго окна.
- [ ] Веб-терминалы и админка NAS: выключить веб-терминал, админку открывать только по HTTPS, включить защиту от перебора.
- [ ] Другие контейнеры на том же сервере не должны монтировать папки МедКонтроля (`DATA_DIR`, `DICOM_DIR`, `BACKUP_DIR`) на запись. Portainer и всё, что держит `docker.sock`, выключать, когда не нужно.
- [ ] Права на папки с данными без доступа «всем» (`chmod -R o-rwx`). После этого проверить «Снимки» → «Архив снимков»: gateway читает `/dicom` не от root, а от пользователя `node`.
- [ ] Не хранить полные дампы вне ротации (ручные копии перед миграциями, переносы с другой машины): удалить или зашифровать.
- [ ] VPN-клиенты в host-сети (Tailscale и подобные) открывают весь сервер в своей сети: держать только если это осознанный путь доступа.

**Средний риск**
- [ ] Пароль Postgres: в примере `.env` он `dtc`. Сгенерировать 32+ символов, `docker compose exec postgres psql -U dtc -c "ALTER USER dtc PASSWORD '…'"`, поменять `POSTGRES_PASSWORD` и `DATABASE_URL` в `.env`, `docker compose up -d`. Затем ограничить `pg_hba.conf` подсетью стека (`STACK_SUBNET`).
- [ ] Бэкап вне сервера с шифрованием: облачный ярус (`scripts/cloud-setup.sh`, см. «Бэкапы») или штатный бэкап NAS с шифрованием. В каждой копии лежит `.env`.
- [ ] Внешний HTTPS-прокси: его конфиг описан и хранится рядом с `.env`; путь входа снаружи один.
- [ ] Firewall: порт 3001 (edge, HTTP) разрешить только с адреса роутера или HTTPS-прокси.
- [ ] Общая папка с DICOM-дисками: доступ одному пользователю, не группе.
- [ ] Закрыть лишние открытые порты сервера.

**В коде и compose (отдельными PR)**
- [x] Внутренняя сеть `data` (без выхода в интернет) для Postgres, Orthanc и парсера PDF. Выход gateway только через egress — не делаем: egress необязателен.
- [x] `no-new-privileges` у всех сервисов; `cap_drop: [ALL]` с минимальным `cap_add` у postgres, gateway, ingestion, frontend, edge, backup, watchdog; `read_only` у gateway, ingestion, frontend, edge, watchdog. Orthanc и egress только с `no-new-privileges`; egress, edge, orthanc, postgres и backup сейчас работают от root.
- [x] Фиксированные теги образов: `postgres:16.13`, `caddy:2.11.4-alpine`, `node:22.23.2-alpine`, `python:3.12.16-slim`. Обновлять осознанно, раз в квартал, после бэкапа.
- [ ] HSTS с `includeSubDomains`, если все поддомены на HTTPS.
- [x] Зависимости gateway (ноябрь 2026): `npm audit fix` поднял `fastify` до 5.12, `undici` до 7.30.1, `ajv`, `fast-uri`, `find-my-way`, `yaml`,
      `bn.js`, `brace-expansion` в пределах их версий; `@fastify/jwt` 9 → 10 (`fast-jwt` 6, критические уязвимости проверки токенов),
      `@fastify/swagger-ui` 5 → 6 (`@fastify/static` 10, обход путей; Swagger и так включается только с `ENABLE_DOCS=1`).
- [x] `zod` 3 → 4.6 (ноябрь 2026, уязвимость высокой опасности: память при проверке огромных массивов). В zod 4 `.partial()` подставляет
      значения по умолчанию, поэтому у схем для PATCH полей с `.default()` быть не должно (см. `MilestonePatch` в `routes/milestones.js`);
      `z.record` пишется с двумя аргументами. Тексты в `details` ответа 400 у zod 4 другие; интерфейс их не показывает.
- [ ] Оставшееся в `npm audit` gateway (проверено, в работе не достижимо, `npm audit fix` без `--force` их не исправляет):
      `glob`, `minimatch`, `readdir-glob` через `archiver` 7, `exceljs` и `@fastify/static` 10 (`glob` 13, исправлено в 14) — обход отмены
      по `AbortSignal` и ReDoS в шаблонах файлов; шаблонов из запроса у нас нет, `AbortSignal` в `glob` не передаём,
      архив собирается из перечисленных файлов. `archiver` 8 — только ESM с другим API, обновлять вместе с правкой `routes/export.js`.
      `uuid` < 11.1.1 через `exceljs` — ошибка только для v3/v5/v6 с переданным буфером, `exceljs` их так не вызывает; `npm` предлагает откат `exceljs` на 3.4, это хуже.
      Проверять заново при каждом обновлении: `cd gateway && npm audit`.
- [x] Next.js обновлён до 15.5 (поддерживаемая ветка), React 19; `postcss` внутри Next поднят до 8.5 через `overrides` в `frontend/package.json` — проверять при обновлении Next, убрать, когда Next сам перейдёт на исправленную версию. `npm audit` фронтенда: 0.
