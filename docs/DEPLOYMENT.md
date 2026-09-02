# Развёртывание ЭПД Лайт

Этот runbook описывает **технический production baseline**. Он не утверждает юридическую готовность сервиса, соответствие XSD ФНС, готовность подписания или production-отправки через оператора ИС ЭПД.

## Режимы

1. **Demo/local** — `EPD_DEPLOYMENT_MODE=local`; auth может быть отключена только при `EPD_OPERATOR_MODE=disabled`.
2. **Production cloud** — `EPD_DEPLOYMENT_MODE=production`, Supabase/PostgreSQL + JWT/JWKS + private gateway; operator mode может оставаться `disabled`.
3. **Kontur sandbox** — production cloud + реальный `GenerateTitleXml`; signing и `PostMessage` всё равно запрещены.

Production gateway сам отказывается стартовать без `EPD_GATEWAY_AUTH_MODE=supabase`. Billing отдельно fail-closed: `EPD_BILLING_PROVIDER=none`, пока не реализован verified payment adapter/webhook.

## 1. Production env

```bash
cp .env.example .env.production
```

Минимальные инварианты:

```env
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

## 2. Девять SQL-миграций

```text
202609010001_init.sql
202609010002_extend_directories_t1.sql
202609010003_operator_attempts.sql
202609020001_billing_foundation.sql
202609020002_gateway_writer_role.sql
202609020003_billing_payment_events.sql
202609020004_billing_entitlement_function.sql
202609020005_billing_payment_event_column_privileges.sql
202609020006_account_deletion_requests.sql
```

Применение:

```bash
export EPD_MIGRATION_CONFIRM=APPLY_MIGRATIONS
npm run db:migrate
unset EPD_MIGRATION_CONFIRM
npm run db:migrations:check -- .env.production
```

Guarded runner делает encrypted backup до/после, хранит SHA-256 applied migration и запрещает менять старую migration задним числом.

`db:migrations:check` ничего не меняет и требует exact match checkout ↔ `public.epd_light_schema_migrations`. Missing migration, SHA mismatch или дополнительная production migration блокируют deploy. Это также защищает от случайного rollback старого checkout поверх более новой схемы.

## 3. Backup readiness

```env
EPD_DATABASE_URL=postgresql://ADMIN_USER:PASSWORD@DB_HOST:5432/DB_NAME
EPD_BACKUP_DIR=.backups
EPD_BACKUP_RETENTION_DAYS=14
EPD_BACKUP_MAX_AGE_HOURS=30
EPD_BACKUP_PASSPHRASE=LONG_RANDOM_SECRET_DIFFERENT_FROM_DB_PASSWORD
EPD_POSTGRES_CLIENT_IMAGE=postgres:17-alpine
```

```bash
npm run backup:create
npm run backup:verify -- /absolute/path/epd-light-....dump.enc
npm run backup:readiness -- .env.production
```

Production gate требует свежий encrypted archive, `.sha256`, допустимый возраст и успешные SHA-256 → decrypt → `pg_restore --list`.

Backup на том же VPS — только первый уровень. Нужна offsite-копия и отдельное хранение passphrase.

Restore drill — только disposable test/staging DB:

```bash
export EPD_RESTORE_TEST_CONFIRM=RESTORE_TEST_ONLY
npm run backup:restore:test -- /absolute/path/epd-light-....dump.enc
unset EPD_RESTORE_TEST_CONFIRM
```

## 4. Restricted runtime DB roles

Operator journal:

```env
EPD_GATEWAY_DATABASE_URL=postgresql://epd_gateway:PASSWORD@DB_HOST:5432/DB_NAME
EPD_GATEWAY_DATABASE_ROLE=epd_gateway_writer
```

Billing worker boundary:

```env
EPD_BILLING_DATABASE_URL=postgresql://epd_billing:PASSWORD@DB_HOST:5432/DB_NAME
EPD_BILLING_DATABASE_ROLE=epd_billing_writer
```

Оба runtime login должны отличаться друг от друга и от admin `EPD_DATABASE_URL`.

Billing runtime не имеет прямого `UPDATE subscriptions`; entitlement активируется только через `public.apply_verified_billing_entitlement(...)` после verified payment event.

## 5. Browser/RLS boundary

RLS документов:

```text
auth.uid() = user_id
```

Browser:

- не пишет `operator_attempts`;
- не меняет subscription/usage/payment events;
- payment history ограничена RLS + column privileges;
- не может запросить скрытые payment event fields;
- `account_deletion_requests` может только SELECT/INSERT своей pending-заявки;
- не может UPDATE/DELETE deletion request или удалять auth-user.

`/app/privacy` даёт self-service JSON export и request-only deletion flow. Фактическое удаление server-controlled и **не реализовано автоматически** до утверждения retention matrix. Подробнее: [`PRIVACY-DATA-LIFECYCLE.md`](PRIVACY-DATA-LIFECYCLE.md).

## 6. Private dependency smoke-check

```bash
npm run deploy:dependencies:check
```

Перед Docker launch проверяется:

```text
Supabase /auth/v1/.well-known/jwks.json
 -> есть asymmetric signing key

