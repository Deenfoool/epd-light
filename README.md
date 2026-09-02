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

### Backend / production safety

- private gateway за nginx;
- Supabase JWT/JWKS auth (`RS256/ES256`);
- runtime production guard: `EPD_DEPLOYMENT_MODE=production` не запускается с auth disabled;
- canonical document reload через Supabase Data API под **USER JWT**;
- RLS `auth.uid() = user_id` остаётся авторитетной;
- browser Integration JSON не является источником для внешнего operator-call;
- local Kontur UserDataXml preview;
- server-only Kontur `GenerateTitleXml` boundary;
- sandbox endpoint принимает только `{documentId}`;
- отдельные pre-auth/user/external rate limits;
- privacy-safe audit без body/XML/PII/tokens;
- SHA-256 idempotency по document revision;
- persistent metadata-only `operator_attempts` journal через restricted PostgreSQL role;
- история safe operator metadata на карточке документа;
- `/api/operator/send` жёстко возвращает `503 operator_send_disabled`;
- `/healthz` — только liveness процесса;
- `/api/system/version` — public-safe release/commit/build time запущенного gateway;
- `/api/system/readiness` — технический baseline без утверждений о юридической/XSD/operator-production готовности;
- production readiness требует traceable git commit/build time;
- private dependency smoke-check проверяет реальный Supabase JWKS и Data API `billing_plans` без публикации URL/ключей/response body;
- production deploy сверяет checkout и registry всех SQL-миграций по SHA-256;
- production deploy требует свежий зашифрованный backup, который проходит checksum, decrypt и `pg_restore --list`.

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
- monthly usage + DB quota trigger;
- metadata-only `billing_payment_events` ledger;
- provider-event idempotency;
- restricted `epd_billing_writer` capability-role;
- SECURITY DEFINER boundary `verified event -> active entitlement`;
- runtime-role не может напрямую `UPDATE subscriptions`;
- column-level SELECT для browser payment history;
- история safe payment metadata в `/app/billing`.

Пока намеренно:

```text
billing_settings.enforcement_enabled = false
EPD_BILLING_PROVIDER=none
```

Деньги не списываются, checkout/provider webhook/чеки не подключены, отсутствие оплаты никого не блокирует. Success redirect не считается подтверждением платежа.

## Быстрый local запуск

```bash
npm install
npm run preflight
npm run dev
```

Без cloud env данные работают в demo/localStorage.

Local gateway:

```env
EPD_DEPLOYMENT_MODE=local
EPD_OPERATOR_MODE=disabled
EPD_GATEWAY_AUTH_MODE=disabled
EPD_BILLING_PROVIDER=none
```

## Production baseline

```env
EPD_RELEASE=0.1.0
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

`deploy/server-day.sh` сам получает текущий git commit, ставит UTC build time в Compose и после запуска сверяет `/api/system/version` с исходным checkout. Если commit нельзя определить, production deploy останавливается.

Production gateway сам откажется стартовать без Supabase auth. Billing checker не позволит случайно включить ещё не реализованный payment adapter.

## Миграции

Актуально **8 migration-файлов**:

```text
supabase/migrations/202609010001_init.sql
supabase/migrations/202609010002_extend_directories_t1.sql
supabase/migrations/202609010003_operator_attempts.sql
supabase/migrations/202609020001_billing_foundation.sql
supabase/migrations/202609020002_gateway_writer_role.sql
supabase/migrations/202609020003_billing_payment_events.sql
supabase/migrations/202609020004_billing_entitlement_function.sql
supabase/migrations/202609020005_billing_payment_event_column_privileges.sql
```

Production migration flow:

```bash
export EPD_MIGRATION_CONFIRM=APPLY_MIGRATIONS
npm run db:migrate
unset EPD_MIGRATION_CONFIRM
npm run db:migrations:check -- .env.production
```

Guarded runner делает encrypted backup до/после, хранит SHA-256 применённых migration-файлов и запрещает незаметно переписывать уже применённые миграции.

`db:migrations:check` ничего не меняет в БД. Он требует, чтобы:

- каждый локальный migration-файл был зарегистрирован в `public.epd_light_schema_migrations`;
- SHA-256 совпадал;
- число зарегистрированных миграций точно совпадало с checkout;
- в production не было более новой миграции, отсутствующей в текущем коде.

Последний пункт защищает от случайного запуска старого checkout поверх более новой схемы БД.

## Runtime checks

Разные проверки имеют разный смысл:

```text
GET /healthz                      -> процесс gateway жив
GET /api/system/version           -> какой release/commit/build time реально запущен
GET /api/system/readiness         -> безопасный технический configuration baseline
npm run db:migrations:check -- .env.production -> код и production schema registry совпадают
npm run backup:readiness -- .env.production     -> существует свежий реально читаемый encrypted backup
npm run deploy:dependencies:check              -> реальная доступность Supabase Auth JWKS + Data API/migrations
```

`/api/system/readiness` специально возвращает `technicalReadinessOnly=true` и `legalReadinessClaimed=false`.

Перед Docker launch `server-day` выполняет private network smoke-check:

```text
Supabase /auth/v1/.well-known/jwks.json
 -> опубликован хотя бы один asymmetric key

