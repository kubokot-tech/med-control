# МедКонтроль: архитектура

Как система устроена внутри: из чего состоит, как ходят данные, что лежит в базе, что делает каждый файл gateway, как работает ИИ и фоновые задачи, как это разворачивается на сервере. Что видно пользователю — в [OVERVIEW.md](OVERVIEW.md), как обслуживать — в [OPERATIONS.md](OPERATIONS.md).

## Компоненты

Всё — контейнеры одного `docker compose` (файл `docker-compose.yml`):

| Сервис | Образ / код | Роль |
|---|---|---|
| `postgres` | `postgres:16.13` | единственный источник правды; данные в `PG_DIR` |
| `gateway` | `gateway/` (Node 22, Fastify 5) | вход, REST API, миграции, правила тревог, ИИ, планировщик напоминаний, Telegram-бот, импорт DICOM, приём Apple Health, полнотекстовый поиск, экспорт PDF/xlsx/CSV/ZIP; стартует от root и понижает права до `node` через su-exec |
| `ingestion` | `ingestion/` (Python, FastAPI, pypdf) | встроенные парсеры PDF лабораторий (реестр `app/connectors/registry.py`, сейчас МКНЦ, Хеликс, Хадасса и ДНКОМ; `/ingest/labs/pdf`, список — `/parsers`), текстовый слой любого PDF (`/extract/pdf`); как добавить лабораторию — [LAB-PARSERS.md](LAB-PARSERS.md); доступен только изнутри compose-сети. **В запасе:** по умолчанию PDF читает сам gateway (`PDF_ENGINE=js`: pdf.js с алгоритмом pypdf и JS-версия парсеров), сервис стартует только с профилем `python` (`COMPOSE_PROFILES=python`, `PDF_ENGINE=python`). Python-парсеры остаются эталоном для тестов |
| `frontend` | `frontend/` (Next.js 15.5, React 19, standalone) | интерфейс; ходит в gateway через свой серверный прокси `/api/gateway/*`; оптимизатор картинок выключен (`images.unoptimized`), заголовок `X-Powered-By` убран |
| `edge` | `caddy:2.11.4-alpine`, `edge/Caddyfile` | единственная входная точка на порту 3001: `/orthanc/*` → Orthanc (только чтение, с пропуском просмотра: `forward_auth` на gateway `/orthanc-auth`), `/_next/image` → 404, остальное → frontend с Content-Security-Policy; доверяет `X-Forwarded-For` только от частных адресов |
| `orthanc` | `orthancteam/orthanc:26.8.2` | DICOM-архив с плагинами DICOMweb и Stone Web Viewer; сетевой DICOM-приём выключен; basic auth |
| `backup` | `backup/` (postgres:16.13 + rsync + rclone) | ночной дамп, зеркало на второй диск, шифрованная копия в облако, воскресная проверка восстановления |
| `egress` | `egress/` (alpine + tinyproxy), профиль `egress` | HTTP-прокси со своим адресом в домашней сети (macvlan); роутер гонит этот адрес через VPN; используется для зарубежных сервисов ИИ, для Telegram — только если `TELEGRAM_PROXY` не равен `direct`; пропускает только адреса из `egress/filter` |
| `watchdog` | `watchdog/` (alpine + curl + jq) | раз в `WATCHDOG_INTERVAL` секунд опрашивает `http://gateway:3000/health?deep=1` по сети стека, пишет в Telegram о падении и деградации, пингует `HEALTHCHECKS_URL` |

Отдельно от стека, на сервере сайта: `samples/` (Node 22 без зависимостей) принимает обезличенные образцы бланков от экземпляров, у которых задан `LAB_SAMPLES_URL`. С данными пациента он не связан, см. `samples/README.md`.

Настольная версия (`desktop/`, Tauri 2) запускает те же gateway и frontend встроенным Node на `127.0.0.1`, с базой PGlite вместо контейнера Postgres и без остальных сервисов: [DESKTOP.md](DESKTOP.md).

Данные на дисках (не в базе): `DATA_DIR` (`/data` в gateway, внутри контейнера путь задаёт `DTC_DATA_DIR`: `uploads/<sha256>.pdf`, `uploads/pending/`, `uploads/milestones/`; читает и пишет только `lib/files.js`), `DICOM_DIR` (папки дисков, только чтение), `ORTHANC_DIR` (хранилище Orthanc), `BACKUP_DIR`, `MIRROR_DIR`, `RCLONE_DIR`.

## Потоки данных

```mermaid
flowchart LR
  subgraph Internet
    Phone[Телефон / браузер]
    TG[api.telegram.org]
    OR[Сервисы ИИ]
    S3[S3-хранилище, rclone crypt]
  end
  subgraph Router[Домашний роутер]
    PF[443 → сервер]
    VPN[VPN для устройства egress]
  end
  subgraph Server[NAS или сервер, docker compose]
    Proxy[HTTPS-прокси: Caddy или nginx]
    Edge[edge :3001]
    FE[frontend :3001]
    GW[gateway :3000]
    ING[ingestion :8000]
    PG[(postgres)]
    ORT[orthanc :8042]
    BK[backup]
    EG[egress :8888]
    Files[(DATA_DIR<br/>DICOM_DIR<br/>ORTHANC_DIR)]
    Backups[(BACKUP_DIR<br/>MIRROR_DIR)]
  end
  Phone -- HTTPS --> PF --> Proxy --> Edge
  Phone -- в LAN --> Edge
  Edge -- "/orthanc/*" --> ORT
  Edge -- остальное --> FE
  FE -- "/api/gateway/*" --> GW
  GW --> PG
  GW -. "PDF, профиль python" .-> ING
  GW --> Files
  GW -- REST --> ORT
  ORT --> Files
  GW -- HTTP proxy --> EG -- VPN --> VPN
  GW -- "Telegram напрямую (TELEGRAM_PROXY=direct)" --> TG
  VPN --> OR
  WD[watchdog] -- "/health?deep=1" --> GW
  WD -- напрямую --> TG
  BK --> PG
  BK --> Files
  BK --> Backups
  BK -. rclone crypt .-> S3
```

Путь запроса с телефона: браузер → HTTPS `https://medcontrol.example.com` → роутер (проброс 443) → HTTPS-прокси на сервере (Caddy, nginx или прокси роутера) → `edge:3001` → `frontend:3001` → серверный маршрут Next.js `/api/gateway/[...path]` → `gateway:3000`. В домашней сети можно открывать `edge:3001` напрямую (`BIND_ADDR=0.0.0.0`). Порт 3000 gateway наружу не публикуется вообще (Docker на некоторых NAS игнорирует привязку к 127.0.0.1 и пробрасывает порт в сеть); frontend ходит в gateway по внутренней compose-сети, проверки по SSH делаются через `docker compose exec gateway wget -qO- http://127.0.0.1:3000/health`.

Внешний HTTPS-прокси (Caddy, nginx, прокси роутера) держит сертификат и отдаёт хост на `edge:3001`. Его конфиг не входит в этот репозиторий: опишите его рядом со своим `.env`, чтобы при поломке HTTPS снаружи не чинить по памяти.

Frontend прокси прокладывает заголовок `Authorization` (JWT из `localStorage` браузера) и `x-forwarded-for`, ждёт ответа gateway до 480 с и пропускает тело до 25 МБ (edge — до 30 МБ). Исключение — `POST /import/archive`: архив до 2 ГБ. На сервере edge отправляет этот путь прямо в gateway, минуя Next (сервер Next обрывает любой запрос через 5 минут), и пропускает до 2 ГБ; в настольной версии прокси Next передаёт его потоком без чтения в память. Пути `/health` и `/health?deep=1` прокси не пропускает (404): наружу открыты только `/health/import` и `/health/status`, сторож ходит к gateway напрямую. WebAuthn сверяет origin с `APP_URL`.

**IP клиента.** Edge доверяет только частным прокси (`trusted_proxies static private_ranges`, `trusted_proxies_strict`) и передаёт frontend заголовок `X-Forwarded-For` с настоящим адресом клиента. Gateway доверяет `X-Forwarded-For` только из частных сетей (`trustProxy`: `127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`). Поэтому замок от перебора и логи видят адрес клиента, а не роутера. В логе запроса URL пишется без query-строки.

**Сети.** `default` — сеть стека с закреплённой подсетью (`STACK_SUBNET`): frontend, gateway, edge, backup, watchdog, egress. `data` — внутренняя (`internal: true`, без выхода в интернет): Postgres, Orthanc, парсер `ingestion`; к ней подключены и те, кто к ним ходит (gateway, edge, backup). Парсер PDF и база поэтому не могут ничего отправить наружу, даже если в них найдут уязвимость.

Исходящий трафик gateway к ИИ идёт напрямую или, если задан `EGRESS_PROXY=http://egress:8888`, через прокси (`lib/egress.js`, `undici ProxyAgent`): нужно там, где провайдер модели не принимает адреса страны пользователя. Через тот же `egressFetch` уходит и образец бланка на `LAB_SAMPLES_URL`. Telegram ходит своим путём (`telegramFetch`): `TELEGRAM_PROXY` перекрывает `EGRESS_PROXY` только для Telegram, `TELEGRAM_PROXY=direct` — напрямую. Если прокси задан и упал, `lib/telegram.js` пробует прямой маршрут. Сторож шлёт тревоги через `TELEGRAM_PROXY_WATCHDOG` (обычно `direct`), а при неудаче через прокси — напрямую: тревога о падении VPN не должна зависеть от VPN. Контейнер `egress` подключён к двум сетям: обычной compose-сети и macvlan с адресом `EGRESS_IP` в домашней подсети; macvlan — маршрут по умолчанию (`gw_priority`), поэтому роутер видит его как отдельное устройство и заворачивает в VPN. tinyproxy принимает соединения только из подсети стека (`Allow 172.31.250.0/24` в `egress/tinyproxy.conf`, значение по умолчанию `STACK_SUBNET`), только на порты 80/443 и только к адресам из белого списка `egress/filter` (каждая строка с якорями `(^|\.)хост$`: сам адрес и его поддомены, но не похожее имя): сейчас `openrouter.ai`, `api.anthropic.com`, `api.openai.com`, `api.deepseek.com`, `api.telegram.org`, `api.ipify.org`. Список действует и для HTTP, и для HTTPS.

