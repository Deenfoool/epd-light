# Развёртывание ЭПД Лайт

## Режимы

Проект сейчас поддерживает три разных режима, которые нельзя смешивать:

1. **Demo** — localStorage/GitHub Pages, без backend и реальных документов.
2. **Cloud app** — Auth + PostgreSQL/Supabase + private gateway, но operator mode `disabled`.
3. **Kontur sandbox** — тот же cloud app, но gateway дополнительно может выполнить `GenerateTitleXml`. Подписание и `PostMessage` всё равно запрещены.

## 1. Demo

```bash
npm install
npm run preflight
npm run dev
```

Без Supabase env данные остаются в браузере.

Публичный GitHub Pages стенд нужен только для UI-демонстрации и не является production-контуром.

## 2. Production data/auth prerequisites

Перед запуском cloud app нужны:

```env
VITE_SUPABASE_URL=https://YOUR_DATA_HOST
VITE_SUPABASE_ANON_KEY=PUBLIC_KEY

EPD_GATEWAY_AUTH_MODE=supabase
EPD_AUTH_SUPABASE_URL=https://YOUR_DATA_HOST
EPD_AUTH_AUDIENCE=authenticated

EPD_DATA_SUPABASE_URL=https://YOUR_DATA_HOST
EPD_DATA_SUPABASE_PUBLIC_KEY=PUBLIC_KEY
```

Frontend key и Data API key должны быть публичным anon/publishable key, **не `service_role`**.

Примените миграции:

```text
supabase/migrations/202609010001_init.sql
supabase/migrations/202609010002_extend_directories_t1.sql
```

RLS `documents_own` должна оставаться активной:

```text
auth.uid() = user_id
```

Backend sandbox flow специально читает документ через Data API под пользовательским JWT, чтобы эта RLS оставалась авторитетной.

## 3. Production env-check до Docker

Скопируйте пример:

```bash
cp .env.example .env.production
```

Заполните значения и выполните:

```bash
set -a
. ./.env.production
set +a
npm run deploy:check
```

Checker останавливает запуск при типичных опасных настройках:

- gateway auth не `supabase`;
- HTTP URL вместо HTTPS;
- отсутствующий Data API public key;
- `service_role` вместо public key;
- wildcard CORS;
- подозрительный секрет в `VITE_*`;
- внешний rate limit выше обычного;
- sandbox без Kontur BoxId/token.

Сам checker не печатает значения секретов.

## 4. Docker Compose

Сборка и запуск:

```bash
docker compose --env-file .env.production up -d --build
```

Проверить контейнеры:

```bash
docker compose ps
```

Проверить frontend/nginx:

```bash
curl -i http://127.0.0.1:8080/healthz
```

Проверить gateway через nginx:

```bash
curl -s http://127.0.0.1:8080/api/operator/capabilities
```

Порт gateway `8787` не публикуется наружу.

До намеренного sandbox-теста используйте:

```env
EPD_OPERATOR_PROVIDER=none
EPD_OPERATOR_MODE=disabled
```

Внешняя отправка при этом и в sandbox остаётся:

```json
{
  "externalSendEnabled": false
}
```

## 5. HTTPS и внешний reverse proxy

Пользовательский домен должен открываться только по HTTPS.

Целевая схема:

```text
Internet
  -> :443 reverse proxy / TLS
  -> 127.0.0.1:8080 project nginx
  -> frontend or /api/*
  -> private gateway:8787
```

Не публикуйте `8787` в firewall/security group.

`EPD_ALLOWED_ORIGINS` должен содержать точные HTTPS origins, например:

```env
EPD_ALLOWED_ORIGINS=https://epd.example.ru
```

Не используйте `*`.

После выбора production-домена добавьте его в разрешённые redirect URLs Supabase Auth.

## 6. Auth smoke test

Проверьте двумя отдельными тестовыми аккаунтами:

1. пользователь A создаёт документ;
2. пользователь B не видит документ A в приложении;
3. прямой Data API запрос B к ID документа A не возвращает строку;
4. operator gateway запрос без Bearer token получает `401`;
5. operator gateway запрос с валидным JWT работает в рамках лимитов.

