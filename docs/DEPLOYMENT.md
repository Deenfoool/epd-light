# Развёртывание ЭПД Лайт

## Режимы

Проект поддерживает три разных режима:

1. **Demo** — localStorage/GitHub Pages, без backend и реальных документов.
2. **Cloud app** — Auth + PostgreSQL/Supabase + private gateway, operator mode `disabled`.
3. **Kontur sandbox** — cloud app + реальный `GenerateTitleXml`. Подписание и `PostMessage` всё равно запрещены.

## 1. Demo

```bash
npm install
npm run preflight
npm run dev
```

Без Supabase env данные остаются в браузере. GitHub Pages — только UI-стенд.

## 2. Production data/auth prerequisites

Перед cloud-запуском:

```env
VITE_SUPABASE_URL=https://YOUR_DATA_HOST
VITE_SUPABASE_ANON_KEY=PUBLIC_KEY

EPD_GATEWAY_AUTH_MODE=supabase
EPD_AUTH_SUPABASE_URL=https://YOUR_DATA_HOST
EPD_AUTH_AUDIENCE=authenticated

EPD_DATA_SUPABASE_URL=https://YOUR_DATA_HOST
EPD_DATA_SUPABASE_PUBLIC_KEY=PUBLIC_KEY
```

Frontend key и Data API key — публичный anon/publishable key, **не `service_role`**.

Примените миграции:

```text
supabase/migrations/202609010001_init.sql
supabase/migrations/202609010002_extend_directories_t1.sql
```

RLS `documents_own` должна оставаться активной:

```text
auth.uid() = user_id
```

Sandbox flow читает документ через Data API под пользовательским JWT, чтобы эта RLS оставалась авторитетной.

## 3. Production env-check

```bash
cp .env.example .env.production
```

После заполнения:

```bash
set -a
. ./.env.production
set +a
npm run deploy:check
```

Checker останавливает запуск при опасных настройках:

- gateway auth не `supabase`;
- HTTP вместо HTTPS;
- пустой Data API public key;
- `service_role` вместо public key;
- wildcard CORS;
- server secret/database URL в `VITE_*`;
- внешний operator rate limit выше обычного;
- sandbox без Kontur BoxId/token;
- отсутствующий/невалидный `EPD_DATABASE_URL`;
- backup passphrase короче 20 символов или совпадает с паролем БД;
- небезопасный backup retention/directory;
- restore-test URL совпадает с production DB.

Checker не выводит значения секретов.

Правила checker отдельно покрыты:

```bash
npm run deploy:env:test
```

## 4. Docker Compose

Compose по умолчанию публикует web **только на loopback**:

```text
127.0.0.1:8080 -> web container
```

Gateway `8787` вообще не публикуется наружу.

Ручной запуск:

```bash
docker compose --env-file .env.production up -d --build
```

Проверка:

```bash
docker compose ps
curl -i http://127.0.0.1:8080/healthz
curl -s http://127.0.0.1:8080/api/operator/capabilities
```

До sandbox используйте:

```env
EPD_OPERATOR_PROVIDER=none
EPD_OPERATOR_MODE=disabled
```

`externalSendEnabled` должен оставаться `false` всегда, пока production send не реализован отдельно.

## 5. Server-day helper

Когда на сервере уже установлены Docker и Docker Compose plugin, можно запустить безопасный pre-deploy pipeline одной командой:

```bash
sh deploy/server-day.sh .env.production
```

Скрипт:

1. проверяет наличие Docker/Compose;
2. запускает `deploy:check` в чистом Node 22 container;
3. запускает offline preflight/security tests;
4. проверяет `docker compose config`;
5. собирает образы;
6. поднимает containers;
7. ждёт `/healthz`;
8. читает `/api/operator/capabilities`;
9. аварийно останавливается, если gateway перестал сообщать `externalSendEnabled=false`.

Скрипт **не устанавливает Docker**, не изменяет firewall, не настраивает DNS и сам не применяет SQL-миграции.

## 6. HTTPS reverse proxy

Публичный трафик должен идти только по HTTPS:

```text
Internet
  -> :443 TLS reverse proxy
  -> 127.0.0.1:8080 project nginx
  -> frontend or /api/*
  -> private gateway:8787
```

В репозитории есть пример:

```text
deploy/Caddyfile.example
```

Для Caddy:

1. скопируйте пример в системный Caddyfile;
2. замените `epd.example.ru` на реальный домен;
3. направьте DNS A/AAAA на VPS;
4. откройте наружу только необходимые `80/443`;
5. оставьте project `8080` на loopback;
6. gateway `8787` наружу не открывайте.

`EPD_ALLOWED_ORIGINS` задаётся точным HTTPS origin:

```env
EPD_ALLOWED_ORIGINS=https://epd.example.ru
```

`*` запрещён deployment checker. После выбора домена добавьте его в Supabase Auth redirect URLs.

## 7. Auth/RLS smoke test

Двумя тестовыми аккаунтами:

1. A создаёт документ;
2. B не видит документ A;
3. Data API под JWT B не возвращает строку документа A по известному ID;
4. operator gateway без Bearer получает `401`;
5. валидный JWT работает;
6. чужой documentId для sandbox внешнего действия возвращается как недоступный и не приводит к вызову оператора.