Supabase /rest/v1/billing_plans
 -> Data API доступен
 -> billing foundation видна
```

URL, API key и response body в error output не печатаются.

## 7. Server-day

```bash
sh deploy/server-day.sh .env.production
```

До Docker build:

```text
clean git checkout + package release
 -> env/security preflight
 -> source/migration/backup/privacy/billing/runtime preflight
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
 -> runtime release/commit == checkout/package.json
 -> /api/operator/capabilities: externalSendEnabled=false
 -> /api/billing/capabilities: provider=none, checkout/webhook/realMoney=false
 -> /api/system/readiness: productionBaselineReady=true
 -> CSP/X-Frame-Options/nosniff runtime headers
```

`server-day` отказывается работать с dirty git checkout. Release берётся из `package.json`, commit — из `git rev-parse HEAD`, build time — текущий UTC.

`/api/system/readiness` намеренно сообщает:

```text
technicalReadinessOnly=true
legalReadinessClaimed=false
sensitiveValuesIncluded=false
```

## 8. Docker/network

```text
Internet
 -> :443 TLS reverse proxy
 -> 127.0.0.1:8080 project nginx
 -> frontend or /api/*
 -> private gateway:8787
```

Web публикуется только `127.0.0.1:8080`; gateway `8787` наружу не публикуется. Шаблон edge proxy: `deploy/Caddyfile.example`.

## 9. Web security

Project nginx/Caddy включает CSP, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy и COOP.

```bash
npm run web-security:test
```

`server-day` дополнительно проверяет headers на реально запущенном web container.

## 10. Operator sandbox

Только после получения sandbox credentials:

```env
EPD_OPERATOR_PROVIDER=kontur
EPD_OPERATOR_MODE=sandbox
EPD_KONTUR_BOX_ID=...
EPD_KONTUR_ACCESS_TOKEN=...
```

```text
Browser {documentId}
 -> JWT/JWKS
 -> Supabase Data API under USER JWT
 -> RLS canonical document
 -> ownership
 -> idempotency/persistent claim
 -> UserDataXml
 -> Kontur GenerateTitleXml
 -> metadata-only journal
```

Sandbox не подписывает и не вызывает `PostMessage`. `/api/operator/send` остаётся 503.

## 11. Billing

До реального payment adapter обязательны:

```text
EPD_BILLING_PROVIDER=none
checkoutEnabled=false
webhookEnabled=false
realMoneyEnabled=false
successRedirectAuthoritative=false
```

Success redirect никогда не активирует entitlement.

## 12. Privacy smoke-test двумя аккаунтами

Перед пилотом проверить:

1. A не видит документы/справочники B.
2. JWT B не получает документ A по известному UUID.
3. Browser не пишет operator/payment journals.
4. Hidden payment columns отклоняются DB privileges.
5. A не видит deletion request B.
6. A не может создать deletion request за B.
7. Browser не может UPDATE/DELETE deletion request.
8. Повторная active deletion request не создаёт дубль.
9. JSON export не содержит access/refresh token или server secrets.
10. Restricted operator/billing logins не имеют admin rights.

## 13. Checklist перед открытием домена

- [ ] `EPD_DEPLOYMENT_MODE=production`;
- [ ] `EPD_GATEWAY_AUTH_MODE=supabase`;
- [ ] `EPD_BILLING_PROVIDER=none`;
- [ ] `npm run preflight`;
- [ ] `npm run privacy:test`;
- [ ] все 9 миграций применены guarded runner'ом;
- [ ] `npm run db:migrations:check -- .env.production`;
- [ ] `npm run backup:readiness -- .env.production`;
- [ ] backup скопирован offsite;
- [ ] restore drill выполнен;
- [ ] `npm run deploy:dependencies:check`;
- [ ] `npm run build`;
- [ ] RLS проверена двумя аккаунтами;
- [ ] privacy export проверен на отсутствие токенов/secrets;
- [ ] deletion request подтверждён как read/insert-only;
- [ ] retention matrix подготовлена до destructive deletion worker;
- [ ] web слушает только `127.0.0.1:8080`;
- [ ] HTTPS работает;
- [ ] firewall не публикует `8080/8787`;
- [ ] runtime release/commit совпадают с source;
- [ ] `/api/system/readiness` даёт `productionBaselineReady=true`;
- [ ] `externalSendEnabled=false`;
- [ ] `PostMessage` отсутствует;
- [ ] billing checkout/webhook/real money отсутствуют.

## Контур данных РФ

Production data/auth/backend/logs/backups проектируются отдельно от GitHub/demo. Целевой production-контур — в РФ; GitHub хранит исходный код, но не пользовательские документы, ПД и server secrets.