## Модель данных

Схема — в `db/migrations/001…036`. Все таблицы привязаны к `users.id`; пользователь один, с фиксированным uuid `00000000-0000-0000-0000-000000000001` (`lib/auth.js`). У пользователя язык и региональные форматы: `users.locale`, `users.prefs` (миграция 031, [I18N.md](I18N.md)). Даты календарных сущностей хранятся как `date`, моменты — `timestamptz`; «день» считается в часовом поясе пользователя (`users.timezone`, Настройки → «Язык, регион, часовой пояс»; `lib/dates.js`, запасное значение `DEFAULT_TZ` = `Europe/Moscow`): маршруты берут его из токена сессии, планировщик и бот из базы.

**Лента.** `events` — единая хронология (тип `MED_ADMIN`, `INFUSION`, `LAB_RESULT`, `IMAGING`, `CONSULT`, `SYMPTOM`, `MILESTONE`, `NOTE`, …, `occurred_at`, `title`, `tags`, `meta` jsonb, `source`). `meta` (миграция 019) заменяет позиционные `tags`: `{status}` у приёма, `{kind, tone}` у вехи, `{agent}` у капельницы. Пишет в ленту только `lib/feed.js`. `attachments` (файл по `file_url`, `sha256`, `mime_type`, `filename`) привязаны к событию; один файл на событие один раз (уникальный индекс `event_id, sha256`).

**Анализы.**
- `ingest_documents` — один PDF (`sha256`, `lab_name`, `doc_date`, `source`: `mknc_pdf_v1` / `helix_pdf_v1` / `hadassah_pdf_v1` / `dnkom_pdf_v1` / `ai_pdf_v1` / `manual`, `event_id`); `ingest_observations_raw` — строки как в документе, до нормализации.
- `lab_tests` — тесты, встреченные в документах (`code`, `name`, `category`, `canonical_key`); `lab_catalog` — справочник маркеров, заливается из `lib/catalogSeed.js` при старте (ключ, имя, категория, каноническая единица, порядок, `is_key`).
- `lab_results` — числовые результаты (`test_id`, `document_id`, `collected_at`, `value_numeric`, `unit_original`, `unit_canonical`, `ref_low/high` как в бланке, `lab_name`, `source_event_id`).
- Нормы (миграция 032, [REFERENCE-RANGES.md](REFERENCE-RANGES.md)): справочные в `lab_catalog` (`ref_low_default/ref_high_default`, `_m`, `_f`), свои в `lab_ref_overrides`, пол в `users.sex`. Представление `lab_results_eff` отдаёт результаты с действующей нормой (`ref_low`, `ref_high`, `ref_source`) и нормой бланка (`lab_ref_low/high`); всё чтение результатов идёт через него, запись в `lab_results`.

**Препараты.** Расписание приёма в `regimen_items`: `frequency_rule` (`DAILY`, `WEEKLY` с `schedule_days` — ISO-дни недели, `EVERY_N_DAYS` с `interval_days` от даты начала режима; миграция 030), логика в `lib/schedule.js`, серия приёма в `lib/medsStreak.js`. `medications` (`name`, `role`: `systemic` — основной препарат, `support` — поддержка; `instructions` — правила приёма; `sort_order`) → `regimens` (курс с `start_date`/`end_date`) → `regimen_items` (доза, расписание, `remind_at` — своё время напоминания в Telegram, `times_per_day`). `administrations` — строка на приём: `day` и `dose_no` (1…`times_per_day`, миграция 035; миграция 036 дописала недостающие приёмы дням, отмеченным до 035, с пометкой «до отметок по приёмам»; уникальный индекс `user_id, medication_id, day, dose_no`; `status`: `TAKEN` / `SKIPPED` / `PAUSED` / `MISSED` / `PLANNED`, `taken_at`, `event_id`, `notes` с источником отметки). Состояние дня из отметок считает `lib/medsDays.js` (одно правило для серии, календаря, напоминаний, отчёта врачу, профиля и файла для ИИ): все приёмы `TAKEN` → `TAKEN`, часть → `PARTIAL`, иначе `PAUSED`, `SKIPPED`. `dose_changes` — история дозы по `regimen_item_id` (`effective_from`, `dose_value`, `reason`); доза на день берётся по ней (`medsRecord.doseOn`).

**Вехи и снимки.** `milestones` (`date`, `kind`: surgery / radiation / histology / imaging / consult / document / other / ai_review, `tone`: positive / negative / neutral, `title`, `notes`, `event_id`) — файлы через `attachments` события. `imaging_studies` (`study_date`, `modality`, `body_region`, `impression_text`, `response`: CR / PR / SD / PD / NA, `dicom_path`, `milestone_id`, `orthanc_study_id`, `study_instance_uid`) → `lesions` (`name`, `location`, `is_target`, `retired`) → `lesion_measurements` (`study_id`, `lesion_id`, `size_mm`, `note`). `dicom_imports` — что и когда импортировано из `DICOM_DIR` (по папке).

**Тексты документов.** `attachment_extracts` (миграции 023, 025) — извлечённый текст любого вложения (заметки, вехи, отчёты врача), ключ `user_id, sha256`: `method` (`pdf_text`: текстовый слой, `ocr`: распознано на месте, `llm`: переписано моделью), `model`, `text`, плюс аннотация `summary`, `summary_model`, `summary_at` («Кратко»). Повторное извлечение сбрасывает аннотацию. Когда удаляется последняя ссылка на файл, `extracts.releaseFile` удаляет и файл, и текст.

**Заметки.** `notes` (миграция 021: `title`, `body` в Markdown, `tags text[]`, `url` только http(s), `source`: manual / import, `source_name`, `pinned`, `event_id`) — каждая заметка ещё и событие `NOTE`, файлы через `attachments` события, тексты файлов в `attachment_extracts`. Комментарий ИИ к заметке — `ai_comments` с `subject_type = 'note'`.

**Дневник, Apple Health и тревоги.** `symptom_entries` — одна строка на день (шкалы, температура, давление, вес, `pulse`, `steps`, заметка; `unique(user_id, date)`). `health_samples` (миграция 024) — сырые образцы из Apple Health (`kind`: blood_pressure, weight_body_mass, body_temperature, heart_rate, resting_heart_rate, step_count, …; `ts`, `value` jsonb, `source`; `unique(user_id, kind, ts)`), из них `healthImport.js` собирает поля дневника по дням. `alerts` — сработавшие правила (`status`: `OPEN` / `ACK` / `RESOLVED`, `triggered_at`, `context` jsonb с `dedup`, `severity`, `message`, `href`); пороги по анализам живут в протоколе лечения, правила по дневнику в коде (`lib/alerts.js`).

**Приёмы и капельницы.** `appointments` (`date`, `time`, `doctor`, `place`, `notes`, `status`: planned / done / cancelled, `questions`, `questions_context`, `questions_model`, `report_milestone_id` → `milestones`). `infusion_agents` (справочник: `name`, `short_name`, `default_dose`, `dose_unit`, `route`, `active`) → `infusion_sessions` (`date`, `time`, `dose_value`, `duration_min`, `place`, `reaction`, `route` — способ введения сеанса, по умолчанию из справочника, миграция 028; `course_id`, `event_id`). `infusion_courses` (миграция 020: `agent_id`, `title`, `planned_count`, `cadence_days`, `start_date`, `status`: active / done / cancelled, `remind`, `notes`). Способы введения: «в/в капельно», «в/в струйно», «в/м», «п/к», «другое».

**Служебное.** `app_settings` — ключ-значение (список ключей ниже). Выбор сервиса и моделей ИИ отсюда перекрывает `.env`, а ключи сервисов, Telegram, пароль и время напоминаний, заданные в `.env`, наоборот, важнее. `anamnesis_versions` (миграция 020: `text`, `source`: initial / manual / ai_draft / restore, `note`) — история анамнеза; текущий текст лежит в `app_settings.anamnesis`. `ai_comments` (`subject_type`: lab_document / labs_month / imaging_study / note, `subject_id`, `model`, `text`, `usage`, `context`). `ai_questions` (то же плюс `question`, `answer`; `subject_type` из `aiAsk.SUBJECTS`: lab_document, labs_month, imaging_study, infusions, note, chat; у чата `subject_id` это ветка разговора). `notifications` (`kind`, `ref`, `sent_at`, `text`) — что уже отправлено в Telegram. `passkeys` — учётные данные WebAuthn. `schema_migrations` — применённые миграции.

**Ключи `app_settings`, которые читает и пишет код:**

| Ключ | Кто пишет | Что хранит |
|---|---|---|
| `llm_provider`, `llm_model`, `llm_model_fast` | Настройки → ИИ (`routes/ai.js`) | выбор провайдера и моделей, перекрывает `.env` |
| `anamnesis` | `lib/anamnesis.js` | текущий анамнез (версии — в `anamnesis_versions`) |
| `anamnesis_brief` | `routes/report.js` | кэш краткого анамнеза для отчёта врачу |
| `token_version` | «Выйти везде» (`lib/auth.js`) | номер поколения токенов; старые токены отклоняются |
| `integration_token_hash`, `integration_token_created` | Настройки → Apple Health (`lib/auth.js`) | sha256 ключа интеграции и дата его создания; сам ключ не хранится |
| `health_last_import` | `lib/healthImport.js` | время и итог последнего приёма данных из Apple Health |
| `tg_offset` | `lib/telegramBot.js` | offset long-polling бота, переживает рестарт |
| `treatment_protocol` | `lib/protocol.js` | JSON протокола лечения |
| `llm_base_url`, `llm_yandex_folder` | Настройки → ИИ (`routes/ai.js`) | адрес «Своего адреса» и каталог Yandex Cloud |
| `cfg_*` | `lib/config.js` (мастер, Настройки) | ключи сервисов ИИ, токен и chat id Telegram; значение из `.env` важнее |
| `auth_password_hash` | `lib/setup.js` | хэш scrypt из мастера первого запуска; `auth_login` остаётся только у старых установок, внутреннее имя учётной записи |
| `auth_recovery_hash`, `auth_recovery_created` | `lib/recovery.js` | хэш кода восстановления и дата его создания |
| `remind_dose_at`, `remind_dose_again_at`, `lab_stale_days` | `lib/reminderTimes.js` | время напоминаний и порог «давно не было анализов» |
| `mcp_enabled`, `mcp_enabled_at` | `lib/mcpAccess.js` | доступ для ИИ-агентов включён и когда |
| `patient_*` | `lib/patientCard.js` | карточка пациента (см. таблицу модулей) |
| `home_quiet_resumed` | `lib/homeHuman.js` | тихий режим вернули кнопкой на главной |

