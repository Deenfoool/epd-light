# Развёртывание ЭПД Лайт

Этот runbook описывает **технический production baseline**. Он не утверждает юридическую готовность сервиса, соответствие XSD ФНС, готовность подписания или production-отправки через оператора ИС ЭПД.

## Режимы

1. **Demo/local** — `EPD_DEPLOYMENT_MODE=local`; auth может быть отключена только при `EPD_OPERATOR_MODE=disabled`.
2. **Production cloud** — `EPD_DEPLOYMENT_MODE=production`, Supabase/PostgreSQL + JWT/JWKS + private gateway; operator mode может оставаться `disabled`.
3. **Kontur sandbox** — production cloud + реальный `GenerateTitleXml`; signing и `PostMessage` всё равно запрещены.

Production gateway сам отказывается стартовать без `EPD_GATEWAY_AUTH_MODE=supabase`. Billing отдельно fail-closed: `EPD_BILLING_PROVIDER=none`, пока не реализован конкретный verified payment adapter/webhook.

## 1. Подготовить `.env.production`

Начать с:

```bash
cp .env.example .env.production
```

Минимальные production-инварианты:

```env
EPD_RELEASE=0.1.0
EPD_DEPLOYMENT_MODE=production
EPD_GATEWAY_AUTH_MODE=supabase
EPD_AUTH_SUPABASE_URL=https://YOUR_DATA_HOST
EPD_DATA_SUPABASE_URL=https://YOUR_DATA_HOST
EPD_DATA_SUPABASE_PUBLIC_KEY=PUBLIC_ANON_OR_PUBLISHABLE_KEY
EPD_ALLOWED_ORIGINS=https://epd.example.ru
EPD_OPERATOR_PROVIDER=none
EPD_OPERATOR_MODE=disabled
EPD_BILLING_PROVIDER=none
EPD_BACKUP_MAX_AGE_HOURS=30
```

`VITE_*` содержит только публичную frontend-конфигурацию. В `VITE_*` запрещены operator token, DB passwords, backup passphrase, `service_role`, private keys и материалы КЭП.

## 2. Восемь SQL-миграций

Текущий набор:

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

Применение выполняется только guarded runner'ом:

```bash
export EPD_MIGRATION_CONFIRM=APPLY_MIGRATIONS
npm run db:migrate
unset EPD_MIGRATION_CONFIRM
```

Runner:

- делает encrypted backup до изменений;
- создаёт/использует `public.epd_light_schema_migrations`;
- сохраняет SHA-256 каждого применённого файла;
- отказывается принимать изменённую задним числом migration;
- применяет SQL через `--single-transaction`;
- делает второй encrypted backup после изменений.

После применения обязательно:

```bash
npm run db:migrations:check -- .env.production
```

Этот checker **ничего не изменяет**. Он останавливает deploy, если:

- migration отсутствует в production registry;
- SHA-256 не совпадает с checkout;
- в БД есть дополнительная зарегистрированная migration, которой нет в текущем checkout.

Последняя проверка защищает от случайного rollback старого кода поверх более новой схемы.

## 3. Backup readiness

Production backup-конфигурация:

```env
EPD_DATABASE_URL=postgresql://ADMIN_USER:PASSWORD@DB_HOST:5432/DB_NAME
EPD_BACKUP_DIR=.backups
EPD_BACKUP_RETENTION_DAYS=14
EPD_BACKUP_MAX_AGE_HOURS=30
EPD_BACKUP_PASSPHRASE=LONG_RANDOM_SECRET_DIFFERENT_FROM_DB_PASSWORD
EPD_POSTGRES_CLIENT_IMAGE=postgres:17-alpine
```

Создание:

```bash
npm run backup:create
```

Проверка конкретного архива:

```bash
npm run backup:verify -- /absolute/path/epd-light-....dump.enc
```

Production gate:

```bash
npm run backup:readiness -- .env.production
```

