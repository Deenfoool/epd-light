# ЭПД Лайт

MVP SaaS-сервиса для подготовки, проверки и хранения **черновиков электронной транспортной накладной (ЭТрН)** для российского малого и среднего бизнеса.

> **Важно:** проект не является оператором ИС ЭПД, не подписывает документы КЭП и не отправляет сведения в ГИС ЭПД. Экспортируемый JSON, UserDataXml preview и печатная форма — черновые/интеграционные представления, а не юридически значимый документ.

## Что уже реализовано

- публичный лендинг, FAQ, CTA, тарифы и правовые шаблоны;
- официальные ссылки на ФНС и Минтранс;
- регистрация/вход через Supabase Auth;
- безопасный демо-режим на `localStorage`, если Supabase не настроен;
- онбординг организации;
- dashboard;
- список черновиков с поиском, фильтрами, дублированием, архивом и удалением;
- 6-шаговый мастер ЭТрН: участники → маршрут/погрузка → груз → транспорт/водитель → условия → проверка;
- автосохранение черновика и защита от потери последних изменений;
- draft-model v4 с обратной нормализацией старых черновиков;
- отдельные базовая готовность и operator-readiness;
- статус `Черновик готов`, который не выдаётся за XSD/операторскую готовность;
- печатное превью с watermark `ЧЕРНОВИК — НЕ ЯВЛЯЕТСЯ ПЕРЕВОЗОЧНЫМ ДОКУМЕНТОМ`;
- экспорт нормализованного JSON и operator-neutral `Integration JSON`;
- структурированные российские адреса;
- данные T1-кандидата: BoxId, ContainerType, Ownership, WeighingMethod, ВУ, фактическая погрузка, `LoadingPartyDetails` и `LoadingOwnerDetails`;
- CRUD-справочники контрагентов, транспорта и водителей с T1-полями;
- CSV-импорт контрагентов, включая `box_id` и структурированный адрес, и CSV-импорт груза;
- backend gateway с `/healthz`, capabilities и server preflight;
- локальный `Kontur UserDataXml preview` без внешнего вызова оператора;
- server-only boundary `operator candidate -> UserDataXml -> GenerateTitleXml`, не опубликованный в gateway;
- автоматический разбор `GetDocumentTypes (V3)` для поиска T1 `XsdUrl`/`UserDataXsdUrl` и загрузки схем через `GetContent`;
- `POST /api/operator/send` жёстко заблокирован и всегда остаётся fail-closed;
- SQL-миграции Supabase с Row Level Security;
- офлайн preflight и отдельные тесты gateway/Kontur-контрактов.

## Быстрый запуск

```bash
npm install
npm run preflight
npm run dev
```

Без `.env` приложение запустится в демо-режиме. Данные будут храниться только в браузере.

### Supabase / PostgreSQL

Для локальной разработки можно использовать обычный Supabase-проект. **Для коммерческого запуска в РФ не размещайте базу с персональными данными российских граждан за пределами РФ без отдельной юридической проверки.** Практичный вариант — self-hosted Supabase/PostgreSQL в российском дата-центре либо другой совместимый российский контур.

Примените миграции по порядку:

```text
supabase/migrations/202609010001_init.sql
supabase/migrations/202609010002_extend_directories_t1.sql
```

Затем скопируйте `.env.example` в `.env` и настройте публичные параметры frontend. Секреты оператора никогда не помещаются в `VITE_*`.

## Проверка и сборка

Основные офлайн-проверки:

```bash
npm run preflight
npm run gateway:test
npm run kontur:provider:test
npm run kontur:userdata:test
npm run kontur:generation:test
```

Полная production-сборка:

```bash
npm run build
npm run preview
```

### Проверка схем

Схему черновика ФНС можно проверить без операторских реквизитов:

```bash
npm run fns:schema:check
```

После получения **sandbox** BoxId и access token Диадока серверная утилита сможет сама найти актуальный T1 через `GetDocumentTypes (V3)`, скачать `XsdUrl` и `UserDataXsdUrl` через `GetContent` и вывести SHA-256:

```bash
npm run kontur:schema:check
```

Сохранить копии в игнорируемый `.cache/kontur`:

```bash
npm run kontur:schema:save
```

Эти команды используют только `EPD_KONTUR_BOX_ID` и `EPD_KONTUR_ACCESS_TOKEN` на backend/CLI и не включают отправку документа.

## Интеграция с оператором ИС ЭПД

Подробности: [`docs/OPERATOR-INTEGRATION.md`](docs/OPERATOR-INTEGRATION.md) и [`docs/BACKEND-GATEWAY.md`](docs/BACKEND-GATEWAY.md).

Текущий Контур T1-контракт:

```text
LogisticsWaybill / reception / kl_trn_mt_05_01 / titleIndex=0
```

Публичный gateway умеет только локальный preview. `GenerateTitleXml` подготовлен как server-only boundary для будущего sandbox. `PostMessage`, подписание и реальная отправка не реализованы.

## Что нужно до коммерческого запуска

- получить sandbox/партнёрский доступ выбранного аккредитованного оператора;
- получить актуальные XSD/UserDataXsd через API оператора и зафиксировать их версии/хэши;
- проверить перечисления и условную обязательность всех T1-полей;
- реализовать ИП и остальные допустимые типы участников;
- решить timezone-модель для фактических времён;
- прогнать `GenerateTitleXml` и `ParseTitleXml` в sandbox;
- добавить аутентификацию/авторизацию backend-вызовов, rate limiting и минимизированный аудит;
- реализовать signing flow;
- только после этого проектировать `PostMessage (V3)` и юридически значимые статусы;
- завершить production-контур данных в РФ, правовые документы, security-тесты и биллинг.

## Официальные источники

- ФНС — обязательный транспортный ЭДО: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/edotransp/
- ФНС — операторы ИС ЭПД: https://www.nalog.gov.ru/rn77/oedo/oisepd/
- ФНС — форматы черновиков: https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/approved_formats/16631750/
- Минтранс — ГИС ЭПД: https://www.mintrans.gov.ru/activities/376
- Диадок API — ЭТрН: https://developer.kontur.ru/doc/diadoc-api/instructions/documents/formal/waybill.html
- Диадок API — GetDocumentTypes V3: https://developer.kontur.ru/doc/diadoc-api/http/GetDocumentTypes_V3.html

## Структура исходника приложения

Основной SPA-компонент временно хранится в читаемых частях `src/app-chunks/App.*.part`. Перед `npm run dev` и `npm run build` скрипт `scripts/assemble-app.mjs` автоматически собирает из них `src/App.tsx`. Сгенерированный `src/App.tsx` добавлен в `.gitignore`.
