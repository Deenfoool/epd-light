# Развёртывание ЭПД Лайт

## Режимы

Проект разделяет три режима:

1. **Demo/local** — `EPD_DEPLOYMENT_MODE=local`, localStorage или локальная разработка; auth может быть отключена только здесь и только при выключенном operator mode.
2. **Production cloud** — `EPD_DEPLOYMENT_MODE=production`, Supabase/PostgreSQL + JWT/JWKS + private gateway, operator mode может оставаться `disabled`.
3. **Kontur sandbox** — production cloud + реальный `GenerateTitleXml`; signing и `PostMessage` всё равно запрещены.

Ключевой runtime-инвариант: при `EPD_DEPLOYMENT_MODE=production` gateway **не стартует** с `EPD_GATEWAY_AUTH_MODE=disabled`, даже если `EPD_OPERATOR_MODE=disabled`.

Billing имеет отдельный fail-closed switch: `EPD_BILLING_PROVIDER` обязан оставаться `none`, пока не реализован и не проверен конкретный payment adapter/webhook.

## 1. Local/demo

```bash
npm install
npm run preflight
npm run dev
```

Минимальный local env:

```env
EPD_DEPLOYMENT_MODE=local
EPD_OPERATOR_MODE=disabled
EPD_GATEWAY_AUTH_MODE=disabled
EPD_BILLING_PROVIDER=none
```

GitHub Pages — только UI-стенд. Реальные персональные данные туда не помещаются.

## 2. Production data/auth prerequisites

```env
EPD_DEPLOYMENT_MODE=production

VITE_SUPABASE_URL=https://YOUR_DATA_HOST
VITE_SUPABASE_ANON_KEY=PUBLIC_KEY

EPD_GATEWAY_AUTH_MODE=supabase
EPD_AUTH_SUPABASE_URL=https://YOUR_DATA_HOST
EPD_AUTH_AUDIENCE=authenticated

EPD_DATA_SUPABASE_URL=https://YOUR_DATA_HOST
EPD_DATA_SUPABASE_PUBLIC_KEY=PUBLIC_KEY

EPD_BILLING_PROVIDER=none
```

Frontend/Data API key — публичный anon/publishable key, **не `service_role`**.

Актуальные миграции — **8 файлов**:

```text
202609010001_init.sql
202609010002_extend_directories_t1.sql
202609010003_operator_attempts.sql
202609020001_billing_foundation.sql
202609020002_gateway_writer_role.sql
202609020003_billing_payment_events.sql
202609020004_billing_entitlement_function.sql
202609020005_billing_payment_event_column_privileges.sql
```

Production миграции применяются guarded runner'ом:

```bash
export EPD_MIGRATION_CONFIRM=APPLY_MIGRATIONS
npm run db:migrate
unset EPD_MIGRATION_CONFIRM
```

Runner делает encrypted backup до/после, хранит SHA-256 уже применённых migration-файлов и останавливается при попытке переписать старую миграцию задним числом.

RLS `documents_own` остаётся авторитетной:

```text
auth.uid() = user_id
```

## 3. Production env-check

```bash
cp .env.example .env.production
```

Для production обязательно поменять:

```env
EPD_DEPLOYMENT_MODE=production
EPD_GATEWAY_AUTH_MODE=supabase
```

Проверка:

```bash
set -a
. ./.env.production
set +a
npm run deploy:check
```

Checker останавливает запуск при опасных настройках, включая:

- `EPD_DEPLOYMENT_MODE != production`;
- gateway auth не `supabase`;
- HTTP вместо HTTPS;
- пустой Data API public key;
- `service_role` вместо public key;
- wildcard CORS;
- server secret/database URL в `VITE_*`;
- sandbox без Kontur BoxId/token;
- невалидные rate limits;
- небезопасные backup/restore настройки;
- использование admin DB credential как runtime gateway credential;
- повторное использование operator DB credential как billing credential;
- небезопасные restricted DB role names;
- `EPD_BILLING_PROVIDER != none` до появления verified provider adapter.

```bash
npm run deploy:env:test
```

## 4. Restricted operator journal DB login

Persistent idempotency для внешних operator-вызовов опционально использует отдельный runtime PostgreSQL login:

```env
EPD_GATEWAY_DATABASE_URL=postgresql://epd_gateway:PASSWORD@DB_HOST:5432/DB_NAME
EPD_GATEWAY_DATABASE_ROLE=epd_gateway_writer
EPD_OPERATOR_ATTEMPT_STALE_MS=300000
```

`epd_gateway_writer` создаётся как **NOLOGIN capability-role** пятой миграцией. Реальный LOGIN создаётся администратором БД отдельно и получает membership в этой роли.

Gateway в каждой транзакции выполняет `SET LOCAL ROLE epd_gateway_writer`. Роль имеет только необходимые права на `operator_attempts`.

Без `EPD_GATEWAY_DATABASE_URL` sandbox остаётся работоспособным, но completed-attempt dedupe переживает только текущий gateway-процесс.

