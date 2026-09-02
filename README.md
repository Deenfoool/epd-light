# ЭПД Лайт

MVP SaaS для подготовки, проверки и хранения **черновиков электронной транспортной накладной (ЭТрН)** для малого и среднего бизнеса.

> **Важно:** ЭПД Лайт не является оператором ИС ЭПД. Production-отправка, подписание и `PostMessage` не реализованы. Sandbox `GenerateTitleXml` не означает, что документ подписан, отправлен или зарегистрирован в ГИС ЭПД.

## Что уже есть

### Продукт

- лендинг, FAQ, CTA и тарифы;
- Supabase Auth + local demo mode;
- dashboard и документы;
- 6-шаговый мастер ЭТрН;
- справочники компаний, ТС и водителей;
- CSV import;
- draft-model v4;
- базовая валидация отдельно от operator-readiness;
- structured Russian addresses;
- T1-поля: BoxId, ContainerType, Ownership, WeighingMethod, ВУ, loading facts/details, signer;
- печатное превью с watermark черновика;
- Integration JSON.

### Operator backend

- private gateway за nginx;
- Supabase JWT/JWKS auth (`RS256/ES256`);
- **runtime production guard**: `EPD_DEPLOYMENT_MODE=production` не запускается с auth disabled;
- canonical document reload через Supabase Data API под **USER JWT**;
- RLS `auth.uid() = user_id` остаётся авторитетной;
- browser Integration JSON не является источником для внешнего operator-call;
- local Kontur UserDataXml preview;
- server-only Kontur `GenerateTitleXml` boundary;
- sandbox endpoint принимает только `{documentId}`;
- отдельные pre-auth/user/external rate limits;
- privacy-safe audit без body/XML/PII/tokens;
- SHA-256 idempotency по document revision;
- in-process concurrent duplicate collapse;
- persistent metadata-only `operator_attempts` journal через restricted PostgreSQL role;
- история safe operator metadata на карточке документа;
- `/api/operator/send` жёстко возвращает `503 operator_send_disabled`.

### Биллинг foundation

Предварительные тарифы:

```text
Старт      990 ₽ / мес      50 новых черновиков
Бизнес   2 490 ₽ / мес     500 новых черновиков
Команда  4 990 ₽ / мес    2000 новых черновиков
```

Реализованы:

- 14-дневный trial entitlement;
- read-only subscription state для browser JWT;
- monthly usage;
- PostgreSQL trigger, считающий реальные INSERT документов;
- страница `/app/billing`;
- server-side foundation для будущего enforcement.

Пока намеренно:

```text
billing_settings.enforcement_enabled = false
```

То есть деньги не списываются, checkout/webhooks/чеки не подключены, отсутствие оплаты никого не блокирует.

## Быстрый local запуск

```bash
npm install
npm run preflight
npm run dev
```

Без cloud env данные работают в demo/localStorage.

Local gateway допускает:

```env
EPD_DEPLOYMENT_MODE=local
EPD_OPERATOR_MODE=disabled
EPD_GATEWAY_AUTH_MODE=disabled
```

## Production baseline

```env
EPD_DEPLOYMENT_MODE=production
EPD_OPERATOR_PROVIDER=none
EPD_OPERATOR_MODE=disabled
EPD_GATEWAY_AUTH_MODE=supabase
EPD_AUTH_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EPD_DATA_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EPD_DATA_SUPABASE_PUBLIC_KEY=PUBLIC_ANON_OR_PUBLISHABLE_KEY
EPD_ALLOWED_ORIGINS=https://epd.example.ru
```

Production gateway сам откажется стартовать без Supabase auth.

## Миграции

Актуально 5 migration-файлов:

```text
supabase/migrations/202609010001_init.sql
supabase/migrations/202609010002_extend_directories_t1.sql
supabase/migrations/202609010003_operator_attempts.sql
supabase/migrations/202609020001_billing_foundation.sql
supabase/migrations/202609020002_gateway_writer_role.sql
```

Production:

```bash
export EPD_MIGRATION_CONFIRM=APPLY_MIGRATIONS
npm run db:migrate
unset EPD_MIGRATION_CONFIRM
```

Guarded runner:

- делает encrypted backup до миграций;
- хранит SHA-256 применённых migration-файлов;
- запрещает незаметно изменять уже применённую migration;
- делает второй encrypted backup после успеха.

## Persistent operator journal

Browser JWT может только читать свои safe metadata из `operator_attempts`.

Gateway runtime использует **отдельный restricted PostgreSQL login**:

```env
EPD_GATEWAY_DATABASE_URL=postgresql://epd_gateway:PASSWORD@DB_HOST:5432/DB_NAME
EPD_GATEWAY_DATABASE_ROLE=epd_gateway_writer
EPD_OPERATOR_ATTEMPT_STALE_MS=300000
```