В экспорт ZIP не попадают секреты (`lib/exportFilter.js`): ключи сервисов ИИ, токен и chat id бота, хэш пароля — по списку `SECRETS` в `lib/config.js` и по имени (`token`, `secret`, `api_key`, `auth_key`, `password`, `…_hash`), а из остальных таблиц — столбцы `…_hash` (хэши токенов MCP).

**Полнотекстовый поиск.** Миграция 027 создаёт GIN-индексы по выражению `to_tsvector('russian', …)`: `notes` (заголовок + текст), `milestones` (заголовок + заметки), `attachment_extracts` (аннотация + текст), `imaging_studies` (метод, область, заключение), `appointments` (врач, место, заметка, вопросы), `symptom_entries` (заметка), `ai_comments`, `ai_questions` (вопрос + ответ), `infusion_sessions` (заметка, реакция, место). `lib/search.js` строит запрос `websearch_to_tsquery('russian', …)` с теми же выражениями, плюс `ilike` по названиям (контакты, препараты, документы анализов).

**Мёртвые таблицы.** Из первой миграции остались три таблицы, которые код не читает и не пишет: `infusions` (сеансы живут в `infusion_sessions`), `alert_rules` (правила в протоколе лечения и в коде; колонка `alerts.rule_id` всегда пустая), `audit_log`. Их стоит убрать отдельной миграцией.

## Карта модулей gateway

`gateway/src/server.js` — старт: `trustProxy` только для частных сетей, логгер без query-строки в URL, плагины (cors, jwt, multipart 20 МБ, swagger при `ENABLE_DOCS=1`), общий обработчик ошибок (`CoreError` ядра → 400/404/409 с прежним телом `{ error, message? }`, таймаут → 504 `timeout`, недоступная сеть → 502 `network`), миграции, загрузка каталога и настроек, реканонизация и перенормировка единиц (отключается `RECANONICALIZE_ON_START=0`), создание пользователя, `/health`, регистрация роутов, запуск планировщика и бота. `migrate.js` — то же для командной строки. `tools/appleHealthXml.js` — разовый импорт истории из `export.xml` Apple Health (читает stdin построчно).

### `lib/`

Ядро живёт в `lib/`, маршруты в `routes/` тонкие: схема запроса, пользователь и часовой пояс из токена, вызов функции ядра. Переведены препараты (`meds.js`), исследования (`imaging.js`) и вехи (`milestones.js`).

