# Backend gateway ЭПД Лайт

`server/index.mjs` — private server-side контур для проверки черновиков и будущей интеграции с оператором ИС ЭПД.

Gateway принципиально разделяет три режима:

1. локальные проверки/preview без внешнего оператора;
2. контролируемый sandbox `GenerateTitleXml`;
3. production signing/`PostMessage`, который пока **не реализован**.

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
server mapper -> ownership check -> UserDataXml
  |
  v
Kontur GenerateTitleXml
```

Порт gateway `8787` наружу не публикуется. nginx проксирует `/api/*` во внутреннюю Docker-сеть.

## Authentication

При `EPD_GATEWAY_AUTH_MODE=supabase` gateway проверяет Supabase access token через JWKS:

```text
/auth/v1/.well-known/jwks.json
```

Проверяются подпись, issuer, audience, срок действия и `role=authenticated`. Используется allow-list асимметричных алгоритмов `RS256/ES256`.

Общий JWT secret и `service_role` для gateway auth не используются.

Внутри успешного auth-result пользовательский access token хранится non-enumerable: он нужен только для server-to-server RLS-запроса и не должен случайно сериализоваться в JSON/logs.

В `EPD_OPERATOR_MODE != disabled` gateway вообще не стартует с отключённой auth-моделью.

## Authorization и canonical document

Для внешнего operator-вызова недостаточно проверить JWT. Браузерский Integration JSON считается **неавторитетным**.

Sandbox flow принимает только `documentId`, после чего backend:

1. использует уже проверенный пользовательский JWT;
2. читает `/rest/v1/documents?id=eq.<documentId>`;
3. передаёт публичный anon/publishable key в `apikey`;
4. передаёт пользовательский JWT в `Authorization`;
5. полагается на существующую RLS `auth.uid() = user_id`;
6. заново строит canonical operator candidate;
7. повторно сравнивает `row.user_id` с JWT `sub`;
8. только после этого разрешает `GenerateTitleXml`.

`service_role` этому пути не нужен и не должен использоваться.

## Rate limiting

В памяти gateway действуют три независимых лимита:

- `EPD_AUTH_ATTEMPT_LIMIT_MAX` — до авторизации, по безопасному сетевому ключу;
- `EPD_RATE_LIMIT_MAX` — обычные operator API запросы, по хешу JWT `sub`;
- `EPD_EXTERNAL_RATE_LIMIT_MAX` — более строгий лимит реальных внешних обращений к оператору.

Окно задаётся `EPD_RATE_LIMIT_WINDOW_MS`.

Gateway возвращает `RateLimit-*` и `Retry-After` при `429`.

nginx перезаписывает `X-Real-IP` и `X-Forwarded-For`, чтобы клиент не мог выбирать rate-limit bucket подложенным первым XFF-hop.

## Endpoints

### `GET /healthz`

Healthcheck процесса.

### `GET /api/operator/capabilities`

Публичные безопасные capability-метаданные. Секреты не возвращаются.

В ответе можно увидеть:

- текущий `mode`;
- auth policy;
- rate limits;
- готовность RLS repository;
- готовность Kontur credentials;
- готовность sandbox route;
- `externalSendEnabled=false`.

### `POST /api/operator/preflight`

Авторизованный structural preflight Integration JSON.

Не является XSD-валидацией и не обращается к Контур.

### `POST /api/operator/kontur/userdata-preview`

Авторизованно строит локальный T1 `UserDataXml` preview.

- external call: нет;
- XSD validation: нет;
- signing: нет;
- PostMessage: нет.

Для UI/разработки браузерский Integration JSON здесь допустим, потому что endpoint ничего не отправляет наружу.

### `POST /api/operator/kontur/generate-title-sandbox`

Реальный внешний sandbox-вызов `GenerateTitleXml`.

Endpoint активен только если одновременно:

```env
EPD_OPERATOR_PROVIDER=kontur
EPD_OPERATOR_MODE=sandbox
EPD_GATEWAY_AUTH_MODE=supabase
```

и настроены:

- Supabase auth URL;
- Supabase Data API URL;
- публичный anon/publishable key;
- Kontur BoxId;
- Kontur access token.

Тело запроса **строго**:

```json
{
  "documentId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
}
```

Любые дополнительные поля, включая `candidate`, `data`, `xml`, отклоняются. Это защищает внешний вызов от подмены документа клиентом.

Успешный ответ содержит сгенерированный XML и явные признаки:

```json
{
  "externalCallMade": true,
  "signed": false,
  "sent": false
}
```

Endpoint **не вызывает** `PostMessage`.

### `POST /api/operator/send`

Всегда отвечает:

```text
503 operator_send_disabled
```

Даже при `EPD_OPERATOR_MODE=sandbox`.

## Privacy-safe audit

`server/audit.mjs` пишет только allow-list метаданных:

```json
{
  "event": "gateway_request",
  "ts": "2026-09-01T12:00:00.000Z",
  "requestId": "...",
  "method": "POST",
  "path": "/api/operator/preflight",
  "provider": "kontur",
  "httpStatus": 422,
  "durationMs": 12,
  "errorCode": "candidate_invalid"
}
```

Не логируются:

- request body;
- Integration JSON;
- UserDataXml/generated XML;
- query string;
- headers;
- access/refresh/operator tokens;
- BoxId документа;
- ФИО, телефон, адрес, ИНН, ВУ;
- свободный exception text.

## Env

Основные server-side параметры:

```env
EPD_OPERATOR_PROVIDER=none
EPD_OPERATOR_MODE=disabled
EPD_GATEWAY_AUTH_MODE=disabled
EPD_AUTH_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EPD_AUTH_AUDIENCE=authenticated
EPD_DATA_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EPD_DATA_SUPABASE_PUBLIC_KEY=PUBLIC_KEY
EPD_RATE_LIMIT_WINDOW_MS=60000
EPD_RATE_LIMIT_MAX=60
EPD_AUTH_ATTEMPT_LIMIT_MAX=120
EPD_EXTERNAL_RATE_LIMIT_MAX=10
EPD_KONTUR_BOX_ID=
EPD_KONTUR_ACCESS_TOKEN=
```

Никакие server secrets не должны попадать в `VITE_*`.

## Проверки

```bash
npm run preflight
npm run audit:test
npm run auth:test
npm run authorization:test
npm run repository:test
npm run rate-limit:test
npm run gateway:test
npm run gateway:auth:test
npm run kontur:userdata:test
npm run kontur:generation:test
npm run kontur:sandbox:test
```

`kontur:sandbox:test` использует только mock fetch и проверяет цепочку `documentId -> user JWT/RLS repository -> canonical mapper -> ownership -> GenerateTitleXml`, не обращаясь к реальному Контур.

## Что всё ещё запрещено

До отдельного signing flow и реального операторского тестирования нельзя открывать:

- `PostMessage`;
- production send;
- статусы «передан/подписан/принят» по пользовательскому клику;
- хранение operator access token во frontend;
- доверие клиентскому XML/Integration JSON для внешнего вызова;
- `service_role` как обход RLS в пользовательском operator flow.
