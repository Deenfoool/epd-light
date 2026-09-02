# Backend gateway ЭПД Лайт

`server/index.mjs` — private server-side контур для проверки черновиков и будущей интеграции с оператором ИС ЭПД.

Gateway разделяет три уровня:

1. local preflight/UserDataXml preview;
2. контролируемый sandbox `GenerateTitleXml`;
3. production signing/`PostMessage`, который пока **не реализован**.

## Deployment/auth mode

`EPD_DEPLOYMENT_MODE` имеет два допустимых значения:

```text
local
production
```

`local` нужен для demo/dev. При `production` gateway **не стартует**, если `EPD_GATEWAY_AUTH_MODE != supabase`, даже когда `EPD_OPERATOR_MODE=disabled`.

Это runtime-защита, а не только правило deployment checker.

## Архитектура

```text
Browser
  |
  | HTTPS + Supabase access token
  v
nginx
  |
  v
private gateway
  |-- production-mode guard
  |-- JWT/JWKS verification
  |-- rate limiting
  |-- privacy-safe audit
  |-- local preflight/UserDataXml preview
  |
  | sandbox only
  v
Supabase Data API under USER JWT
  |
  | RLS auth.uid() = user_id
  v
canonical documents row
  |
  v
server mapper -> ownership -> SHA-256 action identity
  |
  | optional persistent metadata claim
  v
restricted PostgreSQL operator_attempts writer
  |
  v
Kontur GenerateTitleXml
```

Gateway port `8787` наружу не публикуется.

## Authentication

При `EPD_GATEWAY_AUTH_MODE=supabase` access token проверяется через:

```text
/auth/v1/.well-known/jwks.json
```

Проверяются signature, issuer, audience, expiration и `role=authenticated`. Allow-list алгоритмов: `RS256/ES256`.

Shared JWT secret и `service_role` не используются.

Проверенный user access token хранится в auth-result non-enumerable и используется только server-side для RLS Data API reload.

## Authorization и canonical document

Браузерский Integration JSON неавторитетен для внешнего вызова.

Sandbox принимает только `documentId`, затем backend:

1. проверяет JWT;
2. читает `documents` через Supabase Data API под тем же USER JWT;
3. RLS ограничивает доступ;
4. заново строит canonical candidate;
5. сверяет `row.user_id` с JWT `sub`;
6. вычисляет idempotency identity по canonical revision;
7. только после этого допускает внешний operator call.

`service_role` здесь не нужен.

## Persistent operator journal

`public.operator_attempts` хранит только безопасные metadata:

- user/document UUID;
- provider/operation/mode;
- `documents.updated_at` revision;
- SHA-256 `idempotency_key`;
- SHA-256 `request_fingerprint`;
- status;
- safe error code;
- внешние технические ID, когда они появятся.

XML, Integration JSON, токены и ПД туда не пишутся.

Browser JWT имеет только `SELECT` своих записей через RLS и не может создавать/менять operator outcome.

Server writer подключается опционально:

```env
EPD_GATEWAY_DATABASE_URL=postgresql://RESTRICTED_LOGIN:...@DB/epd_light
EPD_GATEWAY_DATABASE_ROLE=epd_gateway_writer
EPD_OPERATOR_ATTEMPT_STALE_MS=300000
```

Пятая миграция создаёт `epd_gateway_writer` как `NOLOGIN` capability-role. Реальный LOGIN создаётся отдельно и получает membership. Репозиторий выполняет `SET LOCAL ROLE epd_gateway_writer` внутри транзакции.

Если repository не настроен, работает только in-process concurrent dedupe. Если настроен — успешный action survives restart и повтор той же revision блокируется до operator API.

## Rate limiting

- `EPD_AUTH_ATTEMPT_LIMIT_MAX` — до auth;
- `EPD_RATE_LIMIT_MAX` — обычные operator API;
- `EPD_EXTERNAL_RATE_LIMIT_MAX` — реальные внешние operator calls;
- окно: `EPD_RATE_LIMIT_WINDOW_MS`.

## Endpoints

### `GET /healthz`

Process health.

### `GET /api/operator/capabilities`

Возвращает только безопасные capability metadata:

- mode/provider;
- auth policy;
- rate limits;
- RLS repository status;
- Kontur adapter status;
- sandbox readiness;
- `persistentAttemptJournal` status;
- `externalSendEnabled=false`.

Connection strings, keys и tokens не возвращаются.

### `POST /api/operator/preflight`

Авторизованный structural preflight Integration JSON. Не XSD и без Контур API.

### `POST /api/operator/kontur/userdata-preview`

Локальный T1 UserDataXml preview:

```text
external call = false
xsd validation = false
signed = false
sent = false
```

### `POST /api/operator/kontur/generate-title-sandbox`

Реальный внешний sandbox `GenerateTitleXml`.

Требует:

```env
EPD_DEPLOYMENT_MODE=production
EPD_OPERATOR_PROVIDER=kontur
EPD_OPERATOR_MODE=sandbox
EPD_GATEWAY_AUTH_MODE=supabase
```

Request body строго:

```json
{
  "documentId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
}
```

Дополнительные `candidate/data/xml/idempotencyKey` отклоняются.

При persistent journal возможны безопасные fail-closed ответы:

```text
sandbox_already_generated
sandbox_generation_in_progress
operator_attempt_journal_update_failed
```

`GenerateTitleXml` result:

```text
signed=false
sent=false
```

`PostMessage` не вызывается.

### `POST /api/operator/send`

Всегда:

```text
503 operator_send_disabled
```

## Privacy-safe audit

Логируется только allow-list:

```text
requestId
method
path
provider
httpStatus
durationMs
safe errorCode
```

Не логируются body, XML, query string, headers, JWT/operator token, ФИО, адреса, телефоны, ИНН, ВУ.

## Env

```env
EPD_DEPLOYMENT_MODE=local
EPD_OPERATOR_PROVIDER=none
EPD_OPERATOR_MODE=disabled
EPD_GATEWAY_AUTH_MODE=disabled
EPD_AUTH_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EPD_AUTH_AUDIENCE=authenticated
EPD_DATA_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EPD_DATA_SUPABASE_PUBLIC_KEY=PUBLIC_KEY
EPD_GATEWAY_DATABASE_URL=
EPD_GATEWAY_DATABASE_ROLE=epd_gateway_writer
EPD_OPERATOR_ATTEMPT_STALE_MS=300000
EPD_RATE_LIMIT_WINDOW_MS=60000
EPD_RATE_LIMIT_MAX=60
EPD_AUTH_ATTEMPT_LIMIT_MAX=120
EPD_EXTERNAL_RATE_LIMIT_MAX=10
EPD_KONTUR_BOX_ID=
EPD_KONTUR_ACCESS_TOKEN=
```

Для production `EPD_DEPLOYMENT_MODE=production` и `EPD_GATEWAY_AUTH_MODE=supabase` обязательны.

## Проверки

```bash
npm run preflight
npm run audit:test
npm run auth:test
npm run authorization:test
npm run repository:test
npm run attempt-repository:test
npm run idempotency:test
npm run rate-limit:test
npm run gateway:test
npm run gateway:auth:test
npm run kontur:userdata:test
npm run kontur:generation:test
npm run kontur:sandbox:test
```

## Всё ещё запрещено

- `PostMessage`;
- production send;
- signing;
- клиентский XML/Integration JSON как источник внешнего вызова;
- `service_role` как обход user RLS;
- admin DB credential в gateway runtime;
- application logs с документом/ПД/секретами.