| Файл | Что делает |
|---|---|
| `aiAsk.js` | уточняющие вопросы к записи: контекст предмета + профиль + прошлый комментарий + прошлые вопросы; картинки исследования |
| `alerts.js` | тревоги: пороги по анализам из протокола лечения (декларативные правила), фиксированные правила по дневнику, нормализация единиц, вставка без дублей |
| `anamnesis.js` | анамнез с историей версий: сохранение (новая версия только при изменении текста), список, восстановление |
| `anamnesisAi.js` | черновик обновлённого анамнеза по полному досье |
| `appointments.js` | приёмы у врача: CRUD, «накопилось с прошлого визита», вопросы от ИИ, отчёт врача как веха-консультация |
| `attachmentsStore.js` | сохранение файла в область `uploads/milestones` хранилища файлов и строка `attachments`; mime по расширению, если телефон прислал octet-stream |
| `auth.js` | вход, JWT, второй шаг с passkey, вход по ключу без пароля, управление ключами (добавление и удаление — с паролем), ключ интеграции, «Выйти везде», `authenticate`, `authenticateIntegration` |
| `backupStatus.js` | чтение `/backups/status.json` и строка для Telegram/Настроек |
| `canonical.js` | приведение названий показателей к каталогу, категории, индекс каталога |
| `catalogSeed.js` | справочник маркеров: ключ, имя, категория, единица, алиасы и регулярки |
| `claude.js` | прямой клиент Anthropic (SDK: таймаут 240 с, одна повторная попытка), схема разбора заключения, structured output |
| `dates.js` | дни в часовом поясе пользователя (`DEFAULT_TZ`) |
| `db.js` | пул Postgres; `date` читается как строка `YYYY-MM-DD`. При `DB_DRIVER=pglite` (настольная версия) вместо него `pglite.js`: PGlite в том же процессе, база в `PGLITE_DIR` (по умолчанию `DTC_DATA_DIR/pgdata`), фасад с тем же `query`/`connect`/`end`, результаты как у `pg` (`rowCount`, `bigint` и `numeric` строкой, сессия в UTC); у PGlite одно соединение, поэтому транзакция держит замок, а `pool.query` из кода внутри транзакции выполняется в ней, вложенная транзакция — точка сохранения. Транзакции только через `transaction(async (client) => …)`: `BEGIN`/`COMMIT`/`ROLLBACK` внутри, `abort(value)` откатывает и возвращает `value` (так выходят с «не найдено»). Работа после фиксации (разбор текста, удаление файлов) идёт после `await transaction(…)` |
| `patientCard.js` | карточка пациента для шапки отчёта врачу и главного экрана: `patient_name`, `patient_birth`, `patient_diagnosis`, `patient_call_name` (как обращаться), `patient_kept_by` (`self` или `relative`), `patient_photo` (JPEG 160×160 как data URL, уменьшается в браузере, `ui/Avatar.tsx`), `patient_moments` (вехи и серия дней) в `app_settings` (`GET/PUT /settings/patient`, `routes/patient.js`); ИИ получает только возраст и диагноз |
| `goodNews.js` | хорошие новости для главного экрана за 60 дней: последняя веха с тоном `positive` и ключевой показатель, вернувшийся в норму; чистая часть `goodNewsFrom()` |
| `homeHuman.js` | человечная часть главного экрана: `GET /home/human` (`routes/home.js`) отдаёт хорошие новости, тихие вехи (`momentsFrom()`: дни терапии, годовщины, серия приёмов) и тихий режим (`quietFrom()`: 14 дней после вехи с тоном `negative` или выключено в карточке, `patient_moments`); `POST /home/quiet/resume` возвращает их (`home_quiet_resumed`) |
| `hostGuard.js` | настольная версия: gateway отвечает только на `Host` `127.0.0.1`/`localhost` (свой порт или без порта), иначе 403 — защита от DNS rebinding |
| `importArchive.js` | загрузка архива обратно: только при пустой установке (`import_not_empty`), таблицы в порядке внешних ключей одной транзакцией, `user_id` заменяется на пользователя установки, пути файлов переписываются под её папку данных (в том числе пути Windows), строки с путём вне `uploads` отбрасываются; строки справочников, которые новая установка уже завела сама (каталог капельниц, коды анализов), сопоставляются по уникальному ключу, и ссылки дочерних таблиц переписываются на них; файлы пишутся до транзакции с данными; не грузит `users`, `passkeys`, `mcp_*`, справочник, из настроек только анамнез, протокол и карточка пациента (`patient_*`) |
| `exportFilter.js` | что «Архив всех данных» не выгружает: секретные настройки и столбцы `…_hash` |
| `dossierExport.js` | «Файл для ИИ»: все данные одним Markdown для приложения Claude или ChatGPT; ответы ИИ (если включены) помечены |
| `sberTls.js` | `sberFetch`: доверие корневому сертификату Минцифры (`src/certs/russian_trusted_root_ca.pem`, отпечаток закреплён в тесте) только для `ngw.devices.sberbank.ru` и `gigachat.devices.sberbank.ru` |
| `egress.js` | `egressFetch` через `EGRESS_PROXY` (ИИ), `telegramFetch` через `TELEGRAM_PROXY` или напрямую при `direct`, внешний IP |
| `errors.js` | `CoreError` — ожидаемые ошибки ядра (`invalid`, `notFound`, `conflict`) без привязки к HTTP; сервер превращает их в ответ, локальная сборка покажет текст из словаря |
| `ocr.js` | распознавание сканов и фото на месте: tesseract.js (WebAssembly) с моделями `rus` и `eng` из npm, картинки страниц PDF достаёт pdf.js без canvas; одна задача за раз, до 20 страниц |
| `extractMethod.js` | подпись способа получения текста вложения (`pdf_text`, `ocr`, `llm`) для промптов и выгрузок |
| `aiPrompts.js` | системные подсказки по языкам из `locales/<язык>/server/aiPrompts.json`: `prompt`, `patientPrompt` (общая вводная и задача) |
| `aiFormat.js` | даты и числа в текстах для ИИ: формат языка подсказки, без настроек пользователя, `aiNumber`, `aiDate` |
| `extracts.js` | тексты вложений по sha256: текстовый слой PDF (`pdfEngine.js`), для сканов и фото переписывание моделью, если сервис видит картинки, иначе распознавание `ocr.js` (режим `ocr` всегда распознаёт на месте), аннотация «Кратко», автоизвлечение при загрузке, тексты для ИИ, `releaseFile` (удаляет файл и текст, когда на файл больше нет ссылок) |
| `files.js` | хранилище пользовательских файлов: `put`, `read`, `readText`, `stream`, `exists`, `remove`, `list`, `refOf`. Область — подпапка `DATA_DIR` (`uploads`, `uploads/milestones`, `uploads/pending`), ссылка — абсолютный путь, его и хранит `attachments.file_url`. Остальной код не работает с `node:fs` напрямую; исключения — серверные `config.js` (секрет JWT), `backupStatus.js`, `migrate.js`, `orthanc.js` (импорт DICOM) |
| `feed.js` | единственное место, которое пишет ленту `events`: `addEvent`, `updateEvent`, `deleteEvent`, `eventMeta` |
| `healthImport.js` | приём образцов Apple Health в `health_samples` и свёртка по дням в дневник (давление максимальное, вес последний, температура максимальная, пульс покоя или средний, шаги суммой); статус последнего приёма |
| `healthParse.js` | чистые парсеры: JSON Health Auto Export и строки `export.xml` (тестируются) |
| `imaging.js` | ядро исследований: обзор (исследования с файлами и измерениями, очаги, RECIST), создание и правка исследования вместе с вехой и событием ленты, удаление с файлами, очаги, измерения, разбор заключения моделью (`parseStudyReport`, модель подменяется в тестах) |
| `imagingAi.js` | комментарий к исследованию, сохранение разбора заключения, объяснение среза |
| `infusions.js` | справочник с путём введения, журнал сеансов (`route`), курсы (`dueCourses` для напоминаний, статус курса по числу сеансов), события ленты («Капельница» / «Укол»), стартовые позиции |
| `labSample.js` | образец бланка: текст PDF с сохранением строк, всё лишнее закрыто по белому списку (`labSampleWords.js` и каталог), цифры случайные, даты одни и те же; `routes/labSample.js` ничего не хранит |
| `labDisplay.js` | значения анализов в единицах пользователя (СИ или традиционные, `shared/units.js`): ответы API, выгрузки и отчёт пересчитывают на выходе, своя норма на входе |
| `labsAi.js` | комментарий к документу анализов: контекст с историей показателей |
| `labsAiParse.js` | разбор PDF любой лаборатории моделью в структуру (черновик) |
| `labParsers/` | JS-версия встроенных парсеров (`helixPdfV1.js`, `hadassahPdfV1.js`, `dnkomPdfV1.js`, `mkncPdfV1.js`, реестр `index.js`, `parseLabText`), порт `ingestion/app/connectors`; `py.js` — семантика строк и чисел Python, чтобы результат совпадал байт в байт на общих фикстурах |
| `labsCommit.js` | приём PDF: встроенные парсеры (`pdfEngine.js`) → при неудаче ИИ-черновик; запись события, документа, сырых строк, результатов, тревог; черновики `pending`; ручной ввод (`commitManual`, `POST /labs/manual`, источник `manual`, без файла) |
| `labsMonthly.js` | итог месяца: контекст за месяц и полгода истории, сохранение как оценки и вехи `ai_review` |
| `labsQuery.js` | общие SQL-куски для сводной, серий, экспорта |
| `labsSummary.js` | сводная «показатель × месяц» (худшее или последнее за месяц, число анализов в ячейке); одна функция для экрана, Excel, PDF и CSV |
| `llm.js` | вызовы сервисов ИИ (см. `llmProviders.js`), выбор модели по ярусам, structured output, `llmChat`, `llmPing`, поиск моделей; OpenRouter с `provider.data_collection=deny` и без reasoning |
| `loginGuard.js` | защита от перебора по адресу (IPv6 считается по /64, `ipAddr.js`), общий предохранитель входа и медленный общий предел для проверок, которые считаются только по адресу; сравнение строк за постоянное время |
| `meds.js` | ядро препаратов: список режимов с расписанием, изменение и отмена препарата, журнал приёмов, правка записи, история и смена дозы, календарь периода (`setDays`) |
| `medsRecord.js` | отметка приёма за день (общая для API и бота); `doseOn` — доза на дату по истории доз; `activeItems` — активные ежедневные препараты, основной первым; `activeDailyItem` — по id, по началу названия или основной |
| `migrate.js` | раннер SQL-миграций |
| `milestones.js` | ядро вех: список с файлами и состоянием текста, создание и правка вместе с событием ленты, удаление с файлами, пакетная загрузка (веха на файл, для КТ ещё и исследование), вложение файла, вставка текста файла в комментарий, открепление |
| `notifyUser.js` | сообщение владельцу в Telegram на его языке (`locales/<язык>/server/notify.json`): смена пароля, ключи входа, MCP; ошибка отправки не мешает запросу |
| `notes.js` | заметки: CRUD, теги, импорт `.md`, заметки для ИИ; ссылка только http(s) |
| `notesAi.js` | комментарий ИИ к заметке с профилем, текстами файлов и картинками (`ai_comments`, subject `note`) |
| `notesExtract.js` | обёртки над `extracts.js` для файлов заметки, вставка текста в заметку |
| `notesText.js` | чистые функции: разбор front matter импортируемого `.md`, выдержки (тестируются) |
| `orthanc.js` | REST-клиент Orthanc, импорт папок из `DICOM_DIR` в фоне, привязка исследований, серии, порядок срезов, рендер PNG с окнами |
| `pdfEngine.js` | кто читает PDF: gateway (`PDF_ENGINE=js`, по умолчанию) или сервис ingestion (`python`; если он не отвечает, gateway читает сам); разбор анализов, текст вложений, список парсеров, проверка здоровья |
| `pdfText.js` | текстовый слой PDF: алгоритм pypdf `extract_text()` (класс `PypdfText`) на списке операторов pdf.js, так что JS-движок даёт тот же текст, что сервис ingestion |
| `pdfBrand.js` | знак в шапке и строка со ссылкой на сайт в PDF: отчёт для врача и сводная анализов; картинка в `src/assets/` |
| `passkeys.js` | WebAuthn: rpID и origin из `APP_URL`, регистрация и вход; challenge в памяти, не больше 1000, просроченные чистятся |
| `patientProfile.js` | профиль пациента для промптов и полное досье на языке пользователя (кэш по языку), первая строка профиля — вводная протокола |
| `protocol.js` | протокол лечения: схема (zod), чтение из `app_settings.treatment_protocol` с дополнением старых записей (`normalizeProtocol`), правила для тревог, шкалы дневника, строка для ИИ |
| `protocolPresets.js` | пресеты протокола в порядке показа: общий контроль анализов (первый, действует по умолчанию), гипотиреоз, эндометриоз, ленватиниб (готовый), химиотерапия, иммунотерапия, трансплантация почки, гемодиализ, метотрексат (примеры, как и общий) |
| `diaryScales.js` | справочник шкал дневника: ключ, слова для строки в Telegram, подпись и подсказка из словаря `scales`; у первых девяти своя колонка, остальные в `symptom_entries.scales` (jsonb) |
| `symptomRow.js` | строка `symptom_entries` → запись дневника со всеми шкалами (без базы, можно импортировать в модулях промптов) |
| `medsCreate.js` | создание препарата с ежедневным режимом (общий код API препаратов и seed из протокола) |
| `recist.js` | RECIST 1.1 по целевым очагам, группы КТ/ПЭТ и МРТ |
| `scheduler.js` | минутный тикер напоминаний; тексты экранируются для HTML-режима Telegram, ошибка одной отправки не прерывает остальные |
| `settings.js` | `app_settings` в памяти |
| `recovery.js` | код восстановления пароля: 20 знаков Crockford base32 (100 бит), в `app_settings.auth_recovery_hash` только scrypt-хэш; выдаётся мастером (`POST /setup` возвращает `recoveryCode`), после сброса пароля заменяется новым; не действует при пароле из `.env` |
| `viewerSession.js` | пропуск к просмотрщику Orthanc: `POST /imaging/viewer-session` (сессия) ставит cookie `mc_viewer` (JWT `scope: 'viewer'`, 8 часов, `Path=/orthanc`, HttpOnly, SameSite=Strict); edge на каждый запрос к `/orthanc/*` спрашивает `GET /orthanc-auth` и получает basic auth Orthanc в заголовке `Authorization`; `token_version` закрывает и пропуск. Прокси Next путь `/orthanc-auth` не пропускает |
| `setupCode.js` | одноразовый код мастера первого запуска: 8 знаков base32 на запуск gateway, в журнал и `<DATA_DIR>/setup-code.txt`, сравнение за постоянное время, удаляется после мастера |
| `setup.js` | мастер первого запуска: нужен ли он, проверка пароля (`.env` или хэш в настройках), сохранение ответов (в том числе региона) |
| `referenceRanges.js` | справочник норм для взрослых (по полу и общий), в каноническую единицу показателя; при старте попадает в `lab_catalog` |
| `edition.js` | серверная или настольная редакция (`DTC_EDITION`): какие функции только на сервере, `requireFeature` (409 `server_only`) |
| `desktopEnv.js` | значения по умолчанию настольной редакции до чтения окружения другими модулями: PGlite, JS-движок PDF, `127.0.0.1`, папка данных ОС (macOS `~/Library/Application Support/MedControl`, Windows `%APPDATA%\MedControl`, Linux `~/.local/share/medcontrol`) |
| `mcpAccess.js`, `mcpTools.js`, `mcpServer.js` | доступ для ИИ-агентов по MCP: включение, токены агентов (хэши), журнал, ограничение частоты; инструменты; JSON-RPC ([MCP.md](MCP.md)) |
| `search.js` | сквозной поиск (общий для `/search` и MCP) |
| `contacts.js` | врачи и контакты (`contacts`, миграция 033): список, создание, правка части полей, удаление |
| `labRefs.js` | пол для норм и свои нормы показателей (`lab_ref_overrides`); действующая норма считается в представлении `lab_results_eff` |
| `i18n.js` | тексты, которые пишет gateway: `t(язык, 'раздел.ключ', аргументы)` на `intl-messageformat`, словари `locales/<язык>/` и `locales/<язык>/server/`, откат на русский; `relocalize()` переводит наше сообщение, сохранённое на другом языке (docs/I18N.md) |
| `eventText.js` | заголовки ленты и вех, заметки к дозам на языке читателя: записанное на другом языке пишется заново по шаблону, текст пользователя внутри не меняется |
| `llmProviders.js` | сервисы ИИ: адрес, ключ, модели по умолчанию, что читают (PDF, картинки, JSON-схема), идут ли через прокси; проверка своего адреса: не сервисы стека (в том числе с точкой на конце и по имени контейнера), не `0.0.0.0`, не link-local и адреса метаданных облаков, loopback только в настольной версии; IPv4 внутри IPv6 судится как IPv4 |
| `settingsSummary.js` | состояние всех разделов Настроек одним запросом (`GET /settings/summary`): протокол, анамнез, нормы, Telegram, Apple Health, ИИ, вход, регион, бэкап, разбор PDF — только коды, числа и даты |
| `userLocale.js` | язык и региональные настройки пользователя (`users.locale`, `users.prefs`, часовой пояс), проверка значений, `userFormat()` для текстов сервера; сам форматтер общий с фронтендом, `shared/format.js` |
| `config.js` | секреты из `.env` или из настроек (ключи ИИ, Telegram), секрет JWT из `.env` или из `DATA_DIR` |
| `password.js` | хэш scrypt и правила нового пароля: от 10 символов, не одни цифры, не ряд клавиш или букв, не распространённый пароль с цифрами по краям (встроенный список); `DTC_PASSWORD` судится по прежнему правилу, слабый даёт предупреждение в журнале |
| `streak.js` | серия приёма подряд (по году истории, паузы и дни без приёма пропускаются) |
| `schedule.js` | расписание приёма: день приёма или нет, следующий день приёма, подпись «по пн и чт» / «раз в 3 дня» на языке пользователя |
| `medsStreak.js` | серия и клетки календаря для препарата с учётом расписания |
| `symptoms.js` | дневник: одна запись на день, событие `SYMPTOM`, правила тревог при сохранении (только для последних двух дней) |
| `symptomsText.js` | чистый разбор дневника одной строкой из Telegram на русском и английском, с единицами пользователя (тестируется) |
| `telegram.js` | Bot API: отправка, кнопки, редактирование, поиск чата; при упавшем прокси пробует прямой маршрут |
| `telegramBot.js` | long-polling, команды, PDF (разбираются вне цикла опроса), кнопки; при ошибках отступает до 5 минут |
| `telegramText.js` | чистые текстовые функции бота (тестируются) |
| `textDiff.js` | построчный дифф (LCS) для версий анамнеза |
| `units.js` | семейства единиц, коэффициенты, приведение к каноническим |

