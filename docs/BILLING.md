# Биллинг ЭПД Лайт

## Текущее состояние

Реальный платёжный провайдер **не подключён**. Деньги не списываются, checkout не создаётся, чек не формируется, пользователь не может купить или самостоятельно переключить тариф.

При этом billing foundation уже включает:

- каталог тарифов `billing_plans`;
- server-owned entitlement `subscriptions`;
- 14-дневный trial;
- месячный usage `billing_usage_monthly`;
- PostgreSQL trigger на создание нового документа;
- rollout switch `billing_settings.enforcement_enabled`;
- metadata-only ledger `billing_payment_events`;
- отдельную server-only capability-role `epd_billing_writer`;
- provider-event idempotency через unique `(provider, provider_event_id)`;
- SECURITY DEFINER функцию `apply_verified_billing_entitlement`;
- запрет прямого runtime `UPDATE subscriptions`;
- column-level SELECT для browser payment history;
- read-only историю безопасных payment metadata в `/app/billing`;
- браузерные роли без права менять подписку, usage или payment events.

## Тарифы foundation

| Код | Название | Цена / мес | Новых черновиков / мес |
| --- | --- | ---: | ---: |
| `trial` | Пробный | 0 ₽ | 50 |
| `start` | Старт | 990 ₽ | 50 |
| `business` | Бизнес | 2 490 ₽ | 500 |
| `team` | Команда | 4 990 ₽ | 2 000 |

Цены пока являются предварительной коммерческой моделью. `team` ещё не означает реальный командный доступ — эта возможность остаётся roadmap.

## Почему лимит находится в БД

Лимит нельзя реализовать только React-интерфейсом: пользователь может обратиться к Data API напрямую.

`documents_billing_usage` срабатывает на **реальный INSERT** в `public.documents`:

1. определяет entitlement пользователя;
2. увеличивает месячный usage;
3. при включённом enforcement проверяет активность trial/подписки;
4. атомарно не даёт превысить месячный `document_limit`.

Обычный UPSERT существующего документа квоту повторно не расходует. Удаление документа не возвращает квоту.

## Rollout

Сейчас:

```text
billing_settings.enforcement_enabled = false
EPD_BILLING_PROVIDER=none
```

Поэтому usage считается, но отсутствие оплаты никого не блокирует, а backend не считает реальными никакие платежи.

## Payment-event ledger

`billing_payment_events` server-side хранит:

- user id;
- provider;
- provider event id — idempotency identity;
- event type/status;
- plan code;
- сумму в копейках и валюту;
- SHA-256 исходного payload;
- безопасный error code;
- timestamps.

Таблица **не хранит** raw webhook body, номер карты, CVV, платёжные секреты или provider credentials.

### Что может прочитать browser

RLS ограничивает строки условием `auth.uid() = user_id`, а отдельная миграция дополнительно ограничивает **колонки**.

Authenticated browser может SELECT только:

```text
provider
 event_type
 event_status
 plan_code
 amount_kopecks
 currency
 safe_error_code
 created_at
 processed_at
```

Он не имеет SELECT к:

```text
id
user_id
provider_event_id
payload_sha256
```

и не имеет INSERT/UPDATE/DELETE к payment events.

Поэтому это ограничение действует даже при прямом обращении к Supabase Data API, а не только в React UI.

## Server-owned verified event flow

Целевая схема после выбора провайдера:

```text
Browser
  -> backend создаёт checkout по planCode
  -> payment provider
  -> provider webhook
  -> проверить signature/authenticity
  -> определить нашего user + plan на сервере
  -> SHA-256 raw payload
  -> claimVerifiedEvent()
  -> unique provider event id блокирует повтор
  -> applyVerifiedEntitlement()
  -> DB function verifies event/user/plan/status
  -> subscription active + event applied atomically
```

`success_url`/redirect браузера **никогда не является доказательством оплаты**.

В текущем коде provider adapter/webhook route отсутствует, поэтому `claimVerifiedEvent` нельзя вызвать из браузера. Репозиторий — server-only boundary для будущей проверенной интеграции.

