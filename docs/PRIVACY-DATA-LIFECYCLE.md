# Данные аккаунта: экспорт, заявка на удаление и lifecycle

Этот документ описывает текущую **техническую** модель работы с данными аккаунта в ЭПД Лайт. Он не заменяет Политику обработки персональных данных, ответы Роскомнадзора/ФНС/Минтранса или юридическое определение обязательных сроков хранения.

## 1. Что уже реализовано

В кабинете есть страница:

```text
/app/privacy
```

Пользователь может:

1. сформировать self-service JSON-экспорт данных, доступных его аккаунту;
2. посмотреть историю своих заявок на удаление;
3. создать одну активную заявку на удаление аккаунта.

Ни одна из этих операций не даёт browser доступ к административным credentials или правам на удаление auth-user.

## 2. Self-service export

Клиентский модуль:

```text
src/privacy.ts
```

Формат:

```text
epd-light/account-data-export-v1
```

В cloud-режиме экспорт собирается только через обычные права текущего пользователя и RLS.

В него могут входить:

- email/id аккаунта и безопасные account metadata;
- профиль организации;
- контрагенты;
- автомобили;
- водители;
- черновики ЭТрН;
- заявки на подключение оператора;
- состояние тарифа/usage;
- безопасная история payment events;
- безопасная история operator attempts;
- заявки на удаление аккаунта.

Экспорт намеренно **не содержит**:

- access token;
- refresh token;
- Supabase `service_role`;
- operator access token;
- DB connection strings/passwords;
- backup passphrase;
- private keys/КЭП;
- raw payment webhook;
- скрытый `payload_sha256` payment event;
- иных server secrets.

JSON формируется в браузере и скачивается пользователем локально. После скачивания файл следует считать конфиденциальным: в нём могут быть ФИО, телефоны, реквизиты водительских удостоверений и содержимое черновиков.

### Важное ограничение

Self-service export — удобная функция продукта, а не утверждение, что это полный формальный ответ на любой юридический запрос субъекта персональных данных. Если применимое право требует отдельного состава/формы/процедуры ответа, это должно быть реализовано server-side после юридической фиксации процесса.

## 3. Заявка на удаление

Migration:

```text
202609020006_account_deletion_requests.sql
```

Создаёт:

```text
public.account_deletion_requests
```

Статусы:

```text
pending
in_review
completed
rejected
canceled
```

Browser JWT получает только:

```text
SELECT own rows
INSERT own pending request
```

Browser **не получает**:

```text
UPDATE
DELETE
право менять status
право задавать resolved_at
право удалять auth.users
```

RLS требует:

```text
auth.uid() = user_id
```

Partial unique index разрешает только одну активную заявку (`pending`/`in_review`) на пользователя.

## 4. Почему заявка не удаляет данные мгновенно

В текущей версии кнопка создаёт **заявку**, а не запускает каскадное удаление.

Причины:

- сроки хранения ещё должны быть определены по фактическому составу документов и применимым требованиям;
- некоторые технические/платёжные/операторские записи могут иметь отдельные основания и сроки хранения;
- перед удалением может требоваться блокировка/ограничение обработки вместо мгновенного физического удаления;
- должна быть определена процедура по backups;
- должен быть определён порядок обработки споров/расчётов/операторских событий;
- нельзя позволять browser самостоятельно маркировать заявку `completed`.

Поэтому UI прямо пишет, что это **не мгновенное удаление**.

## 5. Будущий server-controlled deletion processor

Его нельзя включать до утверждения retention matrix.

Целевая последовательность должна быть примерно такой:

```text
pending request
 -> server verifies account/request
 -> determine applicable retention rules
 -> optional account access restriction
 -> classify data by retention rule
 -> delete/anonymize records eligible now
 -> retain only records that must remain
 -> process backup lifecycle according to policy
 -> write safe processing result
 -> mark request completed/rejected
```

Browser не является авторитетом ни на одном из этих шагов.

## 6. Retention matrix — обязательный следующий юридико-технический документ

До destructive processor нужна таблица минимум по категориям:

```text
account/auth metadata
profile/company details
drivers and driver licence fields
vehicles
counterparties
ETRN drafts
operator_attempts
integration_requests
subscriptions/usage
billing_payment_events
account_deletion_requests
application/audit logs
encrypted backups
```

Для каждой категории нужно определить:

- цель обработки;
- правовое основание;
- источник;
- получателей/процессоров;
- production location;
- срок хранения;
- событие начала отсчёта;
- delete vs anonymize vs retain;
- поведение при заявке на удаление;
- поведение в backup;
- кто имеет административный доступ.

## 7. Backups

Удаление записи из live PostgreSQL не означает мгновенное исчезновение из уже созданного encrypted backup.

Поэтому политика должна отдельно определить:

- retention backup-файлов;
- период, в течение которого удалённые live-данные могут оставаться внутри backup;
- запрет восстановления старого backup поверх production без повторного применения lifecycle-операций;
- процедуру emergency restore с учётом уже исполненных deletion requests.

Текущий backup baseline:

```text
AES-256-CBC + PBKDF2
SHA-256
pg_restore verification
local retention
future offsite copy
restore drill
```

## 8. Operator/payment journals

`operator_attempts` и `billing_payment_events` являются server-owned metadata journals.

Пользователь их читает только в безопасно ограниченном виде. Он не может:

- подделать successful operator attempt;
- подделать payment;
- удалить journal row;
- изменить статус события.

Нельзя автоматически решить, что эти журналы всегда удаляются вместе с аккаунтом, пока не утверждён retention matrix.

## 9. Логи

Application audit сохраняет privacy-safe technical metadata и не должен содержать:

- body ЭТрН;
- XML;
- ФИО/телефоны из документа;
- JWT/access token;
- operator token;
- payment payload;
- DB URL/password.

Отдельный retention срок для логов должен быть зафиксирован до production launch.

## 10. Что проверить перед production

- [ ] migration `202609020006_account_deletion_requests.sql` применена;
- [ ] RLS проверена двумя аккаунтами;
- [ ] A не видит заявку B;
- [ ] A не может создать заявку от имени B;
- [ ] browser не может UPDATE/DELETE deletion request;
- [ ] повторный active request не создаёт дубль;
- [ ] JSON export не содержит access/refresh token;
- [ ] JSON export не содержит server secrets;
- [ ] UI явно предупреждает о конфиденциальности export-файла;
- [ ] UI не обещает мгновенное удаление;
- [ ] retention matrix утверждена до включения destructive processor;
- [ ] backup lifecycle включён в retention process.

## 11. Чего пока нет

Намеренно не реализованы:

- автоматический `auth.users DELETE`;
- каскадный destructive worker;
- автоматическое удаление из backups;
- browser cancel/update request;
- обещанный срок исполнения заявки;
- юридический статус self-service export как полного формального ответа.

Эти функции должны появляться только после того, как будут определены применимые сроки хранения и административная процедура.