## 5. Billing foundation и restricted billing login

Billing foundation создаёт тарифы, trial, subscription entitlement, monthly usage и database quota trigger.

По умолчанию:

```text
billing_settings.enforcement_enabled = false
EPD_BILLING_PROVIDER=none
```

Шестая миграция создаёт metadata-only `billing_payment_events` и NOLOGIN capability-role `epd_billing_writer`.

Для будущего verified webhook worker предусмотрен отдельный LOGIN:

```env
EPD_BILLING_DATABASE_URL=postgresql://epd_billing:PASSWORD@DB_HOST:5432/DB_NAME
EPD_BILLING_DATABASE_ROLE=epd_billing_writer
```

Этот credential не должен совпадать ни с `EPD_DATABASE_URL`, ни с `EPD_GATEWAY_DATABASE_URL`.

Седьмая миграция убирает прямой `UPDATE subscriptions` и `UPDATE billing_payment_events` у runtime billing-role. Активация entitlement разрешена только через:

```text
public.apply_verified_billing_entitlement(...)
```

SECURITY DEFINER функция атомарно проверяет event/user/status/plan/billing period, а затем делает `subscription -> active` и `event -> applied`.

Восьмая миграция ограничивает browser history ещё и на уровне **column privileges**. Authenticated role может SELECT только:

```text
provider
 event_type
 event_status
 plan_code
 amount_kopecks
 currency
 safe_error_code
 created_at
 processed_at
```

Даже прямой Data API запрос под пользовательским JWT не получает `id`, `user_id`, `provider_event_id` или `payload_sha256`. RLS дополнительно ограничивает строки `auth.uid() = user_id`.

Реальный checkout/webhook всё ещё отсутствует.

## 6. Docker Compose

Web публикуется только на loopback:

```text
127.0.0.1:8080 -> web container
```

Gateway `8787` наружу не публикуется.

```bash
docker compose --env-file .env.production up -d --build
```

Compose передаёт gateway deployment/operator/billing env, но заполненный billing DB credential сам по себе **не включает** платежи.

## 7. Server-day helper

```bash
sh deploy/server-day.sh .env.production
```

Скрипт до старта Docker проверяет deployment/runtime/billing preflight, RLS repositories, restricted DB boundaries, idempotency, billing foundation/payment/browser boundary, web security и operator sandbox.

После старта он:

- ждёт `/healthz`;
- читает `/api/operator/capabilities` и требует `externalSendEnabled=false`;
- читает `/api/billing/capabilities` и требует одновременно:

```text
provider = none
checkoutEnabled = false
webhookEnabled = false
realMoneyEnabled = false
successRedirectAuthoritative = false
directRuntimeSubscriptionUpdateAllowed = false
entitlementDatabaseFunctionRequired = true
```

- проверяет CSP, X-Frame-Options и nosniff на реальном web container.

Если хотя бы один payment-инвариант неожиданно меняется, `server-day` останавливается с ошибкой.

Скрипт не устанавливает Docker, не меняет firewall/DNS и не применяет SQL автоматически.

## 8. HTTPS reverse proxy и web security

```text
Internet
  -> :443 TLS reverse proxy
  -> 127.0.0.1:8080 project nginx
  -> frontend or /api/*
  -> private gateway:8787
```

Шаблон:

```text
deploy/Caddyfile.example
```

`EPD_ALLOWED_ORIGINS` — только точный HTTPS origin:

```env
EPD_ALLOWED_ORIGINS=https://epd.example.ru
```

Project nginx/Caddy policy включает CSP, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy и COOP. CSP разрешает `connect-src 'self' https: wss:` для Supabase/Auth API и запрещает inline scripts/objects/frame ancestors.

```bash
npm run web-security:test
```

## 9. Auth/RLS/billing smoke test

Двумя тестовыми аккаунтами:

1. A создаёт документ;
2. B не видит документ A;
3. Data API под JWT B не возвращает документ A даже по известному UUID;
4. operator API без Bearer получает `401`;
5. валидный JWT работает;
6. чужой `documentId` не доходит до operator API;
7. browser JWT не может писать `operator_attempts`;
8. browser JWT не может менять `subscriptions`/usage/payment events;
9. browser payment history возвращает только разрешённые колонки своего аккаунта;
10. прямой запрос `provider_event_id`/`payload_sha256` под browser JWT отклоняется правами БД;
11. restricted gateway DB login не имеет административных прав;
12. restricted billing DB login не имеет прямого UPDATE к subscription/payment events;
13. `/api/billing/capabilities` сообщает real money disabled;
14. `EPD_BILLING_PROVIDER=none`.

## 10. Local preview

При выключенном operator mode:

```text
POST /api/operator/preflight
POST /api/operator/kontur/userdata-preview
```

Они не вызывают внешний operator API.

## 11. Kontur sandbox

