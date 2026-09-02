# Backup и восстановление ЭПД Лайт

Этот runbook относится к production PostgreSQL с реальными данными. GitHub Pages/demo в backup базы не нуждается.

## Цель

Минимальная схема до первых реальных клиентов:

```text
production PostgreSQL
  -> pg_dump custom archive
  -> проверка pg_restore --list
  -> AES-256-CBC + PBKDF2 (200000 итераций)
  -> SHA-256
  -> локальная защищённая копия
  -> отдельная копия вне основного VPS
  -> production freshness gate
  -> периодический restore drill в отдельную тестовую БД
```

Локальный backup на том же VPS **не считается достаточным**: потеря диска/VPS уничтожит и production, и локальную копию.

## Production env

Нужны server-only значения:

```env
EPD_DATABASE_URL=postgresql://USER:PASSWORD@DB_HOST:5432/DB_NAME
EPD_BACKUP_DIR=.backups
EPD_BACKUP_RETENTION_DAYS=14
EPD_BACKUP_MAX_AGE_HOURS=30
EPD_BACKUP_PASSPHRASE=LONG_RANDOM_SECRET_DIFFERENT_FROM_DB_PASSWORD
EPD_POSTGRES_CLIENT_IMAGE=postgres:17-alpine
```

Правила:

- `EPD_DATABASE_URL` никогда не помещается в `VITE_*`;
- backup passphrase минимум 20 символов;
- backup passphrase должна отличаться от пароля БД;
- passphrase хранится отдельно от самих backup-файлов;
- `.backups`, `*.dump*` исключены из Git и Docker build context;
- production env не коммитится;
- `EPD_BACKUP_MAX_AGE_HOURS` — допустимый возраст последнего backup перед production deploy; проект по умолчанию использует 30 часов.

## Создать backup

При загруженных env:

```bash
npm run backup:create
```

или напрямую:

```bash
sh deploy/backup-postgres.sh
```

Результат:

```text
.backups/
  epd-light-YYYYMMDDTHHMMSSZ.dump.enc
  epd-light-YYYYMMDDTHHMMSSZ.dump.enc.sha256
  epd-light-YYYYMMDDTHHMMSSZ.dump.enc.meta
```

Plaintext `.dump` остаётся только временно и удаляется после шифрования даже при штатном завершении/сигнале.

Перед объявлением успеха скрипт:

1. делает `pg_dump --format=custom`;
2. проверяет исходный archive через `pg_restore --list`;
3. шифрует AES-256-CBC с PBKDF2;
4. создаёт SHA-256 зашифрованного файла;
5. расшифровывает во временный файл;
6. повторно проверяет `pg_restore --list`;
7. удаляет временный plaintext;
8. применяет retention только к EPD Light backup triplets.

## Проверить существующий backup

```bash
npm run backup:verify -- /absolute/path/epd-light-20260916T030000Z.dump.enc
```

Требуется тот же `EPD_BACKUP_PASSPHRASE`.

Проверка состоит из:

- SHA-256 encrypted artifact;
- успешной расшифровки;
- читаемого PostgreSQL custom archive.

Проверка не изменяет БД.

## Production backup readiness

Перед каждым `server-day` проект требует не просто наличие настроек, а **реально существующий свежий и читаемый backup**:

```bash
npm run backup:readiness -- .env.production
```

`deploy/check-backup-readiness.sh`:

1. безопасно читает только backup-настройки из `.env.production`, без `source` и `eval`;
2. находит самый свежий `epd-light-*.dump.enc`;
3. требует `.sha256` sidecar;
4. проверяет возраст относительно `EPD_BACKUP_MAX_AGE_HOURS`;
5. вызывает обычный verifier;
6. требует успешные SHA-256, decrypt и `pg_restore --list`.

Fail-closed причины включают:

```text
backup directory missing
no encrypted backup
checksum sidecar missing
backup timestamp in future
backup stale
wrong passphrase/decrypt failure
invalid pg_restore archive
```

`EPD_BACKUP_MAX_AGE_HOURS` разрешён в диапазоне 1–168 часов. Для ежедневного backup baseline — 30 часов, чтобы небольшой сдвиг timer не ломал deployment при нормальной работе.

