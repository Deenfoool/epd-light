# ЭПД Лайт

MVP SaaS-сервиса для подготовки, проверки и хранения **черновиков электронной транспортной накладной (ЭТрН)** для российского малого и среднего бизнеса.

> **Важно:** проект не является оператором ИС ЭПД. Production-отправка, подписание и `PostMessage` не реализованы. Даже результат sandbox `GenerateTitleXml` не является подписанным или отправленным ЭПД.

## Что уже реализовано

- публичный лендинг, FAQ, CTA, тарифы и правовые шаблоны;
- регистрация/вход через Supabase Auth и demo-режим на `localStorage`;
- dashboard, список документов и 6-шаговый мастер ЭТрН;
- автосохранение и защита от потери последних изменений;
- draft-model v4 с обратной нормализацией старых черновиков;
- базовая валидация отдельно от operator-readiness;
- печатное превью с watermark `ЧЕРНОВИК — НЕ ЯВЛЯЕТСЯ ПЕРЕВОЗОЧНЫМ ДОКУМЕНТОМ`;
- нормализованный JSON и operator-neutral `Integration JSON`;
- структурированные российские адреса;
- T1-поля: BoxId, ContainerType, Ownership, WeighingMethod, ВУ, фактическая погрузка, `LoadingPartyDetails`, `LoadingOwnerDetails`;
- справочники контрагентов, транспорта и водителей с T1-полями;
- CSV-импорт контрагентов и груза;
- private backend gateway за nginx;
- Supabase JWT/JWKS-аутентификация gateway по асимметричной подписи;
- rate limiting: отдельные лимиты до auth, после auth и для реальных внешних operator-вызовов;
- privacy-safe audit без request body, XML, токенов, ФИО и других данных документа;
- локальный `Kontur UserDataXml preview` без обращения к оператору;
- server-side canonical document repository через Supabase Data API под **пользовательским JWT**;
- RLS `auth.uid() = user_id` остаётся авторитетной проверкой доступа к документу;
- backend заново строит operator candidate из строки `documents`, а не доверяет Integration JSON из браузера;
- автоматический разбор `GetDocumentTypes (V3)` для поиска T1 `XsdUrl`/`UserDataXsdUrl`;
- server-only `GenerateTitleXml` boundary;
- **sandbox gateway route** `/api/operator/kontur/generate-title-sandbox`, который:
  - включается только при `EPD_OPERATOR_MODE=sandbox` и `EPD_OPERATOR_PROVIDER=kontur`;
  - требует проверенный Supabase JWT;
  - принимает только `{ "documentId": "..." }`;
  - перечитывает документ через Supabase RLS;
  - повторно проверяет владельца;
  - вызывает только `GenerateTitleXml`;
  - не подписывает XML;
  - не вызывает `PostMessage`;
- deterministic SHA-256 idempotency identity по `documentId + documents.updated_at + operation + operator contract`;
- параллельные повторные sandbox-запросы одного revision схлопываются в один внешний `GenerateTitleXml` внутри gateway-процесса;
- таблица `operator_attempts` подготовлена под безопасный persistent-журнал: пользователь может только читать свои metadata, но не создавать/подделывать operator outcomes;
- кнопка `Kontur sandbox` на карточке документа появляется только когда backend сообщает `ready=true`;
- `/api/operator/send` остаётся жёстко заблокированным;
- guarded database migration runner с SHA-256 registry и обязательными encrypted backup до/после миграций;
- encrypted PostgreSQL backups: custom `pg_dump` → verify → AES-256/PBKDF2 → SHA-256 → restore drill в отдельную test DB;
- Docker/HTTPS deployment-заготовки под будущий production VPS;
- SQL-миграции Supabase с Row Level Security;
- офлайн preflight и отдельные тесты auth/RLS/idempotency/Kontur/security boundaries.

## Быстрый запуск

```bash
npm install
npm run preflight
npm run dev
```

Без `.env` приложение запускается в demo-режиме. Данные хранятся в браузере.

## Supabase / PostgreSQL

Актуальные миграции:

```text
supabase/migrations/202609010001_init.sql
supabase/migrations/202609010002_extend_directories_t1.sql
supabase/migrations/202609010003_operator_attempts.sql
```

Для production не следует накатывать их вручную по одной. После настройки `EPD_DATABASE_URL` и encrypted backup env используйте guarded runner:

```bash
export EPD_MIGRATION_CONFIRM=APPLY_MIGRATIONS
npm run db:migrate
unset EPD_MIGRATION_CONFIRM
```

Runner делает encrypted backup до изменений, сверяет SHA-256 уже применённых migration-файлов, применяет каждую новую миграцию в транзакции и после изменений создаёт второй encrypted backup. Уже применённую миграцию нельзя незаметно переписать задним числом: checksum mismatch останавливает процесс.

Для production-контуров с персональными данными российских граждан размещение и архитектуру нужно отдельно сверить с применимыми требованиями российского законодательства. Практический целевой вариант проекта — PostgreSQL/Auth/backend в российском контуре.

Секреты оператора, database URL, backup passphrase и любые server-only ключи никогда не помещаются в `VITE_*`.

## Основные проверки

```bash
npm run preflight
npm run deploy:env:test
npm run audit:test
npm run authorization:test
npm run repository:test
npm run idempotency:test
npm run rate-limit:test
npm run gateway:test
npm run kontur:provider:test
npm run kontur:userdata:test
npm run kontur:generation:test
npm run kontur:sandbox:test
```

После `npm install` также доступны криптографические тесты JWT/JWKS:

```bash
npm run auth:test
npm run gateway:auth:test
```

Production-сборка:

```bash
npm run build
npm run preview
```

GitHub Actions workflow поддерживает ручной запуск: `Actions → CI → Run workflow`. Коммиты, созданные текущим GitHub App connector, сами workflow не запускают, поэтому факт зелёного CI нужно подтверждать отдельным run.

## Backup/recovery

После настройки server-only env:

```bash
npm run backup:create
npm run backup:verify -- /absolute/path/epd-light-YYYYMMDDTHHMMSSZ-PID.dump.enc
```

Restore drill разрешён только в отдельную disposable DB:

```bash
export EPD_RESTORE_TEST_CONFIRM=RESTORE_TEST_ONLY
npm run backup:restore:test -- /absolute/path/epd-light-YYYYMMDDTHHMMSSZ-PID.dump.enc
unset EPD_RESTORE_TEST_CONFIRM
```

Encrypted backup на том же VPS — только первый уровень. Копия `.dump.enc + .sha256 + .meta` должна храниться отдельно от production VPS, а passphrase — отдельно от backup-файлов.

Подробнее: [`docs/BACKUP-RECOVERY.md`](docs/BACKUP-RECOVERY.md).

## Проверка схем

Проверка опубликованной схемы ФНС:

```bash
npm run fns:schema:check
```

После получения sandbox BoxId и access token Диадока:

```bash
npm run kontur:schema:check
```

Команда через `GetDocumentTypes (V3) + GetContent` находит текущий зафиксированный T1-контракт, получает Title XSD/UserDataXsd и выводит SHA-256. Новая версия не подхватывается автоматически: изменение контракта требует ручной проверки mapping.

Сохранить схемы в игнорируемый `.cache/kontur`:

```bash
npm run kontur:schema:save
```

## Три разных уровня интеграции

### 1. Local preview

```text
Browser -> Integration JSON -> gateway -> UserDataXml preview
```

Внешнего вызова Контур нет.

### 2. Sandbox GenerateTitleXml

```text
Browser sends documentId
  -> JWT/JWKS auth
  -> rate limit
  -> Supabase Data API with USER JWT
  -> RLS
  -> canonical documents row + updated_at revision
  -> server mapping
  -> ownership check
  -> SHA-256 idempotency identity
  -> concurrent duplicate collapse
  -> UserDataXml
  -> Kontur GenerateTitleXml
```

Для намеренного включения:

```env
EPD_OPERATOR_PROVIDER=kontur
EPD_OPERATOR_MODE=sandbox
EPD_GATEWAY_AUTH_MODE=supabase
EPD_AUTH_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EPD_DATA_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EPD_DATA_SUPABASE_PUBLIC_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
EPD_KONTUR_BOX_ID=...
EPD_KONTUR_ACCESS_TOKEN=...
```

Sandbox-результат скачивается как XML, но **не подписывается и не отправляется**.

Persistent completed-attempt dedupe после рестарта процесса пока намеренно не включён: схема `operator_attempts` готова, но server-owned writer ещё должен быть реализован без выдачи browser JWT права подделывать записи журнала.

### 3. Production send

Пока отсутствует намеренно:

```text
GenerateTitleXml -> signing -> PostMessage -> operator statuses -> GIS EPD
```

`POST /api/operator/send` отвечает `503 operator_send_disabled`.

## Что нужно до коммерческого запуска

- получить реальный sandbox/партнёрский доступ выбранного оператора;
- получить актуальные XSD/UserDataXsd и зафиксировать версии/хэши;
- прогнать canonical mapping через реальный `GenerateTitleXml`;
- исправить все отклонения от UserDataXsd;
- реализовать ИП и остальные допустимые типы участников;
- решить timezone-модель для фактических времён;
- выполнить sandbox `ParseTitleXml`/обратную проверку результата;
- подключить server-owned persistent operator-attempt writer/idempotency без browser write-доступа;
- определить и реализовать signing flow;
- только после этого проектировать `PostMessage` и юридически значимые статусы;
- развернуть production-контур данных в РФ;
- настроить домен, HTTPS, offsite backups, мониторинг и recovery;
- завершить правовые документы, security-тесты и биллинг.

## Документация

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/BACKUP-RECOVERY.md`](docs/BACKUP-RECOVERY.md)
- [`docs/BACKEND-GATEWAY.md`](docs/BACKEND-GATEWAY.md)
- [`docs/OPERATOR-INTEGRATION.md`](docs/OPERATOR-INTEGRATION.md)
- [`docs/FNS-ETRN-MAPPING.md`](docs/FNS-ETRN-MAPPING.md)

## Официальные источники

- ФНС — обязательный транспортный ЭДО: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/edotransp/
- ФНС — операторы ИС ЭПД: https://www.nalog.gov.ru/rn77/oedo/oisepd/
- ФНС — форматы черновиков: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/approved_formats/16631750/
- Минтранс — ГИС ЭПД: https://www.mintrans.gov.ru/activities/376
- Диадок API — ЭТрН: https://developer.kontur.ru/doc/diadoc-api/instructions/documents/formal/waybill.html
- Диадок API — GetDocumentTypes V3: https://developer.kontur.ru/doc/diadoc-api/http/GetDocumentTypes_V3.html

## Структура SPA-исходника

Основной SPA-компонент временно хранится в `src/app-chunks/App.*.part`. Перед `npm run dev` и `npm run build` `scripts/assemble-app.mjs` собирает их в игнорируемый `src/App.tsx`.