`backup:readiness` требует свежий `epd-light-*.dump.enc`, SHA-256 sidecar и возраст не больше `EPD_BACKUP_MAX_AGE_HOURS`. Затем реально выполняются:

```text
SHA-256 verification
 -> AES-256/PBKDF2 decrypt во временный файл
 -> pg_restore --list
 -> удаление plaintext temp
```

Backup на том же VPS — только первый уровень. Нужна отдельная offsite-копия и отдельное хранение passphrase.

Restore drill выполняется только в disposable test/staging DB:

```bash
export EPD_RESTORE_TEST_CONFIRM=RESTORE_TEST_ONLY
npm run backup:restore:test -- /absolute/path/epd-light-....dump.enc
unset EPD_RESTORE_TEST_CONFIRM
```

## 4. Restricted runtime DB logins

### Operator journal

```env
EPD_GATEWAY_DATABASE_URL=postgresql://epd_gateway:PASSWORD@DB_HOST:5432/DB_NAME
EPD_GATEWAY_DATABASE_ROLE=epd_gateway_writer
EPD_OPERATOR_ATTEMPT_STALE_MS=300000
```

`epd_gateway_writer` — NOLOGIN capability-role. Runtime LOGIN создаётся отдельно и получает membership. Credential не должен совпадать с admin `EPD_DATABASE_URL`.

### Billing worker boundary

```env
EPD_BILLING_DATABASE_URL=postgresql://epd_billing:PASSWORD@DB_HOST:5432/DB_NAME
EPD_BILLING_DATABASE_ROLE=epd_billing_writer
```

Этот credential должен отличаться и от admin DB, и от operator journal login. Само наличие credential **не включает оплату**.

Billing runtime не имеет прямого `UPDATE subscriptions`. Entitlement может быть активирован только через DB-функцию `public.apply_verified_billing_entitlement(...)`, которая требует уже verified payment event.

## 5. Browser DB boundary

RLS для документов остаётся авторитетной:

```text
auth.uid() = user_id
```

Browser JWT:

- не может писать `operator_attempts`;
- не может менять `subscriptions`/usage/payment events;
- payment history читает только свои строки;
- column privileges не дают прочитать `id`, `user_id`, `provider_event_id`, `payload_sha256`.

## 6. Private dependency smoke-check

Перед Docker launch:

```bash
npm run deploy:dependencies:check
```

Production checker проверяет по сети:

```text
Supabase /auth/v1/.well-known/jwks.json
 -> есть asymmetric signing key

Supabase /rest/v1/billing_plans
 -> Data API доступен
 -> billing foundation видна
```

В error output намеренно нет Supabase URL, API key и response body.

## 7. Server-day

Основной запуск:

```bash
sh deploy/server-day.sh .env.production
```

Порядок fail-closed gate'ов до Docker build:

```text
env/security preflight
 -> migration static preflight
 -> backup static preflight
 -> billing/runtime tests
 -> exact production migration registry + SHA-256
 -> fresh encrypted backup readiness
 -> Supabase JWKS/Data API network smoke
 -> docker compose config
 -> Docker build/start
```

После запуска:

```text
/healthz
 -> /api/system/version
 -> runtime commit == checkout commit
 -> /api/operator/capabilities: externalSendEnabled=false
 -> /api/billing/capabilities: provider=none, checkout/webhook/realMoney=false
 -> /api/system/readiness: productionBaselineReady=true
 -> CSP/X-Frame-Options/nosniff runtime headers
```

`/api/system/readiness` специально сообщает:

```text
technicalReadinessOnly=true
legalReadinessClaimed=false
sensitiveValuesIncluded=false
```

То есть зелёный technical baseline не означает юридическую/XSD/operator-production готовность.

## 8. Build traceability

`server-day` получает текущий git commit и UTC build time и передаёт их gateway:

```text
EPD_RELEASE
EPD_BUILD_COMMIT
EPD_BUILD_TIME
```