Supabase /rest/v1/billing_plans
 -> Data API доступен
 -> billing foundation migration реально видна
```

В ошибках этой проверки не печатаются URL, ключ API и body ответа.

## Persistent operator journal

Gateway runtime использует отдельный restricted PostgreSQL login:

```env
EPD_GATEWAY_DATABASE_URL=postgresql://epd_gateway:PASSWORD@DB_HOST:5432/DB_NAME
EPD_GATEWAY_DATABASE_ROLE=epd_gateway_writer
EPD_OPERATOR_ATTEMPT_STALE_MS=300000
```

Browser JWT может только читать свои safe metadata из `operator_attempts`. Journal не хранит XML, document payload и tokens.

## Billing payment boundary

Будущий verified webhook worker использует **третий отдельный restricted DB-login**:

```env
EPD_BILLING_PROVIDER=none
EPD_BILLING_DATABASE_URL=
EPD_BILLING_DATABASE_ROLE=epd_billing_writer
```

Он не должен совпадать ни с admin `EPD_DATABASE_URL`, ни с operator journal `EPD_GATEWAY_DATABASE_URL`.

Целевая последовательность:

```text
provider webhook
 -> verify authenticity/signature
 -> resolve user + plan server-side
 -> hash raw payload
 -> claimVerifiedEvent
 -> unique provider event id
 -> apply_verified_billing_entitlement(...)
 -> DB checks verified event/user/plan
 -> subscription active + event applied atomically
```

Runtime billing-role не имеет прямого UPDATE к subscription/payment event rows. Browser имеет RLS + column-level SELECT только к безопасной истории и не может запросить `provider_event_id`, `payload_sha256`, `user_id` или internal event id.

Raw webhook body, данные карты, CVV и provider secrets в ledger не хранятся.

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

```text
Browser documentId
 -> JWT/JWKS
 -> USER JWT + RLS canonical reload
 -> ownership
 -> SHA-256 idempotency
 -> optional persistent claim
 -> UserDataXml
 -> Kontur GenerateTitleXml
 -> journal succeeded/failed
```

Sandbox не выполняет signing/PostMessage.

## Backup/recovery

Создание и ручная проверка:

```bash
npm run backup:create
npm run backup:verify -- /absolute/path/backup.dump.enc
```

Production readiness:

```bash
npm run backup:readiness -- .env.production
```

`backup:readiness` находит самый свежий `epd-light-*.dump.enc`, требует `.sha256`, проверяет возраст по `EPD_BACKUP_MAX_AGE_HOURS` (по умолчанию 30 часов), затем реально выполняет SHA-256 verification, decrypt во временный файл и `pg_restore --list`. Plaintext-временный файл удаляется verifier'ом.

Restore drill — только отдельная test/staging DB:

```bash
export EPD_RESTORE_TEST_CONFIRM=RESTORE_TEST_ONLY
npm run backup:restore:test -- /absolute/path/backup.dump.enc
unset EPD_RESTORE_TEST_CONFIRM
```

## Проверки

```bash
npm run preflight
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

Production env / storage / network:

```bash
npm run db:migrations:check -- .env.production
npm run backup:readiness -- .env.production
npm run deploy:dependencies:check
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
- выбрать payment provider и реализовать checkout + verified webhook adapter поверх готового ledger;
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