### `routes/`

| Файл | Маршруты |
|---|---|
| `ai.js` | `/ai/status`, `/ai/settings`, `/ai/profile`, `/ai/chats` (ветки разговоров помощника), `/ai/anamnesis/draft`, `/ai/anamnesis/versions[/:id]`, `/ai/anamnesis/versions/:id/restore`, `/ai/questions`, `DELETE /ai/questions/:id` (одна пара вопрос-ответ), `DELETE /ai/questions?subject_type=…&subject_id=…` (весь диалог по записи), `/ai/ask`, `/ai/labs-month[/:ym]`, `/ai/comments/{lab-document,imaging-study}/:id`, `/ai/usage`, `/ai/ping`, `/ai/egress`, `/ai/models` |
| `alerts.js` | `/alerts`, `PATCH /alerts/:id`, `/alerts/recheck` |
| `appointments.js` | CRUD `/appointments`, `/appointments/:id/questions`, `/appointments/:id/report` |
| `attachments.js` | `/attachments/:sha256` — отдача файла: своим типом только PDF и картинки из списка загрузки, всё остальное как `application/octet-stream` на скачивание, всегда с `nosniff` |
| `export.js` | `/export/dossier.md` (файл для ИИ, период и галочки в query), `/export/all.zip` (все таблицы, `labs.csv`, анамнез, заметки, файлы; без `passkeys`, `schema_migrations` и секретов, см. `lib/exportFilter.js`), `GET /import/status`, `POST /import/archive` (загрузка такого архива в пустую установку, пароль в поле `password` перед файлом; ядро в `lib/importArchive.js`) |
| `health.js` | `POST /health/import` (Health Auto Export; ключ интеграции или обычная сессия, проверяются до чтения тела; тело до 25 МБ), `/health/status` |
| `imaging.js` | `/imaging`, исследования, очаги, измерения, `/imaging/studies/:id/parse` (тонкие, ядро в `lib/imaging.js`); только серверное, через Orthanc: `/imaging/orthanc[/import]`, серии, `slice`, `slices`, `slice/explain`, `/imaging/viewer-session` и `/orthanc-auth` (пропуск к просмотрщику, `lib/viewerSession.js`) |
| `infusions.js` | `/infusions` (журнал, справочник и курсы одним ответом), CRUD сеансов, `/infusions/agents[/:id]`, `/infusions/courses[/:id]` |
| `labSample.js` | `/labs/sample` (текст образца бланка, ничего не хранит), `/labs/sample/send` (отправка на `LAB_SAMPLES_URL`) |
| `labs.js` | `/labs/parsers` (список встроенных парсеров и можно ли отправлять образец), `/labs/commit-pdf`, `/labs/commit-review`, `/labs/manual`, `/labs/pending/:sha`, `/labs/summary`, `/labs/series`, `/labs/series-raw`, `/labs/overview`, `/labs/catalog`, `/labs/documents[/:id]` |
| `labsExport.js` | `/labs/export/summary.xlsx`, `summary.pdf`, `results.csv`, `observations.jsonl` |
| `meds.js` | `/meds/regimens`, `POST /meds/medications`, `PATCH /meds/medications/:id` (добавить, изменить, отменить препарат), `/meds/administrations` (+ `PUT /days` для периода, `PATCH`/`DELETE /:id`), `/meds/doses`, `/meds/streak` |
| `milestones.js` | (тонкие, ядро в `lib/milestones.js`) CRUD `/milestones`, `/milestones/batch`, вложения, `/milestones/:id/attachments/:sha256/extract[/insert]` |
| `notes.js` | CRUD `/notes`, `/notes/import`, `/notes/:id/files[/:sha256]`, `/notes/:id/files/:sha256/extract[/insert]`, `/ai/comments/note/:id` |
| `protocol.js` | `/protocol`, `PUT /protocol`, `/protocol/preset`, `/protocol/apply` |
| `home.js` | `/home/human` (хорошие новости, тихие вехи, тихий режим), `POST /home/quiet/resume` |
| `patient.js` | `GET`/`PUT /settings/patient` (карточка пациента) |
| `mcp.js` | `POST /mcp` (токен агента; 404, пока выключено), `GET`/`PUT /settings/mcp`, `POST`/`DELETE /settings/mcp/tokens` |
| `contacts.js` | `GET /contacts`, `POST /contacts`, `PATCH`/`DELETE /contacts/:id` |
| `labRefs.js` | `GET /labs/refs`, `PUT /labs/refs` (пол), `PUT`/`DELETE /labs/refs/:key` (своя норма, «как в бланке», вернуть справочник) |
| `locale.js` | `GET /settings/summary` (состояние разделов Настроек), `GET /settings/locale` (язык, форматы, часовой пояс и что можно выбрать), `PUT /settings/locale` (частичное изменение) |
| `setup.js` | `GET /edition` (без входа: редакция и недоступные функции), `GET /setup/status`, `POST /setup` (без входа, только пока пароль не задан; когда нужен — с кодом первого запуска `setupCode`, одновременный второй запрос получает 409); смена пароля — `POST /auth/password` в `lib/auth.js` |
| `notify.js` | `/notify/status`, `PUT /notify/schedule` (время напоминаний), `PUT /notify/telegram` (токен и chat id из Настроек), `/notify/telegram/discover`, `/notify/test` |
| `report.js` | `/report/doctor.pdf` |
| `search.js` | `/search?q=…` — поиск по всем источникам, фрагменты с подсветкой |
| `symptoms.js` | `/symptoms`, `/symptoms/:date` (`PUT` меняет только присланные поля, `DELETE`) |
| `timeline.js` | `/timeline` — лента с курсором |

Маршруты входа (`lib/auth.js`): `/auth/login`, `/auth/passkey/login/{options,verify}` (второй шаг), `/auth/passkey/direct/{options,verify}` (вход по ключу без пароля), `/auth/passkey/register/{options,verify}`, `/auth/passkeys[/:id]`, `/auth/integration-token` (`POST` создать, `DELETE` отозвать), `/auth/logout-all`, `/auth/me`, `/auth/password` (`GET` откуда пароль, `POST` смена), `/auth/recover` (без входа: код восстановления и новый пароль, ограничение попыток как у входа), `/auth/recovery` (`GET` есть ли код, `POST` новый код по паролю).

Без входа открыты `/health`, `/edition`, `/setup/status`, `POST /setup`, `/auth/login`, `/auth/passkey/direct/*` и `/auth/recover`. Остальные маршруты требуют JWT (`preHandler: app.authenticate`). Исключения со своей проверкой: `/health/import` принимает ещё и ключ интеграции, `/mcp` только токен агента, `/orthanc-auth` только cookie просмотрщика, `/auth/passkey/login/*` короткий токен второго шага.

## Вход и доступ

