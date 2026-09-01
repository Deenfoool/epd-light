# Развёртывание ЭПД Лайт

## 1. Демо-режим

Если переменные Supabase не заданы, приложение запускается как локальное демо. Данные сохраняются в `localStorage` текущего браузера и не отправляются в базу.

```bash
npm install
npm run preflight
npm run dev
```

Такой режим подходит только для демонстрации интерфейса и ручного тестирования.

## 2. Облачный режим разработки

Frontend использует две переменные:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

Все переменные с префиксом `VITE_` попадают в клиентский JavaScript и **считаются публичными**.

Нельзя помещать в `VITE_*`:

- `service_role` ключ Supabase;
- API-ключ оператора ИС ЭПД;
- приватные ключи;
- материалы КЭП;
- токены, позволяющие подписывать или отправлять ЭПД от имени организации.

Перед запуском облачного режима примените **все миграции по порядку**:

```text
supabase/migrations/202609010001_init.sql
supabase/migrations/202609010002_extend_directories_t1.sql
```

Вторая миграция добавляет в справочники повторно используемые T1-поля: тип контрагента, BoxId/ID ЭДО, структурированный адрес, параметры ТС и раздельные реквизиты водительского удостоверения. Без неё новые формы справочников нельзя считать совместимыми с облачной БД.

RLS должен оставаться включённым для всех пользовательских таблиц.

## 3. Только frontend через Docker

Сборка:

```bash
docker build \
  --build-arg VITE_SUPABASE_URL="https://your-public-api.example.ru" \
  --build-arg VITE_SUPABASE_ANON_KEY="your-public-anon-key" \
  -t epd-light:latest .
```

Запуск:

```bash
docker run --rm -p 8080:8080 epd-light:latest
```

Проверка:

```bash
curl http://127.0.0.1:8080/healthz
```

В образе используется nginx с SPA fallback, поэтому прямые переходы на `/app/...` должны возвращать `index.html`, а не 404.

## 4. Frontend + private backend gateway через Docker Compose

Для дальнейшей разработки рекомендуется уже этот режим:

```bash
cp .env.example .env
# заполнить только публичные VITE_* параметры

docker compose up -d --build
```

Открыть:

```text
http://SERVER_IP:8080
```

Проверка frontend:

```bash
curl http://127.0.0.1:8080/healthz
```

Проверка gateway через nginx:

```bash
curl http://127.0.0.1:8080/api/operator/capabilities
```

Gateway работает в приватной Docker-сети и его порт `8787` наружу не публикуется.

В MVP ответ capabilities должен показывать:

```json
{
  "externalSendEnabled": false,
  "xsdValidationEnabled": false
}
```

Если эти значения неожиданно меняются без отдельной реализации и проверки provider adapter, deployment нужно считать некорректным.

## 5. Проверка актуальности XSD ФНС

В среде с доступом в интернет:

```bash
npm run fns:schema:check
```

Команда скачивает опубликованную ФНС XSD черновика Т1, проверяет что ответ похож на XSD и выводит SHA-256.

Для сохранения локальной копии в `.cache/fns`:

```bash
npm run fns:schema:save
```

Кэш не коммитится в Git. Изменение SHA-256 — повод повторно проверить mapping до production-отправки.

## 6. Контур данных для РФ

Production-размещение базы и обработку персональных данных нужно проектировать отдельно с учётом применимых требований российского законодательства, договоров с провайдерами и фактического состава данных. В справочнике водителей, например, могут находиться ФИО, телефон и данные удостоверения.

Практический вариант архитектуры:

```text
Браузер
   |
   | HTTPS
   v
nginx / ЭПД Лайт
   |                 \
   | public API       \ /api/operator/*
   v                   v
PostgreSQL/Auth       private gateway
в production-контуре      |
                          v
                    API оператора ИС ЭПД
                          |
                          v
                        ГИС ЭПД
```

До юридической проверки production-схемы не следует считать обычный зарубежный Supabase-проект готовым контуром для коммерческой обработки персональных данных граждан РФ.

## 7. Интеграция с оператором

Реальная отправка выполняется только backend-сервисом. Frontend формирует внутренний черновик и `Integration JSON`, который также **не является** документом ФНС.

Локальный `Kontur XML preview` строится внутри gateway без обращения в Диадок. Для реального `GenerateTitleXml` нужно отдельно получить операторский тестовый доступ и актуальный `UserDataXsd`.

См.:

- [`OPERATOR-INTEGRATION.md`](OPERATOR-INTEGRATION.md)
- [`BACKEND-GATEWAY.md`](BACKEND-GATEWAY.md)
- [`FNS-ETRN-MAPPING.md`](FNS-ETRN-MAPPING.md)

## 8. Минимальный checklist перед пилотом

- [ ] `npm run preflight` проходит;
- [ ] `npm run gateway:test` проходит;
- [ ] `npm run kontur:provider:test` проходит;
- [ ] `npm run kontur:userdata:test` проходит;
- [ ] `npm run build` проходит;
- [ ] `npm run fns:schema:check` показывает ожидаемую схему;
- [ ] Docker Compose поднимает frontend и gateway;
- [ ] `/api/operator/capabilities` показывает `externalSendEnabled=false` до реальной интеграции;
- [ ] применены обе SQL-миграции в порядке `001 -> 002`;
- [ ] RLS проверен двумя разными тестовыми аккаунтами;
- [ ] Redirect URL для Auth ограничены реальными доменами;
- [ ] production env не содержит секретов в `VITE_*`;
- [ ] gateway не публикуется отдельным портом наружу;
- [ ] настроен HTTPS;
- [ ] настроено резервное копирование PostgreSQL;
- [ ] подготовлены финальные политика конфиденциальности и соглашение;
- [ ] выбран оператор ИС ЭПД и получена его актуальная документация;
- [ ] UserDataXml проверен по актуальному UserDataXsd;
- [ ] XSD/API-валидация ЭТрН пройдена до открытия реальной отправки.