После запуска `/api/system/version` обязан вернуть тот же commit. Если checkout нельзя идентифицировать либо container сообщает другой commit — deployment останавливается.

## 9. Docker/network

Project web публикуется только на loopback:

```text
127.0.0.1:8080 -> web container
```

Gateway `8787` наружу не публикуется.

Целевая схема:

```text
Internet
 -> :443 TLS reverse proxy
 -> 127.0.0.1:8080 project nginx
 -> frontend or /api/*
 -> private gateway:8787
```

Шаблон Caddy:

```text
deploy/Caddyfile.example
```

Firewall не должен публиковать `8080` или `8787` в Internet.

## 10. Web security

Project nginx/Caddy включает CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Referrer-Policy, Permissions-Policy и COOP.

Проверка:

```bash
npm run web-security:test
```

`server-day` дополнительно проверяет headers на реально запущенном web container.

## 11. Operator sandbox

Только после получения sandbox credentials:

```env
EPD_OPERATOR_PROVIDER=kontur
EPD_OPERATOR_MODE=sandbox
EPD_KONTUR_BOX_ID=...
EPD_KONTUR_ACCESS_TOKEN=...
```

Flow:

```text
Browser {documentId}
 -> JWT/JWKS
 -> Supabase Data API under USER JWT
 -> RLS
 -> canonical documents row
 -> ownership
 -> SHA-256 idempotency
 -> optional persistent claim
 -> UserDataXml
 -> Kontur GenerateTitleXml
 -> metadata-only journal
```

Sandbox не подписывает документ и не вызывает `PostMessage`. Production `/api/operator/send` остаётся 503.

## 12. Billing

До реализации конкретного провайдера обязательны:

```text
EPD_BILLING_PROVIDER=none
checkoutEnabled=false
webhookEnabled=false
realMoneyEnabled=false
successRedirectAuthoritative=false
```

Success redirect никогда не активирует entitlement. Будущий payment adapter должен сначала verify server-to-server event, затем записать verified ledger event и только потом вызвать DB entitlement function.

## 13. Smoke-test двумя аккаунтами

Перед пилотом:

1. A создаёт документ.
2. B не видит документ A.
3. JWT B не получает документ A даже по известному UUID.
4. Operator API без Bearer получает 401.
5. Чужой `documentId` не доходит до operator API.
6. Browser не может писать operator/payment journals.
7. Browser не может менять subscription/usage.
8. Запрос скрытых payment columns отклоняется правами БД.
9. Restricted operator/billing logins не имеют административных прав.

## 14. Checklist перед открытием домена

- [ ] `EPD_DEPLOYMENT_MODE=production`;
- [ ] `EPD_GATEWAY_AUTH_MODE=supabase`;
- [ ] `EPD_BILLING_PROVIDER=none`;
- [ ] `npm run preflight`;
- [ ] все 8 миграций применены guarded runner'ом;
- [ ] `npm run db:migrations:check -- .env.production`;
- [ ] `npm run backup:readiness -- .env.production`;
- [ ] backup скопирован offsite;
- [ ] restore drill выполнен;
- [ ] `npm run deploy:dependencies:check`;
- [ ] `npm run build`;
- [ ] RLS проверена двумя аккаунтами;
- [ ] web слушает только `127.0.0.1:8080`;
- [ ] HTTPS работает;
- [ ] firewall не публикует `8080/8787`;
- [ ] runtime commit совпадает с checkout;
- [ ] `/api/system/readiness` даёт `productionBaselineReady=true`;
- [ ] `externalSendEnabled=false`;
- [ ] `PostMessage` отсутствует;
- [ ] billing checkout/webhook/real money отсутствуют.

## Контур данных РФ

Production data/auth/backend/logs/backups проектируются отдельно от GitHub/demo. Целевой production-контур — в РФ; GitHub хранит исходный код, но не пользовательские документы, ПД и server secrets.
