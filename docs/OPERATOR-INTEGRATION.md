# Интеграция с оператором ИС ЭПД

## Роль ЭПД Лайт

`ЭПД Лайт` не является оператором ИС ЭПД. Юридически значимый обмен выполняется только через аккредитованного оператора ИС ЭПД.

Первый технический adapter — Контур/Диадок, потому что публично документированы `GetDocumentTypes (V3)`, `GetContent`, `GenerateTitleXml` и формат ЭТрН. Это sandbox-технический выбор, а не утверждение о заключённом коммерческом договоре.

## Зафиксированный T1-контракт

```text
documentTypeNamedId = LogisticsWaybill
documentFunction    = reception
documentVersion     = kl_trn_mt_05_01
titleIndex          = 0
```

Версия не меняется автоматически. Drift требует ручной проверки mapping.

## Реализованные уровни

### 1. Operator-neutral draft

`src/operator-draft.ts` строит `epd-light/operator-candidate-v1` из draft-model v4.

Он удобен для preview/debug, но неавторитетен для реального внешнего operator-call.

### 2. Local UserDataXml preview

```text
POST /api/operator/kontur/userdata-preview
```

Контур не вызывается.

### 3. Canonical RLS reload

Для внешнего вызова browser передаёт только `documentId`.

Backend:

1. проверяет Supabase JWT через JWKS;
2. использует USER JWT для Supabase Data API;
3. RLS `auth.uid() = user_id` ограничивает документ;
4. заново строит candidate из `documents` row;
5. сверяет `row.user_id` и JWT `sub`.

### 4. SHA-256 idempotency identity

После canonical reload backend строит identity из:

```text
documentId
documents.updated_at
provider
mode
operation
documentVersion
titleIndex
```

Дополнительно SHA-256 `requestFingerprint` считается от canonical candidate.

Browser idempotency key не принимается как авторитетный.

### 5. In-process duplicate collapse

Одновременные запросы одной и той же revision в одном gateway-процессе делят один Promise. Второй caller получает shared result, а второго `GenerateTitleXml` нет.

### 6. Persistent operator journal

`public.operator_attempts` хранит только technical metadata. Browser может читать только свои записи через RLS и не имеет `INSERT/UPDATE/DELETE`.

Пятая миграция создаёт restricted `NOLOGIN` role:

```text
epd_gateway_writer
```

Server runtime использует отдельный PostgreSQL LOGIN с membership в этой роли:

```env
EPD_GATEWAY_DATABASE_URL=postgresql://RESTRICTED_LOGIN:...@DB/epd_light
EPD_GATEWAY_DATABASE_ROLE=epd_gateway_writer
```

Gateway делает `SET LOCAL ROLE epd_gateway_writer`.

При configured repository lifecycle выглядит так:

```text
claim started
 -> external GenerateTitleXml
 -> succeeded | failed
```

Уже успешный action той же revision после restart возвращает `sandbox_already_generated` до нового operator-call.

Зависший `started` считается retry-able только после `EPD_OPERATOR_ATTEMPT_STALE_MS`.

Journal не хранит XML, Integration JSON, access tokens, ФИО или другие document payload fields.

### 7. Sandbox GenerateTitleXml

Endpoint:

```text
POST /api/operator/kontur/generate-title-sandbox
```

Требует:

```env
EPD_DEPLOYMENT_MODE=production
EPD_OPERATOR_PROVIDER=kontur
EPD_OPERATOR_MODE=sandbox
EPD_GATEWAY_AUTH_MODE=supabase
```

Request строго:

```json
{
  "documentId": "uuid"
}
```

Flow:

```text
documentId
 -> JWT/JWKS
 -> user JWT RLS reload
 -> canonical mapper
 -> ownership check
 -> idempotency identity
 -> optional persistent claim
 -> in-process dedupe
 -> validateKonturT1Candidate
 -> UserDataXml
 -> GenerateTitleXml
 -> journal result
```

Результат всё ещё:

```text
signed=false
sent=false
```

`PostMessage` не вызывается.

### 8. Production send

**Не реализован.**

```text
POST /api/operator/send -> 503 operator_send_disabled
```

## Authentication/authorization

Внешние operator routes защищают:

- production deployment guard;
- Supabase JWT/JWKS;
- `aud=authenticated`;
- `role=authenticated`;
- `RS256/ES256` allow-list;
- pre-auth network rate-limit;
- user rate-limit;
- external-call rate-limit;
- RLS canonical reload;
- повторная ownership check;
- server-derived idempotency.

## UserDataXml preview — что уже маппится

- `OrganizationReference BoxId`;
- shipper/consignee/carrier;
- structured load/delivery addresses;
- cargo/item description;
- ContainerType/marking;
- driver + ВУ;
- Vehicle/Ownership;
- LoadingInfo;
- WeighingMethod;
- LoadingPartyDetails;
- LoadingOwnerDetails;
- Signer.

## Незакрытые format-вопросы

До актуального sandbox UserDataXsd остаются fail-closed:

- ИП и остальные типы участников;
- полные enum Ownership/ContainerType/WeighingMethod;
- `LoadingOwnerDetails.Type`;
- условная обязательность loading blocks;
- timezone semantics;
- обратная проверка generated XML.

## Schema discovery

```bash
npm run kontur:schema:check
npm run kontur:schema:save
```

Flow:

```text
GetDocumentTypes (V3)
 -> pinned T1 descriptor
 -> XsdUrl/UserDataXsdUrl
 -> GetContent
 -> SHA-256
```

## Следующие этапы

1. Получить реальный sandbox/partner API доступ.
2. Получить и захешировать актуальные XSD/UserDataXsd.
3. Сверить enums/conditional requiredness.
4. Исправить mapping.
5. Создать отдельный restricted gateway DB LOGIN и проверить persistent journal на реальной DB.
6. Выполнить первый реальный `GenerateTitleXml` на вымышленных данных.
7. Проверить returned XML/ParseTitleXml, если сценарий доступен.
8. Определить signing flow.
9. Только после signing проектировать `PostMessage`.
10. Добавить external message/entity IDs в metadata journal.
11. Реализовать operator status/webhook reconciliation.
12. Провести end-to-end sandbox test.
13. Только после этого открывать production send.

## Внутренние статусы документа

Пока разрешены:

```text
draft
incomplete
ready
archived
```

Успешный sandbox `GenerateTitleXml` не превращает документ в `sent/signed/accepted`.

## Privacy

Application log и operator journal не должны содержать полный document payload, XML, JWT/operator token или ПД. Допустимы только технические metadata и safe error codes.

## Источники

- ФНС — обязательный транспортный ЭДО: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/edotransp/
- ФНС — операторы ИС ЭПД: https://www.nalog.gov.ru/rn77/oedo/oisepd/
- ФНС — форматы: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/approved_formats/16631750/
- Минтранс — ГИС ЭПД: https://www.mintrans.gov.ru/activities/376
- Диадок API — ЭТрН: https://developer.kontur.ru/doc/diadoc-api/instructions/documents/formal/waybill.html
- Диадок API — форматы: https://developer.kontur.ru/doc/diadoc-api/docflows/formats.html

Перед production версии/требования повторно сверяются с актуальной официальной документацией и договором выбранного оператора.
