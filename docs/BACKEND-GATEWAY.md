# Backend gateway ЭПД Лайт

`server/index.mjs` — минимальный server-side контур для будущей интеграции с оператором ИС ЭПД.

Текущая версия **намеренно не умеет отправлять документы оператору**.

## Зачем он нужен

Секреты оператора, сервисные токены, закрытые ключи и материалы электронной подписи нельзя помещать в React/Vite frontend. Любой `VITE_*` параметр попадает в браузер.

Поэтому будущая цепочка выглядит так:

```text
Browser -> HTTPS -> nginx -> /api/operator/* -> private gateway -> provider adapter -> operator IS EPD
```

Порт gateway в `docker-compose.yml` наружу не публикуется.

## Endpoints

### `GET /healthz`

Проверка здоровья процесса.

### `GET /api/operator/capabilities`

Возвращает текущий режим gateway. В MVP всегда:

```json
{
  "externalSendEnabled": false,
  "xsdValidationEnabled": false
}
```

Frontend показывает этот статус на странице «Интеграции».

### `POST /api/operator/preflight`

Принимает `epd-light/operator-candidate-v1` и выполняет только server-side sanity check структуры.

Это **не XSD-валидация** и не обращение к оператору.

### `POST /api/operator/send`

В текущей версии всегда отвечает `503 operator_send_disabled`.

Этот endpoint нельзя открывать до выполнения всех пунктов:

1. выбран конкретный оператор;
2. получена актуальная API-документация и тестовый доступ;
3. реализован provider adapter;
4. настроена серверная аутентификация пользователя/организации;
5. реализован mapping на принятый оператором формат;
6. добавлена XSD-валидация там, где она применима;
7. определён механизм подписи;
8. проведены тесты в контуре оператора;
9. юридически согласована production-модель.

## Переменные окружения

```env
EPD_OPERATOR_PROVIDER=none
EPD_OPERATOR_MODE=disabled
EPD_MAX_BODY_BYTES=524288
EPD_ALLOWED_ORIGINS=
```

`EPD_OPERATOR_PROVIDER` пока информационный. Значение не включает отправку.

`EPD_OPERATOR_MODE` пока также не может включить отправку: код endpoint `/send` заблокирован независимо от env. Это сделано специально для fail-closed поведения.

## Персональные данные и логирование

Gateway не логирует request body. Это важно, потому что в интеграционном payload могут быть ФИО, телефоны и сведения о водительском удостоверении.

При дальнейшем развитии нельзя писать полный XML/JSON ЭТрН в обычные application logs. Для аудита следует хранить отдельный минимизированный журнал: request id, document id, provider, технический статус, время и безопасный код ошибки.

## Следующий backend milestone

После выбора оператора создать, например:

```text
server/providers/kontur.mjs
```

или

```text
server/providers/taxcom.mjs
```

Provider должен реализовать этапы `preflight -> create draft/title -> get status`, а общий gateway не должен знать детали конкретного API.