- **Пароль.** `POST /auth/login` сверяет только пароль (из `.env` или хэш scrypt из мастера первого запуска) за постоянное время. Если в базе есть passkey и `DTC_MFA` не `off`, выдаётся короткий токен (`scope: mfa`, 5 минут), который открывает только второй шаг с ключом.
- **Вход по ключу без пароля** (`/auth/passkey/direct/*`): браузер предлагает сохранённый passkey; ключ считается двумя факторами (владение + биометрия). Неудачная проверка ключа не увеличивает счётчик блокировки, а сам вход по ключу смотрит только на блокировку своего адреса, не на общий предохранитель. Иначе посторонний мог бы 25 неверными паролями закрыть владельцу вход. Вход по паролю защищён от этого меткой знакомого устройства (ниже).
- **Замок от перебора** (`loginGuard.js`): 5 неудач с одного адреса — блокировка на минуту, дальше удвоение до часа; общий предохранитель после 25 неудач со всех адресов действует на вход по паролю и по коду восстановления. Адрес — настоящий IP клиента (см. «IP клиента» выше); клиент с IPv6 считается по своей сети /64, иначе у него было бы по счётчику на каждый из её адресов.
- **Знакомое устройство.** Каждый вход (пароль, ключ, мастер, код восстановления) отдаёт вместе с сессией метку `device`: JWT со `scope: 'device'` на 400 дней, браузер хранит её в `localStorage` (`dtc_device`) и присылает при входе. Метка ничего не открывает (`authenticate` отвергает токены со `scope`), но вход с ней смотрит только на блокировку своего адреса, а не на общий предохранитель: посторонний с сотни адресов не запрёт владельца на устройстве, с которого тот уже входил. Пароль по-прежнему нужен, блокировка адреса по-прежнему действует. В метке записана версия токена: смена пароля и «Выйти везде» отменяют все прежние метки, а браузер, где пароль сменили, получает новую.
- **Проверка пароля внутри сессии** (смена пароля, ключи входа, MCP, ключ интеграции, код восстановления, загрузка архива) считается отдельным замком по адресу: чужие неудачные входы её не блокируют. Сверх него есть медленный общий предел: 20 неверных паролей за час со всех адресов, и проверка закрыта на полчаса для всех. Дойти до неё может только владелец действующей сессии, а «Выйти везде» пароля не просит и украденную сессию завершает.
- **Куда уходят данные, меняется только с паролем** (`sensitiveConfirmed` в `lib/auth.js`): сервис ИИ, «Свой адрес», ключи сервисов, каталог Yandex (`PUT /ai/settings`), токен бота и чат Telegram (`PUT /notify/telegram`). Украденного токена сессии для этого мало. Чтобы первый запуск не спрашивал пароль дважды, 15 минут после его ввода он не нужен: время ввода записано в токене (`pw`) при входе по паролю, после мастера, смены пароля и сброса кодом. Вход по одному ключу такой отметки не даёт, а токен, выданный заново при смене часового пояса, переносит прежнее время. Без пароля gateway отвечает 403 `password_required`, и экран показывает поле. Названия моделей и анамнез пароля не требуют. При смене бота или чата прежний чат сначала получает сообщение об этом.
- **Запросы входа по ключу без пароля** (`/auth/passkey/direct/options`): не чаще 10 в минуту с адреса; их challenge хранятся отдельно от challenge владельца (регистрация ключа, второй шаг входа), поэтому поток анонимных запросов не вытесняет их.
- **Добавление ключа требует пароль** (`/auth/passkey/register/options`): украденного токена сессии не хватает, чтобы закрепиться своим ключом. Удаление ключа тоже требует пароль. О добавлении и удалении приходит сообщение в Telegram.
- **Ключ интеграции** для `/health/import`: создаётся в Настройках, показывается один раз, в `app_settings` хранится только sha256. Длина от 32 символов. «Отозвать» стирает хэш. Ключ проверяется до чтения тела запроса.
- **Тело запроса без учётных данных не читается.** Прокси frontend (`api/gateway/[...path]/route.ts`, правило в `shared/proxyGuard.js`) отвечает 401 на запрос с телом без заголовка `Authorization`, не читая тело. Исключения: вход, восстановление и первый запуск, им оставлено 64 КБ.
- **Сессии.** JWT живёт `JWT_TTL` (30 дней) и лежит в `localStorage`. «Выйти» стирает его только в браузере. «Выйти везде» увеличивает `token_version`, и все ранее выданные токены отклоняются.
- **`/health` снаружи закрыт.** Прокси frontend отдаёт 404 на `/api/gateway/health` и `health?deep=1`; сторож и скрипты ходят к gateway напрямую.

## Слой ИИ

**Сервисы и ярусы** (`lib/llm.js`, таблица сервисов `lib/llmProviders.js`). Сервис: `app_settings.llm_provider` → `LLM_PROVIDER` → первый, чей ключ задан (OpenRouter, Anthropic, ChatGPT, DeepSeek, YandexGPT, GigaChat), иначе свой адрес, если он задан. Anthropic вызывается своим SDK (`claude.js`), остальные — один клиент OpenAI chat completions (`chatCompletions`): OpenRouter получает свои поля (`provider.data_collection=deny`, выключенный reasoning, `cache_control`), прочие — простые сообщения без них; у ChatGPT `max_completion_tokens`, у YandexGPT заголовок `OpenAI-Project` с каталогом, у GigaChat OAuth-токен на 30 минут (кэшируется) и корень Минцифры только для его адресов (`sberTls.js`). У каждого сервиса флаги `caps`: читает ли PDF, картинки, строгую JSON-схему; без PDF документ уходит текстовым слоем (`pdfText.js`), картинки текстовому сервису не отправляются (`model_no_files`), без схемы она передаётся в тексте. Два яруса моделей, каждая по цепочке `app_settings` → `.env` → модель сервиса по умолчанию:

- `main`: `llm_model` / `LLM_MODEL` / по сервису (`anthropic/claude-opus-5` у OpenRouter, `CLAUDE_MODEL` у Anthropic, `gpt-5`, `deepseek-chat`, `yandexgpt`, `GigaChat-2-Max`);
- `fast`: `llm_model_fast` / `LLM_MODEL_FAST` / по сервису (`anthropic/claude-sonnet-5`, `claude-sonnet-5`, `gpt-5-mini`, `deepseek-chat`, `yandexgpt-lite`, `GigaChat-2`).

Три вида вызовов: `llmChat` (текст, до 6 картинок, `maxTokens`, флаг `truncated`), `parseStructured` (файлы + JSON-схема + zod-валидация; на OpenRouter — `response_format: json_schema`, при отказе модели — схема текстом), `llmPing`. Запросы к зарубежным сервисам уходят через `egressFetch`, к российским и своему адресу — напрямую. Таймауты: OpenRouter 180 с (черновик анамнеза 420 с), Anthropic SDK 240 с с одной повторной попыткой. Прокси frontend ждёт gateway до 480 с. Таймаут превращается в 504 `timeout`, недоступная сеть в 502 `network`, интерфейс показывает текст из словаря (`locales/ru/errors.json`). На OpenRouter запросы идут с `provider.data_collection=deny` (только провайдеры, которые не хранят запросы и не учатся на них) и с выключенным reasoning; при пустом ответе одна повторная попытка с большим бюджетом.

**Промпты.** Лежат в `locales/<язык>/server/aiPrompts.json`. Общая вводная `base` (без диагноза и препарата: диагноз в анамнезе, препарат в протоколе лечения, `protocol.js`); к ней каждая функция добавляет свою задачу и формат ответа:

| Функция | Файл | Ярус | Контекст | Куда сохраняется |
|---|---|---|---|---|
| Комментарий к документу | `labsAi.js` | fast | профиль + показатели документа с историей | `ai_comments` (lab_document) |
| Итог месяца | `labsMonthly.js` | main | профиль + все результаты месяца + полгода истории ключевых маркеров + последние известные значения | `ai_comments` (labs_month) + веха `ai_review` |
| Комментарий к исследованию | `imagingAi.js` | fast | профиль + исследование, очаги, предыдущие той же зоны + картинки | `ai_comments` (imaging_study) |
| Разбор заключения | `llm.js` → `claude.js` схема | main | файл или текст, профиль «для контекста, не для извлечения» | поля исследования + `ai_comments` |
| Разбор PDF анализов | `labsAiParse.js` | main | файл | черновик в `/data/uploads/pending`, после проверки — как обычный документ |
| Объяснение среза | `imagingAi.js` | fast | профиль + исследование + PNG среза, номер и окно | не сохраняется |
| Уточняющие вопросы | `aiAsk.js` | fast | профиль + предмет + последний комментарий + прошлые вопросы (+ картинки) | `ai_questions` |
| Вопросы к приёму | `appointments.js` | main | профиль + «накопилось с прошлого визита» | `appointments.questions` |
| Черновик анамнеза | `anamnesisAi.js` | main | текущий анамнез + полное досье | ничего, пока пользователь не сохранит |
| Комментарий к заметке | `notesAi.js` | main | профиль + заметка + тексты файлов (до 60 тыс. знаков на файл, 120 тыс. всего) + картинки | `ai_comments` (note) |
| Текст скана или фото | `extracts.js` | fast | файл (сервисам без зрения — распознанный на месте текст, `ocr.js`) | `attachment_extracts.text` (`method = llm` или `ocr`) |
| Аннотация «Кратко» | `extracts.js` | fast | извлечённый текст (до 60 тыс. знаков) | `attachment_extracts.summary` |
| Чат с помощником | `aiAsk.js` | fast, с «Подробно» main | профиль + открытая страница + ветка разговора | `ai_questions` (chat) |
| Краткий анамнез для отчёта | `routes/report.js` | fast | анамнез | `app_settings.anamnesis_brief` (кэш) |

**Сохранённый контекст.** Точный текст пользовательского сообщения модели пишется рядом с ответом: `ai_comments.context`, `ai_questions.context`, `appointments.questions_context`. Интерфейс показывает его как «Что видела модель». Системная вводная не сохраняется — она в коде.

## Фоновые задачи

Все живут внутри процесса gateway, кроме бэкапа и сторожа:

- **Планировщик** (`scheduler.js`): раз в минуту (`setInterval`, первый тик через 5 с). Время и часовой пояс перечитываются на каждом тике (пояс пользователя из базы, настройки из `lib/reminderTimes.js`), поэтому их смена не требует перезапуска. Шлёт: напоминание об основном препарате в заданное время и повтор, о препаратах поддержки в их `remind_at` (без повтора), открытые тревоги, созданные за последние 2 дня и сработавшие за последние 3 дня (старые данные из Apple Health и PDF не присылают лавину), напоминания о приёмах у врача (7 дней / накануне / утром / после без отчёта), курсы капельниц в 10:00 в день по плану и потом каждый третий день, строку бэкапа 08:30 и тревогу 09:30, «давно не было анализов» по понедельникам 10:00. Тексты экранируются для HTML-режима Telegram; ошибка одной отправки не прерывает остальные в этом тике. Каждая отправка сначала проверяется по `notifications (kind, ref)`, поэтому перезапуск не дублирует сообщения; окно отправки — 3 часа после времени (1 час у бэкапных). Без токена и chat id планировщик молчит.
- **Telegram-бот** (`telegramBot.js`): бесконечный цикл `getUpdates` с `timeout: 25` (long-polling), таймаут запроса 60 с. При ошибке пауза 10 с, дальше удваивается до 5 минут; в лог пишется первая ошибка и ошибки на максимальной паузе. `offset` хранится в `app_settings.tg_offset`. Обрабатывает сообщения и нажатия кнопок только из `TELEGRAM_CHAT_ID`. Отметки приёма идут через тот же `medsRecord.recordDose`, что и сайт (доза — на дату отметки); PDF — через тот же `labsCommit`, разбор идёт вне цикла опроса, поэтому кнопки «Принято» не ждут ИИ. Кнопки черновика анализов несут префикс sha256 из 16 символов (лимит Telegram 64 байта на `callback_data`).
- **Импорт DICOM** (`orthanc.js`): запускается по кнопке, выполняется в фоне в том же процессе, один импорт за раз; обходит папку, распознаёт DICOM по сигнатуре `DICM`, шлёт каждый файл в Orthanc `POST /instances` (Orthanc сам дедуплицирует), затем привязывает исследования. Прогресс — в памяти и в `dicom_imports`. При перезапуске gateway незавершённый импорт нужно запустить заново («Импортировать заново»).
- **Бэкап** (`backup/backup-loop.sh`): цикл `sleep 30`, в минуту `BACKUP_AT` выполняет: дамп `pg_dump -Fc` + `tar` каталога `/data` (без `jwt.secret` и `setup-code.txt`) + копия `.env` → ротация до `BACKUP_KEEP`; `rsync` в `/mirror` (если задан `MIRROR_DIR`); `rclone sync` в `CLOUD_REMOTE` (если задан и есть `rclone.conf`; remote не типа crypt получает копию, но в журнале, в утренней строке Telegram и в Настройках появляется предупреждение, что она не зашифрована); в `RESTORE_TEST_DOW` — восстановление в базу `<db>_restore_test` и сравнение счётчиков. Работает с `umask 077`. После каждого шага переписывает `/backups/status.json` с правами 644: gateway работает не от root и читает его через том `/backups` только на чтение. Поэтому сама папка `BACKUP_DIR` на NAS должна быть 711, а не 700.
- **Сторож** (контейнер `watchdog`, `watchdog/watchdog.sh`): раз в `WATCHDOG_INTERVAL` секунд (300) опрашивает `http://gateway:3000/health?deep=1` по сети стека. Два провала подряд — «🚨 МедКонтроль не отвечает», восстановление — «✅ снова отвечает», новый список `degraded` — «⚠️ есть проблемы» (повтор раз в сутки). При успехе пингует `HEALTHCHECKS_URL`. Telegram: сначала через `TELEGRAM_PROXY_WATCHDOG` (или `EGRESS_PROXY`), при неудаче напрямую; `direct` — сразу напрямую.
- **При старте gateway**: миграции под advisory lock, загрузка каталога маркеров, реканонизация `lab_tests.canonical_key` и приведение единиц старых строк, загрузка `app_settings`, создание пользователя.

## Развёртывание

Прод — любой хост с Docker (NAS, домашний сервер, VPS), например `/srv/medcontrol/app`, `docker compose` с `.env` рядом. Образы собираются на месте.

Доставка кода — один скрипт с рабочей машины (подробно в [OPERATIONS.md](OPERATIONS.md)):

```bash
DEPLOY_HOST=user@server scripts/release.sh   # git archive origin/main → сервер → sh scripts/deploy.sh <sha>-<время>
```

`scripts/deploy.sh` (POSIX sh: на многих NAS нет bash) работает с `umask 077`: дамп базы в `backups/predeploy/<tag>.dump` (5 последних), `docker compose build` с новым `IMAGE_TAG`, запись тега в `.env` и `.deploy/previous`, `docker compose up -d --remove-orphans`, затем `up -d --force-recreate --no-deps edge` (Caddyfile примонтирован одним файлом, после распаковки у него новый inode, и без пересоздания edge работал бы со старым конфигом), ожидание `/health`, печать `/health?deep=1`, удаление образов кроме текущего и предыдущего. Откат — `scripts/rollback.sh`. Миграции применяются сами при старте gateway (каталог `db/migrations` смонтирован в контейнер).

Сборка: в Dockerfile `apk add --no-scripts`, потому что песочница сборки на некоторых NAS убивает триггер busybox (signal 9) и образ не собирается.

Образы gateway и frontend собираются из корня репозитория (`build: { context: ., dockerfile: gateway/Dockerfile }`), чтобы взять общий код `shared/` (форматирование дат и чисел, единицы) и словари `locales/` ([I18N.md](I18N.md)); корневой `.dockerignore` пропускает в контекст только `gateway/`, `frontend/`, `shared/` и `locales/` без `node_modules`. И в образе gateway, и в сборке frontend `/shared` и `/locales` лежат рядом с `/app`, поэтому относительные пути те же, что в репозитории. Словари интерфейса попадают в сборку Next, gateway читает `locales/` с диска во время работы (`lib/i18n.js`), разделы из `locales/<язык>/server/` во фронтенд не попадают. Остальные образы собираются из своих папок.

Доступ снаружи: доменное имя (свой домен или динамический DNS роутера), проброс 443 на сервер, где HTTPS-прокси (Caddy, nginx, прокси роутера) отдаёт хост на `edge:3001`. Если ИИ или Telegram недоступны напрямую, устройство `egress` (`EGRESS_IP`) в роутере переводится на VPN.

**Инструменты** (`gateway/src/tools/`): `appleHealthXml.js` — импорт истории из `export.xml` Здоровья; `demoSeed.js` — демо-данные вымышленной пациентки (запускает `scripts/demo.sh`); `comparePdfText.js` — сравнение двух движков PDF на одном бланке (текстовый слой и разбор); `refsTable.js` — таблица справочника норм для `docs/REFERENCE-RANGES.md`.

## Переменные окружения