```env
EPD_DEPLOYMENT_MODE=production
EPD_OPERATOR_PROVIDER=kontur
EPD_OPERATOR_MODE=sandbox
EPD_GATEWAY_AUTH_MODE=supabase
EPD_KONTUR_BOX_ID=...
EPD_KONTUR_ACCESS_TOKEN=...
EPD_EXTERNAL_RATE_LIMIT_MAX=10
```

```text
Browser: {documentId}
 -> JWT/JWKS
 -> Supabase Data API under USER JWT
 -> RLS
 -> canonical documents row
 -> ownership check
 -> SHA-256 action identity
 -> persistent claim (если настроен)
 -> in-process duplicate collapse
 -> UserDataXml
 -> Kontur GenerateTitleXml
 -> journal succeeded/failed
```

Успешный sandbox результат не подписан и не отправлен. Повтор уже успешно обработанной той же revision при persistent journal блокируется до второго внешнего вызова.

## 12. Запрещено

- production `/api/operator/send`;
- `PostMessage`;
- signing без отдельного signing flow;
- автоматический статус «отправлен» от пользовательского клика;
- `service_role` в browser/operator user flow;
- operator/payment token/DB password в `VITE_*`;
- XML/JSON документа в application logs;
- raw payment webhook/card data в billing ledger;
- использование admin DB credential в runtime;
- прямое изменение subscription пользователем или billing runtime role;
- включение реальных денег до verified provider adapter.

## 13. Backup/recovery

Production checker требует:

```env
EPD_DATABASE_URL=postgresql://ADMIN_USER:PASSWORD@DB_HOST:5432/DB_NAME
EPD_BACKUP_DIR=.backups
EPD_BACKUP_RETENTION_DAYS=14
EPD_BACKUP_PASSPHRASE=LONG_RANDOM_SECRET_DIFFERENT_FROM_DB_PASSWORD
EPD_POSTGRES_CLIENT_IMAGE=postgres:17-alpine
```

```bash
npm run backup:create
npm run backup:verify -- /absolute/path/epd-light-....dump.enc
```

Restore drill — только отдельная test/staging DB:

```bash
export EPD_RESTORE_TEST_CONFIRM=RESTORE_TEST_ONLY
npm run backup:restore:test -- /absolute/path/epd-light-....dump.enc
unset EPD_RESTORE_TEST_CONFIRM
```

Encrypted backup на том же VPS — только первый уровень. Копия должна уходить отдельно от production VPS; passphrase хранится отдельно.

Подробнее: [`BACKUP-RECOVERY.md`](BACKUP-RECOVERY.md).

## 14. Server-day checklist

Перед открытием домена:

- [ ] `EPD_DEPLOYMENT_MODE=production`;
- [ ] `EPD_BILLING_PROVIDER=none`;
- [ ] `npm run preflight`;
- [ ] `npm run deploy:env:test`;
- [ ] `npm run deploy:check`;
- [ ] `npm run web-security:test`;
- [ ] `npm run audit:test`;
- [ ] `npm run authorization:test`;
- [ ] `npm run repository:test`;
- [ ] `npm run attempt-repository:test`;
- [ ] `npm run attempt-client:test`;
- [ ] `npm run idempotency:test`;
- [ ] `npm run billing:test`;
- [ ] `npm run billing-payment:test`;
- [ ] `npm run billing-payment-client:test`;
- [ ] `npm run billing-env:test`;
- [ ] `npm run rate-limit:test`;
- [ ] `npm run gateway:test`;
- [ ] `npm run auth:test`;
- [ ] `npm run gateway:auth:test`;
- [ ] `npm run kontur:userdata:test`;
- [ ] `npm run kontur:generation:test`;
- [ ] `npm run kontur:sandbox:test`;
- [ ] `npm run build`;
- [ ] все 8 SQL-миграций применены guarded runner'ом;
- [ ] RLS проверена двумя аккаунтами;
- [ ] restricted gateway DB login создан отдельно от admin login;
- [ ] billing DB login, если настроен заранее, отдельный от admin/operator login;
- [ ] browser не может писать operator/payment journals;
- [ ] browser payment history ограничена column privileges;
- [ ] web доступен только через `127.0.0.1:8080`;
- [ ] HTTPS работает;
- [ ] CSP/security headers подтверждены runtime-проверкой;
- [ ] Auth redirect URLs ограничены production доменом;
- [ ] firewall не публикует `8080/8787`;
- [ ] encrypted backup создан и проверен;
- [ ] backup скопирован вне VPS;
- [ ] restore drill выполнен;
- [ ] `/api/billing/capabilities` fail-closed;
- [ ] `externalSendEnabled=false`;
- [ ] `PostMessage` отсутствует;
- [ ] реальный payment checkout/webhook отсутствует до отдельного готового adapter.

## Контур данных РФ

Production-размещение БД, backend, логов и backups строится отдельно от GitHub/demo с учётом фактического состава данных и применимых требований. Целевой production-контур проекта — в РФ; GitHub хранит исходный код, но не пользовательские документы/ПД/секреты.
