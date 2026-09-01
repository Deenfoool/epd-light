# Интеграция с оператором ИС ЭПД

## Роль ЭПД Лайт

`ЭПД Лайт` не является оператором ИС ЭПД. Юридически значимый обмен должен выполняться через аккредитованного оператора ИС ЭПД.

Первый технический адаптер строится под Контур/Диадок из-за публичной документации `GetDocumentTypes (V3)`, `GetContent`, `GenerateTitleXml` и ЭТрН. Это пока технический выбор для sandbox, а не окончательно заключённый коммерческий договор.

## Зафиксированный T1-контракт

```text
documentTypeNamedId = LogisticsWaybill
documentFunction    = reception
documentVersion     = kl_trn_mt_05_01
titleIndex          = 0
```

Новая версия не переключается автоматически. Если `GetDocumentTypes (V3)` перестанет возвращать зафиксированную версию, schema checker должен остановиться и потребовать ручной проверки mapping.

## Реализованные уровни

### 1. Operator-neutral draft

`src/operator-draft.ts` строит `epd-light/operator-candidate-v1` из внутреннего draft-model v4.

Он используется для preview/debug и **не является авторитетным источником для внешнего operator-вызова**.

### 2. Local UserDataXml preview

```text
POST /api/operator/kontur/userdata-preview
```

Gateway проверяет candidate и локально строит `LogisticsWaybillConsignorTitle`.

Контур при этом не вызывается.

### 3. Canonical RLS reload

Для внешнего вызова браузер передаёт только `documentId`.

Backend:

1. проверяет Supabase JWT через JWKS;
2. использует тот же пользовательский JWT для Supabase Data API;
3. RLS `auth.uid() = user_id` ограничивает чтение документа;
4. backend заново строит candidate из строки `documents`;
5. повторно сверяет `row.user_id` и JWT `sub`.

Клиент не может подменить груз/участника/водителя, отправив изменённый Integration JSON непосредственно во внешний boundary.

### 4. Sandbox GenerateTitleXml

Реализован endpoint:

```text
POST /api/operator/kontur/generate-title-sandbox
```

Он работает только в:

```env
EPD_OPERATOR_PROVIDER=kontur
EPD_OPERATOR_MODE=sandbox
EPD_GATEWAY_AUTH_MODE=supabase
```

Тело строго:

```json
{
  "documentId": "uuid"
}
```

Дополнительные поля отклоняются.

Flow:

```text
documentId
 -> JWT/JWKS
 -> RLS document reload
 -> canonical mapper
 -> ownership check
 -> validateKonturT1Candidate
 -> UserDataXml
 -> GenerateTitleXml
```

Результат:

- `externalCallMade=true`;
- `signed=false`;
- `sent=false`;
- `PostMessage` не вызывается.

На карточке документа кнопка `Kontur sandbox` появляется только если `/capabilities` возвращает `sandboxGenerateTitle.ready=true`. Перед внешним вызовом UI показывает отдельное подтверждение.

### 5. Production send

**Не реализован.**

`POST /api/operator/send` всегда отвечает `503 operator_send_disabled`.

## Authentication и authorization

Внешние operator routes защищены:

- Supabase JWT/JWKS verification;
- `aud=authenticated`;
- `role=authenticated`;
- асимметричные `RS256/ES256`;
- pre-auth network rate limit;
- user rate limit по хешу `sub`;
- отдельный строгий external-call rate limit;
- RLS canonical document reload;
- повторная ownership-проверка.

Для RLS repository используется публичный anon/publishable key + пользовательский JWT. `service_role` для пользовательского operator flow не нужен.

## Privacy-safe audit

В application log разрешены только технические метаданные: request id, route, status, duration и безопасный error code.

Не логируются:

- request/response document body;
- UserDataXml/generated XML;
- ФИО;
- телефоны;
- ИНН;
- адреса;
- ВУ;
- BoxId документа;
- пользовательский JWT;
- operator access token.

## Что уже маппится в UserDataXml preview

- организации через `OrganizationReference BoxId`;
- грузоотправитель/грузополучатель/перевозчик;
- структурированные адреса погрузки/доставки;
- CargoInfo/ItemDescription;
- ContainerType;
- маркировка;
- водитель и реквизиты ВУ;
- Vehicle/Ownership;
- LoadingInfo;
- WeighingMethod;
- `LoadingPartyDetails` при явном заполнении;
- `LoadingOwnerDetails` при явном заполнении;
- Signer.

## Незакрытые format-вопросы

До реального sandbox ответа актуального `UserDataXsd` остаются намеренно fail-closed:

- ИП и иные допустимые типы участников;
- полные enum `Ownership`;
- полные enum `ContainerType`;
- полные enum `WeighingMethod`;
- `LoadingOwnerDetails.Type`;
- условная обязательность LoadingParty/Owner;
- timezone-модель для фактических времён;
- окончательная обратная проверка результата `GenerateTitleXml`.

## Schema discovery

После получения sandbox BoxId/token:

```bash
npm run kontur:schema:check
```

Используются:

```text
GetDocumentTypes (V3)
  -> LogisticsWaybill/reception/kl_trn_mt_05_01/title 0
  -> XsdUrl
  -> UserDataXsdUrl
  -> GetContent
  -> SHA-256
```

Сохранить схемы:

```bash
npm run kontur:schema:save
```

## Следующие этапы

1. Получить реальный sandbox/партнёрский доступ оператора.
2. Запустить `kontur:schema:check` на тестовом ящике.
3. Сверить каждый enum и условно обязательный элемент UserDataXsd.
4. Исправить mapping.
5. Запустить первый реальный `Kontur sandbox` на полностью вымышленных тестовых данных.
6. Проверить возвращённый XML и `ParseTitleXml`, если доступно для сценария.
7. Добавить хранение sandbox-технического результата без превращения его в юридический статус.
8. Спроектировать signing flow.
9. Только после signing flow проектировать `PostMessage`.
10. Добавить idempotency/external identifiers для отправки.
11. Провести end-to-end тестовый обмен.
12. Только после этого открывать production send.

## Внутренние статусы

Пока разрешены только:

- `draft`;
- `incomplete`;
- `ready` — внутренний черновик;
- `archived`.

Успешный `GenerateTitleXml` в sandbox **не меняет** документ на `sent`, `signed` или `accepted`.

## Источники

- ФНС — обязательный транспортный ЭДО: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/edotransp/
- ФНС — операторы ИС ЭПД: https://www.nalog.gov.ru/rn77/oedo/oisepd/
- ФНС — форматы черновиков: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/approved_formats/16631750/
- Минтранс — ГИС ЭПД: https://www.mintrans.gov.ru/activities/376
- Диадок API — ЭТрН: https://developer.kontur.ru/doc/diadoc-api/instructions/documents/formal/waybill.html
- Диадок API — форматы: https://developer.kontur.ru/doc/diadoc-api/docflows/formats.html

Перед production все требования и версии повторно сверяются с актуальными официальными источниками и договором выбранного оператора.