Из `.env.example`, `docker-compose.yml` и кода. Пустое значение = функция выключена.

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `dtc` / `dtc` / `dtc` | учётка и база Postgres |
| `DATABASE_URL` | `postgres://dtc:dtc@postgres:5432/dtc` | строка подключения gateway |
| `DB_DRIVER` | `pg` | `pglite` — база внутри gateway (PGlite) вместо сервера Postgres, для настольной версии; `DATABASE_URL` тогда не нужен |
| `PGLITE_DIR` | `DTC_DATA_DIR/pgdata` | папка базы PGlite; `memory://` — в памяти (тесты) |
| `GATEWAY_HOST`, `GATEWAY_PORT` | `0.0.0.0`, `3000` | где слушает gateway; в настольной редакции по умолчанию `127.0.0.1` (`lib/desktopEnv.js`) |
| `DTC_EXIT_WITH_PARENT` | | `1` — остановиться, когда закрыт stdin (так настольное приложение останавливает gateway на всех ОС) |
| `INGESTION_URL` | `http://ingestion:8000` | адрес сервиса парсеров |
| `PDF_ENGINE` | `js` | кто читает PDF: `js` (pdf.js в gateway) или `python` (ingestion, нужен ещё профиль `python`); см. [LAB-PARSERS.md](LAB-PARSERS.md), «Два движка» |
| `LAB_SAMPLES_URL` | | куда отправлять обезличенный образец бланка; пусто: отправки нет, только копирование ([LAB-PARSERS.md](LAB-PARSERS.md), «Образец бланка») |
| `LAB_SAMPLES_TOKEN` | | ключ чтения образцов для `scripts/lab-samples.mjs` у мейнтейнера; gateway его не читает |
| `DTC_EDITION` | `server` | `desktop` — настольная версия: выключает Apple Health, DICOM, бэкапы, passkey и прокси, интерфейс показывает их «только в серверной версии» ([DESKTOP.md](DESKTOP.md)) |
| `DTC_MCP` | | `off` — запретить доступ для ИИ-агентов на этом сервере ([MCP.md](MCP.md)) |
| `DTC_PASSWORD` | | пароль единственного пользователя; пусто — мастер первого запуска (`lib/setup.js`), хэш в `app_settings.auth_password_hash` |
| `JWT_SECRET` | | секрет подписи сессий; пусто — создаётся в `DATA_DIR/jwt.secret` (`lib/config.js`) |
| `JWT_TTL` | `30d` | срок сессии |
| `DTC_MFA` | `on` | `off` отключает шаг с passkey |
| `DTC_SETUP_CODE` | (авто) | код первого запуска (`lib/setupCode.js`): по умолчанию нужен, когда `APP_URL` или `BIND_ADDR` не loopback; `on`/`off` — принудительно |
| `DTC_BIND_ADDR` | `${BIND_ADDR:-127.0.0.1}` | compose передаёт `BIND_ADDR` в gateway, чтобы тот знал, открыт ли сайт в сеть |
| `WEBAUTHN_ORIGINS` | | дополнительные origin для passkey через запятую |
| `APP_URL` | `http://localhost:3001` | адрес сайта: ссылки в Telegram, домен для passkey, заголовок для OpenRouter |
| `OPENROUTER_API_KEY` | | ключ OpenRouter; иначе из мастера (`app_settings.cfg_openrouter_api_key`) |
| `ANTHROPIC_API_KEY` | | ключ Anthropic (прямой доступ); иначе из мастера |
| `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `YANDEX_API_KEY`, `GIGACHAT_AUTH_KEY`, `LLM_CUSTOM_API_KEY` | | ключи остальных сервисов ИИ; в compose не перечислены, попадают через `env_file`; иначе из Настроек (`cfg_*`) |
| `YANDEX_FOLDER_ID` | | каталог Yandex Cloud для YandexGPT |
| `GIGACHAT_SCOPE` | `GIGACHAT_API_PERS` | область GigaChat; для юрлиц `GIGACHAT_API_CORP` |
| `LLM_BASE_URL` | | «Свой адрес»: OpenAI-совместимый API (Ollama, LM Studio) |
| `LLM_PROVIDER` | | `openrouter`, `anthropic`, `openai`, `deepseek`, `yandex`, `gigachat`, `custom`; пусто: первый, чей ключ задан |
| `LLM_MODEL` | `anthropic/claude-opus-5` | основная модель |
| `LLM_MODEL_FAST` | `anthropic/claude-sonnet-5` | быстрая модель (в compose не передаётся, попадает в gateway через `env_file`) |
| `CLAUDE_MODEL` | `claude-opus-5` | основная модель для провайдера Anthropic |
| `EGRESS_PROXY` | | `http://egress:8888` — исходящий прокси для ИИ (и Telegram, если `TELEGRAM_PROXY` не задан) |
| `TELEGRAM_PROXY` | | прокси только для Telegram в gateway; `direct` — напрямую, без VPN |
| `TELEGRAM_DIRECT` | | `1` — то же, что `TELEGRAM_PROXY=direct` (в compose не передаётся, только через `.env`) |
| `TELEGRAM_PROXY_WATCHDOG` | `EGRESS_PROXY` | прокси для сообщений сторожа; `direct` — напрямую |
| `COMPOSE_PROFILES` | | необязательные сервисы через запятую: `python` (сервис `ingestion`), `dicom` (Orthanc), `watchdog` (сторож), `egress` (прокси через VPN) |
| `COMPOSE_PROJECT_NAME` | `medcontrol` | имя проекта Docker; нужно, только если у старой установки тома называются по папке ([UPDATE.md](UPDATE.md)) |
| `EGRESS_PARENT`, `EGRESS_SUBNET`, `EGRESS_GATEWAY`, `EGRESS_IP`, `EGRESS_MAC` | `eth0`, `192.168.1.0/24`, `192.168.1.1`, `192.168.1.60`, `02:dc:00:00:00:60` | macvlan для egress; интерфейс сервера, смотрящий в домашнюю сеть |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | | бот и единственный обслуживаемый чат; иначе из мастера (сторожу нужны в `.env`) |
| `REMIND_DOSE_AT`, `REMIND_DOSE_AGAIN_AT` | пусто (`11:00`, `20:00` из Настроек) | напоминания о приёме; заданное здесь закрепляет время, обычно оно меняется в Настройках → Telegram (`lib/reminderTimes.js`, `remind_dose_at`, `remind_dose_again_at` = `off` — без повтора) |
| `LAB_STALE_DAYS` | пусто (`28` из Настроек) | порог «давно не было анализов»; так же, как время напоминаний |
| `ORTHANC_URL` | `http://orthanc:8042` | адрес Orthanc для gateway |
| `ORTHANC_USER`, `ORTHANC_PASSWORD` | `dtc` / пусто | basic auth Orthanc; браузеру не отдаётся: просмотрщику её подставляет edge после проверки пропуска; без пароля Orthanc (профиль `dicom`) не стартует, архив снимков выключен |
| `DICOM_DIR` | volume `dicomdata` | папки дисков (например, `/srv/medcontrol/dicom`) |
| `ORTHANC_DIR` | volume `orthancdata` | хранилище Orthanc (например, `/srv/medcontrol/orthanc`) |
| `DATA_DIR`, `PG_DIR` | volumes `dtcdata`, `pgdata` | файлы и база (например, `/srv/medcontrol/data`, `/srv/medcontrol/pgdata`) |
| `BACKUP_DIR` | `../medcontrol-backups` | ночные копии: по умолчанию папка рядом с папкой кода, не внутри (например, `/srv/medcontrol/backups`); gateway видит путь как `BACKUP_DIR_SHOWN` для карточки бэкапов |
| `BACKUP_AT`, `BACKUP_KEEP` | `03:30`, `14` | время и число копий |
| `MIRROR_DIR` | volume `mirrordata` | второй диск (например, `/mnt/disk2/medcontrol-backup`) |
| `RCLONE_DIR`, `CLOUD_REMOTE` | volume, пусто | папка с `rclone.conf` и имя remote rclone с двоеточием. `scripts/cloud-setup.sh` создаёт `yc-crypt:`, но подойдёт любой remote из `rclone.conf`; чтобы копия была зашифрована, он должен быть типа crypt |
| `RESTORE_TEST_DOW` | `Sun` | день недели проверки восстановления |
| `WATCHDOG_INTERVAL` | `300` | период проверки сторожа, секунды |
| `WATCHDOG_LANG` | `ru` | язык сообщений сторожа: `ru` или `en`; настроек пользователя он не видит |
| `HEALTHCHECKS_URL` | | адрес пинга внешнего сервиса (healthchecks.io, UptimeRobot heartbeat) |
| `IMAGE_TAG` | `dev` | тег образов `dtc/<сервис>`; пишет `scripts/deploy.sh`, руками не править |
| `APP_PORT` | `3001` | порт приложения на хосте |
| `ENV_FILE` | `.env` | какой файл gateway читает как env-файл; `scripts/demo.sh` подставляет `scripts/demo.env`, чтобы демо не видело настоящих ключей |
| `BIND_ADDR` | `127.0.0.1` | на каком адресе хост слушает порт приложения 3001 (edge); на сервере в домашней сети `0.0.0.0`. Порт 3000 gateway не публикуется |
| `STACK_SUBNET` | `172.31.250.0/24` | подсеть compose-сети; только из неё egress-прокси принимает соединения (адрес записан в `egress/tinyproxy.conf`, при другой подсети его надо поменять там же). Сеть не internal: gateway и frontend могут выйти в интернет и напрямую |
| `ENABLE_DOCS` | `0` | `1` включает Swagger на `/docs` (только локально) |
| `TZ` | `Europe/Moscow` | часовой пояс контейнеров backup, watchdog и orthanc: по нему считается время `BACKUP_AT`, день `RESTORE_TEST_DOW`, даты в именах копий и время в сообщениях сторожа. С поясом пользователя из Настроек не связан, для своего пояса задайте в `.env`, например `TZ=Europe/Berlin` |
| `MIGRATIONS_DIR` | `/app/migrations` | где gateway ищет миграции (задано в compose) |
| `DTC_DATA_DIR` | `/data` | путь к файлам внутри контейнера gateway. Отдельное имя, потому что `DATA_DIR` из `.env` — путь на NAS и попадал в контейнер через `env_file` |
| `BACKUP_STATUS_FILE` | `/backups/status.json` | откуда gateway читает статус бэкапа |
| `GATEWAY_INTERNAL_URL` | `http://gateway:3000` | куда прокси frontend шлёт запросы (задано в compose) |
| `RECANONICALIZE_ON_START` | | `0` пропускает реканонизацию при старте |

## Миграции

Обычные SQL-файлы `db/migrations/NNN_name.sql`. Gateway при старте берёт advisory lock, применяет ещё не записанные в `schema_migrations` файлы по порядку номеров, каждый в своей транзакции. При ошибке — откат этого файла, в логе `migration failed: <файл>`, gateway не стартует (и compose будет его перезапускать, пока файл не исправят).

Правила:
- следующий номер, одна тема на файл;
- идемпотентность: `create table if not exists`, `add column if not exists`, `alter type … add value if not exists`, `update` с условием — миграцию должно быть безопасно прогнать дважды;
- только добавляющие изменения (новые таблицы, колонки, индексы), чтобы старый код продолжал работать на новой схеме и можно было откатить образ без отката базы;
- справочные данные (каталог маркеров, стартовые капельницы) — не в миграциях, а в коде с upsert при старте.

Применить вручную: `cd gateway && DATABASE_URL=… node src/migrate.js` (каталог — `MIGRATIONS_DIR`).

## Тесты

Тесты gateway на `node:test`, без внешних фреймворков.

- **Юнит** (`gateway/test/*.test.js`, `npm test`): чистые модули без базы — правила тревог, каталог и коды анализов (в том числе «10*9/л» и мочевые единицы), даты, словарь ошибок (у каждого кода в маршрутах и ядре есть текст в `locales/ru/errors.json`), словари интерфейса (`i18n.test.js`: одинаковые ключи и переменные ICU во всех языках, каждый раздел подключён во фронтенде, строк с кириллицей в коде интерфейса не больше, чем в `frontend/i18n-baseline.json`), общий форматтер `shared/format.js` (регионы, 12/24 часа, первый день недели, календарные дни без сдвига по поясу), запрет `'ru-RU'` и `toLocale*String` в коде интерфейса, разбор Apple Health, `llm`, замок от перебора, заметки (импорт `.md`), протокол лечения, пароль и секрет JWT, RECIST, дневник одной строкой, тексты бота, единицы.
- **Интеграционные** (`gateway/test/integration/*.test.js`, `npm run test:integration`): каждый файл создаёт свою одноразовую базу `dtc_test_<имя>_<pid>` через `TEST_DATABASE_URL` (подключение с правом создавать базы), применяет миграции, загружает каталог и настройки, удаляет базу после себя. Файлы для `DTC_DATA_DIR` пишутся во временную папку. Покрыто: миграции на пустой базе, запись анализов, планировщик с подменёнными часами, бот с подменённым транспортом, курсы капельниц и тревога «IVC без G6PD», версии анамнеза, заметки и извлечение текста, Apple Health, поиск, протокол лечения. Без `TEST_DATABASE_URL` интеграционные тесты пропускаются. С `TEST_DB=pglite` вместо Postgres каждый файл получает свою PGlite в памяти (`TEST_DATABASE_URL` не нужен); CI гоняет набор в обоих режимах.
- **CI** (`.github/workflows/ci.yml`, на push в `main` и на каждый PR): gateway — `npm test` и `npm run test:integration` с сервисом `postgres:16`; frontend — `typecheck` и `build`; ingestion — установка зависимостей, `compileall`, импорт приложения и pytest парсеров на общих фикстурах. Мержить только с зелёным CI.

Не покрыто: сами HTTP-маршруты (ядро препаратов, исследований и вех тестируется без HTTP), экспорт ZIP, отказы LLM, фронтенд, парсеры на настоящих бланках (нужны обезличенные PDF).

## Где что лежит на сервере (пример раскладки)

| Путь | Что |
|---|---|
| `/srv/medcontrol/app` | код (`docker-compose.yml`, `.env` с правами 600, `gateway/`, `frontend/`, …); `.deploy/current` и `.deploy/previous` — теги образов; `backups/predeploy/<tag>.dump` — дампы перед деплоем (5 последних) |
| `/srv/medcontrol/data` | `DATA_DIR`: `uploads/<sha256>.pdf` (анализы), `uploads/milestones/` (файлы вех, срезы), `uploads/pending/` (черновики ИИ) |
| `/srv/medcontrol/pgdata` | база Postgres; руками не трогать |
| `/srv/medcontrol/backups` | `<дата_время>/db.dump`, `uploads.tar.gz`, `env`; `status.json`. Папка 711, копии 700/600, `status.json` 644 (его читает gateway) |
| `/srv/medcontrol/rclone` | `rclone.conf`, `CRYPT-KEY.txt` (перенести в менеджер паролей и удалить) |
| `/srv/medcontrol/dicom` | папки дисков с КТ/МРТ (общая папка, кладётся по SMB); не давать к ней доступ другим контейнерам |
| `/srv/medcontrol/orthanc` | хранилище Orthanc (пересобирается импортом) |
| `/mnt/disk2/medcontrol-backup` | второй диск: `backups/`, `dicom/` |
