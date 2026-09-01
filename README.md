# ЭПД Лайт

MVP SaaS-сервиса для подготовки, проверки и хранения **черновиков электронной транспортной накладной (ЭТрН)** для российского малого и среднего бизнеса.

> **Важно:** проект не является оператором ИС ЭПД. Production-отправка, подписание и `PostMessage` не реализованы. Даже результат sandbox `GenerateTitleXml` не является подписанным или отправленным ЭПД.

## Что уже реализовано

- публичный лендинг, FAQ, CTA, тарифы и правовые шаблоны;
- регистрация/вход через Supabase Auth и demo-режим на `localStorage`;
- dashboard, список документов и 6-шаговый мастер ЭТрН;
- автосохранение и защита от потери последних изменений;
- draft-model v4 с обратной нормализацией старых черновиков;
- базовая валидация отдельно от operator-readiness;
- печатное превью с watermark `ЧЕРНОВИК — НЕ ЯВЛЯЕТСЯ ПЕРЕВОЗОЧНЫМ ДОКУМЕНТОМ`;
- нормализованный JSON и operator-neutral `Integration JSON`;
- структурированные российские адреса;
- T1-поля: BoxId, ContainerType, Ownership, WeighingMethod, ВУ, фактическая погрузка, `LoadingPartyDetails`, `LoadingOwnerDetails`;
- справочники контрагентов, транспорта и водителей с T1-полями;
- CSV-импорт контрагентов и груза;
- private backend gateway за nginx;
- Supabase JWT/JWKS-аутентификация gateway по асимметричной подписи;
- rate limiting: отдельные лимиты до auth, после auth и для реальных внешних operator-вызовов;
- privacy-safe audit без request body, XML, токенов, ФИО и других данных документа;
- локальный `Kontur UserDataXml preview` без обращения к оператору;
- server-side canonical document repository через Supabase Data API под **пользовательским JWT**;
- RLS `auth.uid() = user_id` остаётся авторитетной проверкой доступа к документу;
- backend заново строит operator candidate из строки `documents`, а не доверяет Integration JSON из браузера;
- автоматический разбор `GetDocumentTypes (V3)` для поиска T1 `XsdUrl`/`UserDataXsdUrl`;
- server-only `GenerateTitleXml` boundary;
- **sandbox gateway route** `/api/operator/kontur/generate-title-sandbox`, который:
  - включается только при `EPD_OPERATOR_MODE=sandbox` и `EPD_OPERATOR_PROVIDER=kontur`;
  - требует проверенный Supabase JWT;
  - принимает только `{ "documentId": "..." }`;
  - перечитывает документ через Supabase RLS;
  - повторно проверяет владельца;
  - вызывает только `GenerateTitleXml`;
  - не подписывает XML;
  - не вызывает `PostMessage`;
- кнопка `Kontur sandbox` на карточке документа появляется только когда backend сообщает `ready=true`;
- `/api/operator/send` остаётся жёстко заблокированным;
- SQL-миграции Supabase с Row Level Security;
- офлайн preflight и отдельные тесты auth/RLS/Kontur/security boundaries.

## Быстрый запуск

```bash
npm install
npm run preflight
npm run dev
```

Без `.env` приложение запускается в demo-режиме. Данные хранятся в браузере.

## Supabase / PostgreSQL

Примените миграции по порядку:

```text
supabase/migrations/202609010001_init.sql
supabase/migrations/202609010002_extend_directories_t1.sql
```

Для production-контуров с персональными данными российских граждан размещение и архитектуру нужно отдельно сверить с применимыми требованиями российского законодательства. Практический целевой вариант проекта — PostgreSQL/Auth/backend в российском контуре.

Секреты оператора и любые server-only ключи никогда не помещаются в `VITE_*`.

## Основные проверки

```bash
npm run preflight
npm run audit:test
npm run authorization:test
npm run repository:test
npm run rate-limit:test
npm run gateway:test
npm run kontur:provider:test
npm run kontur:userdata:test
npm run kontur:generation:test
npm run kontur:sandbox:test
```