## DB-enforced entitlement boundary

Runtime billing-role **не имеет** прямого `UPDATE` на `subscriptions` и после hardening-миграции не имеет прямого `UPDATE` на payment ledger.

Вместо этого ей разрешён только EXECUTE:

```text
public.apply_verified_billing_entitlement(...)
```

Функция использует `SECURITY DEFINER` с фиксированным `search_path = pg_catalog, public` и внутри одной транзакции требует:

- event существует;
- event принадлежит нужному user;
- status ровно `verified`;
- plan совпадает;
- billing period валиден.

Только затем subscription становится `active`, а event — `applied`.

Таким образом обычный runtime SQL `UPDATE subscriptions SET status='active'` под `epd_billing_writer` запрещён самой БД.

## Restricted billing credential

Для будущего webhook worker предусмотрен отдельный PostgreSQL login:

```env
EPD_BILLING_PROVIDER=none
EPD_BILLING_DATABASE_URL=
EPD_BILLING_DATABASE_ROLE=epd_billing_writer
```

`epd_billing_writer` — NOLOGIN capability-role. Production создаст отдельный LOGIN и выдаст membership.

Этот credential нельзя переиспользовать как:

- `EPD_DATABASE_URL` — admin/migrations/backups;
- `EPD_GATEWAY_DATABASE_URL` — operator journal writer.

Deployment checker это контролирует.

## Права браузера

`authenticated` может читать:

- активные `billing_plans`;
- свою `subscriptions`;
- свой `billing_usage_monthly`;
- безопасные `billing_settings`;
- только разрешённые колонки своих `billing_payment_events`.

Он не может писать в:

- `subscriptions`;
- `billing_usage_monthly`;
- `billing_payment_events`.

Следовательно пользователь не может сделать себе `plan_code='team'`, обнулить usage или создать событие «оплата прошла» обычным browser JWT.

## Статусы подписки

- `trialing` — пробный период;
- `active` — оплаченный/сервером активированный доступ;
- `past_due` — проблема с продлением;
- `canceled` — отменена;
- `expired` — истекла.

После включения enforcement только валидный `trialing` и `active` entitlement смогут создавать новые документы.

## Статусы payment event

- `received` — зарезервирован под будущую provider processing модель;
- `verified` — provider event успешно проверен сервером и готов к применению;
- `applied` — entitlement применён;
- `ignored` — событие корректно проигнорировано;
- `failed` — безопасно зафиксирована ошибка обработки.

Повтор одного `(provider, provider_event_id)` не должен повторно активировать entitlement.

## Что ещё нужно до реальных денег

1. выбрать подходящего платёжного провайдера;
2. определить ИП/ООО, налогообложение и применение 54-ФЗ;
3. реализовать backend checkout, принимающий только `planCode`, а цену берущий из server catalogue;
4. реализовать и проверить provider webhook/signature;
5. связать provider customer/payment с нашим user server-side;
6. подключить существующий payment-event ledger;
7. обработать продление, отмену, возврат и `past_due`;
8. реализовать чеки, если применимо;
9. провести end-to-end sandbox/payment smoke test;
10. только после этого изменить `EPD_BILLING_PROVIDER` и включать `enforcement_enabled=true` отдельным rollout.

## Billing-миграции

```text
202609020001_billing_foundation.sql
202609020003_billing_payment_events.sql
202609020004_billing_entitlement_function.sql
202609020005_billing_payment_event_column_privileges.sql
```

Связанная operator writer migration:

```text
202609020002_gateway_writer_role.sql
```

Все migration-файлы применяются общим guarded runner, а не вручную по одному.

## Проверки

```bash
npm run billing:test
npm run billing-payment:test
npm run billing-payment-client:test
npm run billing-env:test
npm run preflight
```

Они фиксируют тарифы/trial, browser read-only boundary, column privileges, provider-event idempotency, DB-enforced activation, запрет raw payment data, раздельные DB credentials и то, что реальный provider пока выключен.
