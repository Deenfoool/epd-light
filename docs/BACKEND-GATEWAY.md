# Backend gateway ЭПД Лайт

`server/index.mjs` — server-side контур для будущей интеграции с оператором ИС ЭПД.

Текущая версия **намеренно не умеет отправлять документы оператору**. Gateway умеет локально проверять интеграционный черновик и строить preview Kontur T1 `UserDataXml` без внешних вызовов.

## Зачем он нужен

Секреты оператора, сервисные токены, закрытые ключи и материалы электронной подписи нельзя помещать в React/Vite frontend. Любой `VITE_*` параметр попадает в браузер.

Целевая цепочка:

```text
Browser -> HTTPS -> nginx -> /api/operator/* -> private gateway -> provider adapter -> operator IS EPD
```

Порт gateway в `docker-compose.yml` наружу не публикуется.

## Endpoints

### `GET /healthz`

Проверка здоровья процесса.

### `GET /api/operator/capabilities`

Возвращает режим gateway и безопасные capability-метаданные. Критические признаки сейчас всегда:

```json
{
  "externalSendEnabled": false,
  "xsdValidationEnabled": false,
  "localKonturUserDataPreview": {
    "externalCallRequired": false,
    "xsdValidated": false
  }
}
```

Никакие токены или значения секретов в capabilities не возвращаются.

### `POST /api/operator/preflight`

Принимает `epd-light/operator-candidate-v1` и выполняет общий server-side sanity check структуры.

Это **не XSD-валидация** и не обращение к оператору.

### `POST /api/operator/kontur/userdata-preview`

Принимает тот же Integration JSON, выполняет более строгую проверку первого адаптера Контур и локально строит `LogisticsWaybillConsignorTitle` UserDataXml для T1.

Endpoint:

- не требует operator access token;
- не вызывает `diadoc-api.kontur.ru`;
- не вызывает `GenerateTitleXml`;
- не подписывает документ;
- не отправляет документ;
- возвращает `externalCallMade: false`;
- возвращает `contract.xsdValidated: false`.

При неполных/неподдерживаемых данных отвечает `422` и списком ошибок. Первая версия блокирует ИП до проверки соответствующей ветки актуального UserDataXsd.

### `POST /api/operator/send`

В текущей версии всегда отвечает `503 operator_send_disabled` независимо от `EPD_OPERATOR_MODE` и наличия переменных Контур.

Этот endpoint нельзя открывать до выполнения всех пунктов:

1. выбран конкретный оператор и получен тестовый доступ;
2. через `GetDocumentTypes (V3)` проверена актуальная версия контракта;
3. UserDataXml проверен реальным `GenerateTitleXml` в sandbox;
4. реализована серверная аутентификация пользователя/организации;
5. добавлена применимая XSD/форматная валидация;
6. определён и протестирован механизм подписи;
7. реализована idempotency и хранение внешних идентификаторов;
8. проведён тестовый `PostMessage` в контуре оператора;
9. юридически согласована production-модель.

## Контур адаптера Контур

```text
server/providers/kontur-userdata.mjs
  Integration JSON -> validation -> local UserDataXml preview

server/providers/kontur.mjs
  GetDocumentTypes (V3) -> XsdUrl/UserDataXsdUrl
  GetContent -> XSD
  GenerateTitleXml

server/services/kontur-title.mjs
  candidate -> UserDataXml -> GenerateTitleXml
  server-only, gateway route отсутствует
```

`GenerateTitleXml` существует как server-only boundary, но gateway её **не экспонирует**. Наличие access token в env не включает внешний обмен.

## Переменные окружения

```env
EPD_OPERATOR_PROVIDER=none
EPD_OPERATOR_MODE=disabled
EPD_MAX_BODY_BYTES=524288
EPD_ALLOWED_ORIGINS=

# Только для server-side sandbox/CLI:
EPD_KONTUR_BOX_ID=
EPD_KONTUR_ACCESS_TOKEN=
```

`EPD_OPERATOR_MODE` не может включить `/send`: endpoint заблокирован кодом.

## Privacy-safe аудит

`server/audit.mjs` пишет по одной JSON-строке на завершённый ответ gateway. Используется строгий allow-list полей:

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

В audit log **не попадают**:

- request body;
- response XML/JSON документа;
- query string;
- `Authorization` и другие headers;
- access/refresh token;
- BoxId из payload;
- ФИО, телефон, адрес, ИНН, ВУ;
- свободный текст ошибки, если он не является коротким machine-safe кодом.

Человеко-читаемые ошибки сворачиваются в общий `http_error`/`request_failed`; это снижает риск случайного вывода персональных данных через exception message.

Полные ЭТрН/Integration JSON/UserDataXml запрещено писать в обычные application logs. Если позже понадобится юридический/операторский аудит, его нужно проектировать отдельно с минимизацией данных и сроками хранения.

## Проверки

Без внешней сети предусмотрены:

```bash
npm run preflight
npm run audit:test
npm run gateway:test
npm run kontur:provider:test
npm run kontur:userdata:test
npm run kontur:generation:test
```

`audit:test` проверяет strict allow-list и отсутствие утечки payload/token. `gateway:test` дополнительно отправляет тестовые ФИО/телефон/груз в POST body и проверяет, что эти значения не появляются в stdout gateway.

После получения sandbox-реквизитов отдельно выполняется:

```bash
npm run kontur:schema:check
```

Эта команда использует `GetDocumentTypes (V3) + GetContent`, но не отправляет ЭТрН.