После `npm install` также доступны криптографические тесты JWT/JWKS:

```bash
npm run auth:test
npm run gateway:auth:test
```

Production-сборка:

```bash
npm run build
npm run preview
```

## Проверка схем

Проверка опубликованной схемы ФНС:

```bash
npm run fns:schema:check
```

После получения sandbox BoxId и access token Диадока:

```bash
npm run kontur:schema:check
```

Команда через `GetDocumentTypes (V3) + GetContent` находит текущий зафиксированный T1-контракт, получает Title XSD/UserDataXsd и выводит SHA-256. Новая версия не подхватывается автоматически: изменение контракта требует ручной проверки mapping.

Сохранить схемы в игнорируемый `.cache/kontur`:

```bash
npm run kontur:schema:save
```

## Три разных уровня интеграции

### 1. Local preview

```text
Browser -> Integration JSON -> gateway -> UserDataXml preview
```

Внешнего вызова Контур нет.

### 2. Sandbox GenerateTitleXml

```text
Browser sends documentId
  -> JWT/JWKS auth
  -> rate limit
  -> Supabase Data API with USER JWT
  -> RLS
  -> canonical documents row
  -> server mapping
  -> ownership check
  -> UserDataXml
  -> Kontur GenerateTitleXml
```

Для намеренного включения:

```env
EPD_OPERATOR_PROVIDER=kontur
EPD_OPERATOR_MODE=sandbox
EPD_GATEWAY_AUTH_MODE=supabase
EPD_AUTH_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EPD_DATA_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EPD_DATA_SUPABASE_PUBLIC_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
EPD_KONTUR_BOX_ID=...
EPD_KONTUR_ACCESS_TOKEN=...
```

Sandbox-результат скачивается как XML, но **не подписывается и не отправляется**.

### 3. Production send

Пока отсутствует намеренно:

```text
GenerateTitleXml -> signing -> PostMessage -> operator statuses -> GIS EPD
```

`POST /api/operator/send` отвечает `503 operator_send_disabled`.

## Что нужно до коммерческого запуска

- получить реальный sandbox/партнёрский доступ выбранного оператора;
- получить актуальные XSD/UserDataXsd и зафиксировать версии/хэши;
- прогнать наш canonical mapping через реальный `GenerateTitleXml`;
- исправить все отклонения от UserDataXsd;
- реализовать ИП и остальные допустимые типы участников;
- решить timezone-модель для фактических времён;
- выполнить sandbox `ParseTitleXml`/обратную проверку результата;
- определить и реализовать signing flow;
- только после этого проектировать `PostMessage` и юридически значимые статусы;
- развернуть production-контур данных в РФ;
- настроить домен, HTTPS, backups, мониторинг и recovery;
- завершить правовые документы, security-тесты и биллинг.

## Документация

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/BACKEND-GATEWAY.md`](docs/BACKEND-GATEWAY.md)
- [`docs/OPERATOR-INTEGRATION.md`](docs/OPERATOR-INTEGRATION.md)
- [`docs/FNS-ETRN-MAPPING.md`](docs/FNS-ETRN-MAPPING.md)

## Официальные источники

- ФНС — обязательный транспортный ЭДО: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/edotransp/
- ФНС — операторы ИС ЭПД: https://www.nalog.gov.ru/rn77/oedo/oisepd/
- ФНС — форматы черновиков: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/approved_formats/16631750/
- Минтранс — ГИС ЭПД: https://www.mintrans.gov.ru/activities/376
- Диадок API — ЭТрН: https://developer.kontur.ru/doc/diadoc-api/instructions/documents/formal/waybill.html
- Диадок API — GetDocumentTypes V3: https://developer.kontur.ru/doc/diadoc-api/http/GetDocumentTypes_V3.html

## Структура SPA-исходника

Основной SPA-компонент временно хранится в `src/app-chunks/App.*.part`. Перед `npm run dev` и `npm run build` `scripts/assemble-app.mjs` собирает их в игнорируемый `src/App.tsx`.