Frontend-фильтрация не считается разграничением доступа: проверяется именно RLS.

## 8. Local UserDataXml preview

В `operatorMode=disabled` доступны:

```text
POST /api/operator/preflight
POST /api/operator/kontur/userdata-preview
```

Это локальные проверки без внешнего operator API.

## 9. Проверка схем

ФНС:

```bash
npm run fns:schema:check
```

После получения Kontur sandbox credentials:

```bash
npm run kontur:schema:check
npm run kontur:schema:save
```

Изменение версии/хэша не переключает mapping автоматически.

## 10. Намеренное включение Kontur sandbox

Только после auth/RLS/schema проверок:

```env
EPD_OPERATOR_PROVIDER=kontur
EPD_OPERATOR_MODE=sandbox
EPD_GATEWAY_AUTH_MODE=supabase
EPD_KONTUR_BOX_ID=...
EPD_KONTUR_ACCESS_TOKEN=...
EPD_EXTERNAL_RATE_LIMIT_MAX=10
```

Затем:

```bash
npm run deploy:check
docker compose --env-file .env.production up -d --build
```

В capabilities:

```text
sandboxGenerateTitle.enabled = true
sandboxGenerateTitle.ready   = true
```

На карточке документа появится `Kontur sandbox`.

Кнопка:

1. показывает отдельное подтверждение;
2. отправляет gateway только `documentId`;
3. gateway проверяет JWT;
4. перечитывает document row через RLS;
5. заново строит canonical candidate;
6. повторно проверяет владельца;
7. вызывает `GenerateTitleXml`;
8. возвращает XML;
9. **не подписывает**;
10. **не вызывает `PostMessage`**.

## 11. Запрещено даже в sandbox

- production `/api/operator/send`;
- `PostMessage`;
- автоматический статус «отправлен»;
- signing без отдельной реализации;
- `service_role` для обхода пользовательской RLS;
- operator token в `VITE_*`;
- полный XML/JSON документа в application logs.

## 12. Backup/recovery

Production checker требует server-only backup configuration:

```env
EPD_DATABASE_URL=postgresql://USER:PASSWORD@DB_HOST:5432/DB_NAME
EPD_BACKUP_DIR=.backups
EPD_BACKUP_RETENTION_DAYS=14
EPD_BACKUP_PASSPHRASE=LONG_RANDOM_SECRET_DIFFERENT_FROM_DB_PASSWORD
EPD_POSTGRES_CLIENT_IMAGE=postgres:17-alpine
```

Создать encrypted backup:

```bash
npm run backup:create
```

Проверить существующий backup:

```bash
npm run backup:verify -- /absolute/path/epd-light-YYYYMMDDTHHMMSSZ.dump.enc
```

Restore drill выполняется **только в отдельную disposable test DB**:

```env
EPD_RESTORE_TEST_DATABASE_URL=postgresql://USER:PASSWORD@DB_HOST:5432/epd_restore_test
EPD_RESTORE_TEST_CONFIRM=RESTORE_TEST_ONLY
```

```bash
npm run backup:restore:test -- /absolute/path/epd-light-YYYYMMDDTHHMMSSZ.dump.enc
```

Backup хранится в encrypted виде, получает SHA-256 и автоматически проходит `pg_restore --list`. Plaintext dump временный и удаляется после операции.

Копия на том же VPS не считается полноценным backup: encrypted triplet необходимо переносить в отдельное хранилище/на второй сервер. Backup passphrase рядом с архивом не хранится.

Полный runbook: [`BACKUP-RECOVERY.md`](BACKUP-RECOVERY.md).

Для будущего VPS есть необязательные systemd templates:

```text
deploy/systemd/epd-light-backup.service.example
deploy/systemd/epd-light-backup.timer.example
```

Перед включением они обязательно адаптируются под реального Linux-пользователя, путь проекта и backup directory.

## 13. Server-day checklist

Перед открытием домена:

- [ ] `npm run preflight`;
- [ ] `npm run deploy:env:test`;
- [ ] `npm run deploy:check`;
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
- [ ] web container доступен только через `127.0.0.1:8080`;
- [ ] HTTPS работает на production domain;
- [ ] Supabase Auth redirect URLs ограничены доменом;
- [ ] `EPD_ALLOWED_ORIGINS` содержит только нужный HTTPS origin;
- [ ] firewall не публикует `8080/8787`;
- [ ] `npm run backup:create` успешно создал encrypted backup;
- [ ] backup verify проходит;
- [ ] encrypted backup скопирован вне VPS;
- [ ] первый restore drill выполнен на отдельной test DB;
- [ ] дата следующего restore drill зафиксирована;
- [ ] `externalSendEnabled=false`;
- [ ] `PostMessage` отсутствует.

## Контур данных РФ

Production-размещение базы, backend, логов и backups нужно строить с учётом применимых требований российского законодательства и фактического состава персональных данных. Для проекта целевой production-контур планируется в РФ; demo/development инфраструктуру нельзя автоматически использовать для реальных персональных данных.
