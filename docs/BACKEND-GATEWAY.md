# Backend gateway ЭПД Лайт

`server/index.mjs` — server-side контур для будущей интеграции с оператором ИС ЭПД.

Текущая версия **намеренно не умеет отправлять документы оператору**. При этом gateway уже умеет локально проверять интеграционный черновик и строить preview Kontur T1 `UserDataXml` без внешних вызовов.

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

При неполных/неподдерживаемых данных отвечает `422` и списком ошибок. В частности первая версия блокирует ИП до проверки соответствующей ветки актуального UserDataXsd.

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
  GetDocumentTypes (V3)
  GenerateTitleXml
```

`GenerateTitleXml` существует как серверная функция, но gateway её пока **не экспонирует**. Это принципиальная граница: наличие access token в env не должно автоматически включать внешний обмен.

## Переменные окружения

```env
EPD_OPERATOR_PROVIDER=none
EPD_OPERATOR_MODE=disabled
EPD_MAX_BODY_BYTES=524288
EPD_ALLOWED_ORIGINS=

# Только для будущих server-side вызовов Контур:
EPD_KONTUR_BOX_ID=
EPD_KONTUR_ACCESS_TOKEN=
```

`EPD_OPERATOR_MODE` не может включить `/send`: endpoint заблокирован кодом.

## Персональные данные и логирование

Gateway не логирует request body. В Integration JSON/UserDataXml могут находиться ФИО, телефоны, адреса и данные водительского удостоверения.

Нельзя писать полный XML/JSON ЭТрН в обычные application logs. Для аудита следует хранить отдельный минимизированный журнал: request id, внутренний document id, provider, безопасный технический статус, время, внешний идентификатор после появления интеграции и безопасный код ошибки.

## Проверки

Без внешней сети должны проходить:

```bash
npm run preflight
npm run gateway:test
npm run kontur:provider:test
npm run kontur:userdata:test
```

`gateway:test` проверяет, что локальный UserData preview работает, а `/api/operator/send` по-прежнему отвечает `503`.