Нельзя считать только frontend-фильтрацию проверкой разграничения доступа — нужна именно RLS.

## 7. Local UserDataXml preview

При `EPD_OPERATOR_MODE=disabled` можно тестировать:

```text
POST /api/operator/preflight
POST /api/operator/kontur/userdata-preview
```

Эти endpoints не делают внешних operator-вызовов.

## 8. Проверка схем

ФНС:

```bash
npm run fns:schema:check
```

После получения Kontur sandbox credentials:

```bash
npm run kontur:schema:check
```

Для сохранения XSD/UserDataXsd в игнорируемый cache:

```bash
npm run kontur:schema:save
```

Изменение версии/хэша схемы не должно автоматически менять mapping. Сначала ручная проверка.

## 9. Намеренное включение Kontur sandbox

Только после успешных auth/RLS/schema проверок измените server env:

```env
EPD_OPERATOR_PROVIDER=kontur
EPD_OPERATOR_MODE=sandbox
EPD_GATEWAY_AUTH_MODE=supabase
EPD_KONTUR_BOX_ID=...
EPD_KONTUR_ACCESS_TOKEN=...
EPD_EXTERNAL_RATE_LIMIT_MAX=10
```

Повторно:

```bash
npm run deploy:check
docker compose --env-file .env.production up -d --build
```

В `/api/operator/capabilities` должно появиться:

```text
sandboxGenerateTitle.enabled = true
sandboxGenerateTitle.ready   = true
```

После этого на карточке документа появляется `Kontur sandbox`.

Кнопка:

1. показывает явное подтверждение;
2. отправляет gateway только `documentId`;
3. gateway проверяет JWT;
4. перечитывает document row через Supabase RLS;
5. заново строит canonical candidate;
6. вызывает `GenerateTitleXml`;
7. возвращает XML;
8. **не подписывает**;
9. **не вызывает `PostMessage`**.

## 10. Что нельзя включать даже в sandbox

- `POST /api/operator/send`;
- `PostMessage`;
- автоматическое присвоение статуса «отправлен»;
- signing flow без отдельной реализации;
- `service_role` для обхода пользовательской RLS;
- operator access token в `VITE_*`;
- полный XML/JSON документа в application logs.

## 11. Backup и recovery

До первых реальных клиентов обязательно:

- ежедневный backup PostgreSQL;
- отдельное хранение backup от основного VPS;
- шифрование backup;
- тест восстановления на отдельной БД;
- документированный RPO/RTO;
- backup env/secrets через отдельное защищённое хранилище, не Git.

## 12. Минимальный server-day checklist

Перед открытием домена:

- [ ] `npm run preflight`;
- [ ] `npm run deploy:env:test`;
- [ ] `npm run deploy:check` с production env;
- [ ] `npm run audit:test`;
- [ ] `npm run authorization:test`;
- [ ] `npm run repository:test`;
- [ ] `npm run rate-limit:test`;
- [ ] `npm run gateway:test`;
- [ ] `npm run auth:test`;
- [ ] `npm run gateway:auth:test`;
- [ ] `npm run kontur:userdata:test`;
- [ ] `npm run kontur:generation:test`;
- [ ] `npm run kontur:sandbox:test`;
- [ ] `npm run build`;
- [ ] обе SQL-миграции применены;
- [ ] RLS проверена двумя аккаунтами;
- [ ] HTTPS работает;
- [ ] Auth redirect URL ограничены доменом;
- [ ] `EPD_ALLOWED_ORIGINS` содержит только нужный HTTPS origin;
- [ ] порт gateway не открыт наружу;
- [ ] backup создан и тест восстановления запланирован;
- [ ] `externalSendEnabled=false`;
- [ ] production `PostMessage` отсутствует.

## Контур данных РФ

Production-размещение базы, backend, логов, backup и обработку персональных данных нужно строить с учётом применимых требований российского законодательства и фактического состава данных. Для проекта планируется российский production-контур; зарубежный demo/development backend не следует автоматически считать подходящим для реальных персональных данных.