`epd_gateway_writer` — NOLOGIN capability-role, создаваемая migration. Runtime login получает membership и работает через `SET LOCAL ROLE`.

`EPD_GATEWAY_DATABASE_URL` нельзя заменять административным `EPD_DATABASE_URL`.

Journal хранит только:

- UUID документа/пользователя;
- operation/provider/mode;
- revision;
- SHA-256 fingerprint/idempotency key;
- status/safe error code;
- будущие технические external IDs.

Он не хранит XML, document payload и tokens.

## Kontur sandbox

После получения реального sandbox доступа:

```env
EPD_DEPLOYMENT_MODE=production
EPD_OPERATOR_PROVIDER=kontur
EPD_OPERATOR_MODE=sandbox
EPD_GATEWAY_AUTH_MODE=supabase
EPD_KONTUR_BOX_ID=...
EPD_KONTUR_ACCESS_TOKEN=...
```

Flow:

```text
Browser sends documentId
 -> JWT/JWKS
 -> Supabase Data API with USER JWT
 -> RLS
 -> canonical documents row
 -> ownership check
 -> SHA-256 idempotency
 -> optional persistent claim
 -> UserDataXml
 -> Kontur GenerateTitleXml
 -> journal succeeded/failed
```

Sandbox не выполняет signing/PostMessage.

## Schema checks

ФНС:

```bash
npm run fns:schema:check
```

Контур после sandbox credentials:

```bash
npm run kontur:schema:check
npm run kontur:schema:save
```

Изменение версии/хэша схемы не переключает mapping автоматически.

## Backup/recovery

```bash
npm run backup:create
npm run backup:verify -- /absolute/path/backup.dump.enc
```

Restore drill — только отдельная test/staging DB:

```bash
export EPD_RESTORE_TEST_CONFIRM=RESTORE_TEST_ONLY
npm run backup:restore:test -- /absolute/path/backup.dump.enc
unset EPD_RESTORE_TEST_CONFIRM
```

Backup: custom `pg_dump` → verify → AES-256/PBKDF2 → SHA-256. Копия на том же VPS не считается полноценным offsite backup.

## Проверки

```bash
npm run preflight
npm run deploy:env:test
npm run audit:test
npm run authorization:test
npm run repository:test
npm run attempt-repository:test
npm run attempt-client:test
npm run idempotency:test
npm run billing:test
npm run rate-limit:test
npm run gateway:test
npm run kontur:userdata:test
npm run kontur:generation:test
npm run kontur:sandbox:test
```

После `npm install`:

```bash
npm run auth:test
npm run gateway:auth:test
npm run build
```

GitHub Actions поддерживает ручной `workflow_dispatch`. Коммиты через текущий GitHub connector сами CI historically не запускали, поэтому зелёный CI нельзя утверждать без реального workflow run.

## Что ещё нужно до коммерческого запуска

- production data/auth/backend в РФ-контуре;
- реальный sandbox/partner доступ оператора;
- актуальные XSD/UserDataXsd и проверка mapping;
- первый реальный `GenerateTitleXml` на вымышленных данных;
- ParseTitleXml/обратная проверка, если доступна;
- signing architecture;
- только потом `PostMessage` и operator statuses/webhooks;
- payment provider checkout + verified webhooks;
- чеки/54-ФЗ и договорная модель до реальных списаний;
- только после payment smoke-test включить billing enforcement;
- HTTPS, offsite backups, monitoring и restore drills;
- финальные правовые документы и ответы ФНС/Минтранса/РКН.

## Документация

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/BACKEND-GATEWAY.md`](docs/BACKEND-GATEWAY.md)
- [`docs/OPERATOR-INTEGRATION.md`](docs/OPERATOR-INTEGRATION.md)
- [`docs/BILLING.md`](docs/BILLING.md)
- [`docs/BACKUP-RECOVERY.md`](docs/BACKUP-RECOVERY.md)
- [`docs/FNS-ETRN-MAPPING.md`](docs/FNS-ETRN-MAPPING.md)

## Официальные ссылки

- ФНС — транспортный ЭДО: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/edotransp/
- ФНС — операторы ИС ЭПД: https://www.nalog.gov.ru/rn77/oedo/oisepd/
- ФНС — форматы: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/approved_formats/16631750/
- Минтранс — ГИС ЭПД: https://www.mintrans.gov.ru/activities/376
- Диадок API — ЭТрН: https://developer.kontur.ru/doc/diadoc-api/instructions/documents/formal/waybill.html

## SPA source

Основной SPA временно хранится в `src/app-chunks/App.*.part`. `predev/prebuild` собирает их в игнорируемый `src/App.tsx`.
