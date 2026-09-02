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
- structured Russian addresses и T1-кандидатные поля;
- печатное превью черновика;
- Integration JSON;
- `/app/billing` — тариф, usage и безопасная история payment metadata;
- `/app/privacy` — self-service JSON export и заявка на удаление аккаунта без мгновенного destructive delete.

### Backend / production safety

- private gateway за nginx;
- Supabase JWT/JWKS auth (`RS256/ES256`);
- `EPD_DEPLOYMENT_MODE=production` физически требует Supabase auth;
- canonical document reload через Supabase Data API под **USER JWT**;
- RLS `auth.uid() = user_id` остаётся авторитетной;
- browser Integration JSON не является источником для внешнего operator-call;
- local Kontur UserDataXml preview;
- server-only Kontur `GenerateTitleXml` boundary;
- sandbox route принимает только `{documentId}`;
- separate pre-auth/user/external rate limits;
- privacy-safe audit без body/XML/PII/tokens;
- SHA-256 idempotency по document revision;
- persistent metadata-only `operator_attempts` journal через restricted PostgreSQL role;
- `/api/operator/send` жёстко возвращает `503 operator_send_disabled`;
- `/healthz` — liveness;
- `/api/system/version` — release/commit/build time;
- `/api/system/readiness` — только технический baseline, не legal/XSD/operator-production readiness;
- private dependency smoke-check проверяет Supabase JWKS и Data API;
- production deploy exact-match'ит migration registry и SHA-256;
- production deploy требует свежий реально читаемый encrypted backup;
- `server-day` отказывается собирать dirty git checkout и сверяет runtime release/commit с исходником.

## Биллинг foundation

Предварительные тарифы:

```text
Старт      990 ₽ / мес      50 новых черновиков
Бизнес   2 490 ₽ / мес     500 новых черновиков
Команда  4 990 ₽ / мес    2000 новых черновиков
```

Реализованы trial, read-only entitlement, monthly usage, DB quota trigger, metadata-only payment ledger, provider-event idempotency, restricted `epd_billing_writer`, SECURITY DEFINER boundary `verified event -> active entitlement` и column-level browser payment history.

Пока намеренно:

```text
billing_settings.enforcement_enabled = false
EPD_BILLING_PROVIDER=none
```

Деньги не списываются. Checkout, verified provider webhook и чеки ещё не подключены. Success redirect не считается подтверждением оплаты.

## Данные аккаунта

Migration `202609020006_account_deletion_requests.sql` добавляет request-only lifecycle:

- пользователь читает только свои заявки;
- пользователь может создать только собственную `pending` заявку;
- одновременно разрешена одна активная `pending/in_review` заявка;
- browser не имеет `UPDATE`/`DELETE` к заявкам;
- browser не может удалить `auth.users` или server-owned journals;
- фактическое удаление **не запускается автоматически**, пока не определены retention rules.

Self-service JSON export `epd-light/account-data-export-v1` собирается через обычные RLS-права аккаунта и не включает access/refresh tokens, `service_role`, operator token, DB credentials или другие server secrets.

Подробнее: [`docs/PRIVACY-DATA-LIFECYCLE.md`](docs/PRIVACY-DATA-LIFECYCLE.md).

## Быстрый local запуск

```bash
npm install
npm run preflight
npm run dev
```

Local gateway:

```env
EPD_DEPLOYMENT_MODE=local
EPD_OPERATOR_MODE=disabled
EPD_GATEWAY_AUTH_MODE=disabled
EPD_BILLING_PROVIDER=none
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
EPD_BILLING_PROVIDER=none
EPD_BACKUP_MAX_AGE_HOURS=30
```

`deploy/server-day.sh` берёт release из `package.json`, commit из чистого git checkout, добавляет UTC build time и после запуска сверяет `/api/system/version`.

## Миграции

Актуально **9 migration-файлов**:

```text
supabase/migrations/202609010001_init.sql
supabase/migrations/202609010002_extend_directories_t1.sql
supabase/migrations/202609010003_operator_attempts.sql
supabase/migrations/202609020001_billing_foundation.sql
supabase/migrations/202609020002_gateway_writer_role.sql
supabase/migrations/202609020003_billing_payment_events.sql
supabase/migrations/202609020004_billing_entitlement_function.sql
supabase/migrations/202609020005_billing_payment_event_column_privileges.sql
supabase/migrations/202609020006_account_deletion_requests.sql
```

Production migration flow:

