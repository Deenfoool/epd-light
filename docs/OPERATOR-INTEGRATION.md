# Интеграция с оператором ИС ЭПД

## Решение для MVP

`ЭПД Лайт` не является оператором ИС ЭПД. Юридически значимый обмен должен идти через аккредитованного оператора, который передаёт сведения в ГИС ЭПД.

Для первого технического адаптера выбран Контур/Диадок, потому что у него публично документированы `GetDocumentTypes (V3)`, `GenerateTitleXml` и сценарий ЭТрН. Это **не означает**, что коммерческий оператор уже окончательно выбран: перед пилотом всё равно нужны договор, условия, sandbox/тестовый доступ и подтверждение актуального контракта.

## Архитектурное правило

Интеграция должна быть **server-to-server**. В браузер нельзя помещать:

- API-ключи оператора;
- access/refresh token с правом работы с ящиком;
- приватные ключи;
- материалы КЭП;
- сервисные токены с правом отправки документов.

Фронтенд передаёт нормализованный интеграционный черновик в наш backend. Backend выполняет валидацию, преобразование в формат конкретного оператора, запросы к API и возвращает безопасный статус.

## Текущее состояние адаптера Контур

Контракт T1, зафиксированный в коде:

```text
documentTypeNamedId = LogisticsWaybill
documentFunction    = reception
documentVersion     = kl_trn_mt_05_01
titleIndex          = 0
```

Реализовано:

1. `src/operator-draft.ts` — браузер формирует operator-neutral Integration JSON (`draftModelVersion = 4`).
2. `POST /api/operator/preflight` — структурная server-side проверка без внешних вызовов.
3. `server/providers/kontur-userdata.mjs` — локальная проверка полей и построение T1 `UserDataXml` preview.
4. В preview поддержаны `LoadingPartyDetails` и `LoadingOwnerDetails`, если пользователь заполнил их явно; частично заполненный блок блокирует генерацию preview.
5. `POST /api/operator/kontur/userdata-preview` — возвращает XML preview; **Контур при этом не вызывается**.
6. `server/providers/kontur.mjs` — серверные функции для `GetDocumentTypes (V3)` и `GenerateTitleXml`.
7. `server/services/kontur-title.mjs` — server-only boundary `operator candidate -> UserDataXml -> GenerateTitleXml`. Он не опубликован как gateway endpoint и предназначен для будущего sandbox.
8. `POST /api/operator/send` — всегда отвечает `503 operator_send_disabled`.

На карточке документа кнопка `Kontur XML preview` скачивает локально сформированный `*-kontur-userdata-preview.xml`. Этот XML нужен для разработки и отладки маппинга. Он **не является** результатом `GenerateTitleXml`, не подписан, не отправлен оператору и не подтверждает соответствие итоговой XSD ФНС.

## Ограничения текущего UserDataXml preview

Первая версия намеренно fail-closed:

- участники пока поддерживаются только как организации через `OrganizationReference BoxId`;
- ИП блокируется до проверки соответствующей ветки актуального `UserDataXsd`;
- адреса погрузки и доставки формируются только из структурированных полей `RussianAddressDraft`; обычная строка адреса автоматически не разбирается;
- `LoadingPartyDetails` и `LoadingOwnerDetails` формируются только при явно введённых значениях; отсутствие блоков пока даёт предупреждение, потому что их обязательность нужно подтвердить актуальным `UserDataXsd`;
- если `MatchingShipper=1`, ИНН лица погрузки может быть взят из грузоотправителя только потому, что пользователь явно указал совпадение;
- `datetime-local` не содержит часовой пояс, поэтому preview формирует время без timezone и выставляет `EnablingTimeZone=0`; это должно быть проверено в sandbox оператора до боевого использования;
- коды `Ownership`, `WeighingMethod`, `ContainerType` и `LoadingOwnerDetails.Type` вводятся как значения контракта и должны быть окончательно сверены с актуальным `UserDataXsd/GetDocumentTypes`;
- `GenerateTitleXml` существует только как приватная server-side boundary и не вызывается из gateway;
- `PostMessage (V3)`, подписание и обработка юридически значимых статусов не реализованы.

## Статусы

До подключения оператора доступны только внутренние статусы:

1. `draft` — черновик;
2. `incomplete` — требует заполнения;
3. `ready` — внутренний черновик заполнен и пользователь подтвердил готовность;
4. `archived` — архив.

`ready` **не означает**, что документ прошёл XSD, `GenerateTitleXml`, подписание или проверку оператора.

Статусы `передан оператору`, `подписан`, `принят ГИС ЭПД` нельзя устанавливать вручную или имитировать.

## Следующие этапы

1. Получить тестовый/партнёрский доступ оператора и отдельный тестовый ящик.
2. Через `GetDocumentTypes (V3)` получить актуальные `XsdUrl`/`UserDataXsdUrl` для `LogisticsWaybill / reception / kl_trn_mt_05_01 / titleIndex=0`.
3. Добавить автоматическую проверку версии/хэша UserDataXsd и контрактных перечислений.
4. Довести UserDataXml mapping для организаций и ИП.
5. Прогнать `server/services/kontur-title.mjs` через реальный `GenerateTitleXml` только в sandbox с отдельными тестовыми реквизитами.
6. Валидировать сгенерированный T1 по актуальной схеме и сопоставить результат `ParseTitleXml` обратно с нашим черновиком.
7. До публикации внешнего GenerateTitle route добавить полноценную аутентификацию/авторизацию организации, rate limiting и аудит без логирования полного ЭТрН.
8. Добавить idempotency, журнал запросов и безопасное хранение внешних `messageId/entityId/mt-id/kl-id`.
9. Спроектировать signing flow и только после него `PostMessage (V3)`.
10. Провести тестовый обмен и только после него открыть реальную отправку пользователям.

## Источники

- ФНС — обязательный транспортный ЭДО: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/edotransp/
- ФНС — операторы ИС ЭПД: https://www.nalog.gov.ru/rn77/oedo/oisepd/
- ФНС — форматы черновиков: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/approved_formats/16631750/
- Минтранс — ГИС ЭПД: https://www.mintrans.gov.ru/activities/376
- Диадок API — работа с ЭТрН: https://developer.kontur.ru/doc/diadoc-api/instructions/documents/formal/waybill.html
- Диадок API — форматы документов: https://developer.kontur.ru/doc/diadoc-api/docflows/formats.html

Перед боевым запуском все форматы и требования нужно повторно сверить с актуальными официальными публикациями и документацией выбранного оператора.