`deploy/server-day.sh` выполняет этот gate **до network smoke-check и Docker build/start**.

## Restore drill

**Никогда не запускайте restore drill на production URL.**

Подготовьте отдельную disposable БД, имя которой содержит `test`, `restore` или `staging`, например:

```env
EPD_RESTORE_TEST_DATABASE_URL=postgresql://USER:PASSWORD@DB_HOST:5432/epd_restore_test
EPD_RESTORE_TEST_CONFIRM=RESTORE_TEST_ONLY
```

Запуск:

```bash
npm run backup:restore:test -- /absolute/path/epd-light-20260916T030000Z.dump.enc
```

Скрипт fail-closed:

- требует `RESTORE_TEST_ONLY`;
- отказывается, если test URL совпадает с `EPD_DATABASE_URL`;
- требует безопасное имя test DB;
- сначала проверяет encrypted backup;
- затем выполняет `pg_restore --clean --if-exists --exit-on-error` только в test DB;
- после restore проверяет наличие `public.documents` и `public.profiles`.

Сам restore drill **разрушителен для указанной test DB**. Она должна быть выделена только под эту процедуру.

## Внешняя копия

После каждого успешного backup triplet нужно копировать за пределы основного VPS:

```text
*.dump.enc
*.dump.enc.sha256
*.dump.enc.meta
```

Не копируйте рядом backup passphrase.

Допустимы отдельный объектный storage/второй сервер/защищённое backup-хранилище в выбранном production-контуре. Конкретный offsite provider намеренно не зашит в проект до выбора инфраструктуры.

Важно: текущий `backup:readiness` подтверждает локальный encrypted archive, но **не доказывает существование offsite copy**. Перед первыми реальными клиентами offsite backup должен быть настроен и отдельно контролироваться.

## Retention

По умолчанию:

```env
EPD_BACKUP_RETENTION_DAYS=14
```

Deployment checker разрешает 7–365 дней. Retention применяется только к локальному каталогу и только к файлам с префиксом `epd-light-`.

Offsite retention настраивается отдельно на стороне выбранного backup storage.

## Периодичность

Стартовая рекомендация для MVP:

- encrypted backup: ежедневно;
- offsite copy: после каждого backup;
- автоматическая verify: при каждом создании;
- production freshness gate: при каждом deploy;
- restore drill: минимум раз в месяц и после серьёзных изменений схемы/инфраструктуры;
- дополнительный backup: перед миграциями БД и крупным deploy.

## Перед миграцией

Порядок:

```text
1. создать encrypted backup
2. verify проходит
3. убедиться, что offsite copy существует
4. применить migration guarded runner'ом
5. проверить exact migration registry + SHA-256
6. создать/проверить post-migration backup
7. smoke test приложения/RLS
```

Команда проверки schema registry:

```bash
npm run db:migrations:check -- .env.production
```

## RPO/RTO для первой production-версии

До появления фактической статистики можно принять внутреннюю стартовую цель:

```text
RPO: <= 24 часа при ежедневном backup
RTO: <= 4 часа при доступной инфраструктуре и проверенном restore runbook
```

Это внутренняя эксплуатационная цель, а не публичная SLA-гарантия клиентам.

## Что не логировать

Backup tooling не должно писать в stdout/logs:

- `EPD_DATABASE_URL`;
- пароль PostgreSQL;
- `EPD_BACKUP_PASSPHRASE`;
- содержимое таблиц;
- расшифрованный dump.

Metadata-файл содержит только безопасные технические metadata, а не passphrase или содержимое БД.

## Чек-лист первого production backup

- [ ] `npm run deploy:check` проходит;
- [ ] каталог backup имеет права `700`;
- [ ] backup-файлы имеют права `600`;
- [ ] `npm run backup:create` завершился успешно;
- [ ] `npm run backup:verify -- <file>` проходит;
- [ ] `npm run backup:readiness -- .env.production` проходит;
- [ ] encrypted triplet скопирован вне VPS;
- [ ] backup passphrase не лежит рядом с backup;
- [ ] создана отдельная restore-test БД;
- [ ] выполнен первый `backup:restore:test`;
- [ ] зафиксирована дата следующего restore drill.