```bash
export EPD_MIGRATION_CONFIRM=APPLY_MIGRATIONS
npm run db:migrate
unset EPD_MIGRATION_CONFIRM
npm run db:migrations:check -- .env.production
```

Guarded runner делает encrypted backup до/после и сохраняет SHA-256 применённых файлов. `db:migrations:check` ничего не меняет и требует exact match checkout ↔ production registry, поэтому старый checkout не запускается поверх более новой схемы.

## Backup / recovery

```bash
npm run backup:create
npm run backup:verify -- /absolute/path/backup.dump.enc
npm run backup:readiness -- .env.production
```

`backup:readiness` требует свежий `epd-light-*.dump.enc`, SHA-256 sidecar, возраст не больше `EPD_BACKUP_MAX_AGE_HOURS` и успешные decrypt + `pg_restore --list`.

Restore drill — только отдельная test/staging DB:

```bash
export EPD_RESTORE_TEST_CONFIRM=RESTORE_TEST_ONLY
npm run backup:restore:test -- /absolute/path/backup.dump.enc
unset EPD_RESTORE_TEST_CONFIRM
```

## Runtime checks

```text
GET /healthz                       -> процесс gateway жив
GET /api/system/version            -> какой release/commit/build реально запущен
GET /api/system/readiness          -> технический configuration baseline
npm run db:migrations:check -- .env.production
npm run backup:readiness -- .env.production
npm run deploy:dependencies:check
```

`/api/system/readiness` специально сообщает `technicalReadinessOnly=true` и `legalReadinessClaimed=false`.

## Kontur sandbox

После получения sandbox access:

```env
EPD_OPERATOR_PROVIDER=kontur
EPD_OPERATOR_MODE=sandbox
EPD_KONTUR_BOX_ID=...
EPD_KONTUR_ACCESS_TOKEN=...
```

Flow:

```text
Browser documentId
 -> JWT/JWKS
 -> USER JWT + RLS canonical reload
 -> ownership
 -> idempotency/persistent claim
 -> UserDataXml
 -> Kontur GenerateTitleXml
 -> metadata-only journal
```

Sandbox не выполняет signing/PostMessage.

## Проверки

```bash
npm run preflight
npm run privacy:test
npm run deploy:env:test
npm run build-info:test
npm run dependency:test
npm run readiness:test
npm run web-security:test
npm run audit:test
npm run authorization:test
npm run repository:test
npm run attempt-repository:test
npm run attempt-client:test
npm run idempotency:test
npm run billing:test
npm run billing-payment:test
npm run billing-payment-client:test
npm run billing-env:test
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

Коммиты через текущий GitHub connector historically не запускали Actions автоматически, поэтому зелёный CI нельзя утверждать без реального workflow run.

## Что ещё нужно до коммерческого запуска

- production data/auth/backend в РФ-контуре;
- реальный sandbox/partner доступ оператора;
- актуальные XSD/UserDataXsd и проверка mapping;
- первый реальный `GenerateTitleXml` на вымышленных данных;
- signing architecture, затем отдельно `PostMessage`/statuses;
- выбрать payment provider, реализовать verified checkout/webhook и чеки;
- только после payment smoke-test включить billing enforcement;
- offsite backups + restore drills + monitoring;
- retention matrix и server-controlled deletion processor;
- финальные правовые документы и ответы ФНС/Минтранса/РКН.

## Документация

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/BACKEND-GATEWAY.md`](docs/BACKEND-GATEWAY.md)
- [`docs/OPERATOR-INTEGRATION.md`](docs/OPERATOR-INTEGRATION.md)
- [`docs/BILLING.md`](docs/BILLING.md)
- [`docs/BACKUP-RECOVERY.md`](docs/BACKUP-RECOVERY.md)
- [`docs/PRIVACY-DATA-LIFECYCLE.md`](docs/PRIVACY-DATA-LIFECYCLE.md)
- [`docs/FNS-ETRN-MAPPING.md`](docs/FNS-ETRN-MAPPING.md)

## Официальные ссылки

- ФНС — транспортный ЭДО: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/edotransp/
- ФНС — операторы ИС ЭПД: https://www.nalog.gov.ru/rn77/oedo/oisepd/
- ФНС — форматы: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/approved_formats/16631750/
- Минтранс — ГИС ЭПД: https://www.mintrans.gov.ru/activities/376
- Диадок API — ЭТрН: https://developer.kontur.ru/doc/diadoc-api/instructions/documents/formal/waybill.html

## SPA source

Основной SPA временно хранится в `src/app-chunks/App.*.part`. `predev/prebuild` собирает их в игнорируемый `src/App.tsx`.
