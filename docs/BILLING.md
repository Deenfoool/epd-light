# Биллинг ЭПД Лайт

## Текущее состояние

Платёжный провайдер **ещё не подключён**. Деньги не списываются, чек не формируется, пользователь не может купить или самостоятельно переключить тариф.

При этом foundation уже существует:

- каталог тарифов `billing_plans`;
- пользовательская подписка/entitlement `subscriptions`;
- 14-дневный trial;
- месячный usage `billing_usage_monthly`;
- PostgreSQL trigger на создание нового документа;
- отдельный rollout switch `billing_settings.enforcement_enabled`;
- страница `/app/billing` в кабинете;
- browser roles имеют только SELECT к состоянию подписки и usage.

## Тарифы foundation

| Код | Название | Цена / мес | Новых черновиков / мес |
| --- | --- | ---: | ---: |
| `trial` | Пробный | 0 ₽ | 50 |
| `start` | Старт | 990 ₽ | 50 |
| `business` | Бизнес | 2 490 ₽ | 500 |
| `team` | Команда | 4 990 ₽ | 2 000 |

Цены пока являются предварительной коммерческой моделью. До подключения оплаты они не должны интерпретироваться как уже работающая подписка.

`team` пока не включает реальный командный доступ: это отдельно помечено как roadmap в `features`.

## Почему лимит реализован в БД

Нельзя ограничивать тариф только React-интерфейсом. Пользователь может обратиться к Data API напрямую.

Поэтому `documents_billing_usage` срабатывает на **реальный INSERT** в `public.documents`:

1. определяет entitlement пользователя;
2. увеличивает месячный usage;
3. при включённом enforcement проверяет активность trial/подписки;
4. атомарно не даёт превысить месячный `document_limit`.

Trigger `AFTER INSERT`, поэтому обычное сохранение существующего документа через UPSERT не расходует квоту повторно.

Удаление документа **не возвращает** квоту. Считается количество созданных новых черновиков, а не текущий размер таблицы.

## Rollout

Сейчас:

```text
billing_settings.enforcement_enabled = false
```

Это означает:

- usage уже можно считать;
- trial/subscription уже можно отображать;
- текущих пользователей не блокирует отсутствие оплаты;
- нельзя случайно превратить незавершённый billing foundation в paywall.

Enforcement нельзя включать до готовности реального payment flow.

## Права браузера

`authenticated` получает:

- SELECT активных `billing_plans`;
- SELECT своей `subscriptions`;
- SELECT своего `billing_usage_monthly`;
- SELECT безопасного `billing_settings`.

Браузеру **не выдаются** INSERT/UPDATE/DELETE на:

- `subscriptions`;
- `billing_usage_monthly`.

То есть пользователь не может сделать себе `plan_code='team'` или обнулить usage обычным Supabase JWT.

## Что должен делать будущий платёжный backend

Целевая цепочка:

```text
Browser
  -> создать платёж / checkout session
  -> private billing backend
  -> payment provider
  -> provider webhook
  -> verify webhook signature
  -> server-owned update subscriptions
  -> entitlement becomes active
```

Критично: redirect пользователя на `success_url` **не является доказательством оплаты**. Активировать подписку можно только после подтверждённого server-to-server события/проверки платежа.

## Будущие таблицы/поля

В `subscriptions` уже зарезервированы:

- `payment_provider`;
- `provider_customer_id`;
- `provider_subscription_id`;
- `status`;
- `current_period_start`;
- `current_period_end`;
- `cancel_at_period_end`.

Это позволяет подключить провайдера без переноса основной entitlement-модели в frontend.

## Статусы

Допустимые значения:

- `trialing` — пробный период;
- `active` — оплаченный/активированный доступ;
- `past_due` — проблема с продлением/оплатой;
- `canceled` — отменена;
- `expired` — доступ истёк.

Только `trialing` в пределах `trial_ends_at` и `active` в пределах `current_period_end` смогут создавать новые документы после включения enforcement.

## Ошибки quota enforcement

База использует machine-safe коды:

- `billing_document_limit_reached`;
- `billing_trial_expired`;
- `billing_period_expired`;
- `billing_subscription_inactive`;
- `billing_subscription_missing`;
- `billing_user_mismatch`.

Frontend преобразует их в понятные сообщения через `src/billing.ts`.

## Что ещё нужно до реальных денег

1. выбрать российский/подходящий платёжный провайдер;
2. определить схему ИП/ООО, налогообложение и применение 54-ФЗ;
3. реализовать checkout только через backend;
4. верифицировать webhook/signature;
5. сделать idempotency платежных событий;
6. server-owned обновление `subscriptions`;
7. возвраты/отмена/продление;
8. чеки, если применимо;
9. история платежей/счета;
10. уведомления о продлении/ошибке оплаты;
11. только после полного smoke-test включить `enforcement_enabled=true`.

## Миграция

Foundation создаётся:

```text
supabase/migrations/202609020001_billing_foundation.sql
```

Она должна применяться через общий guarded migration runner после предыдущих миграций.

## Проверка

```bash
npm run billing:test
```

Проверка фиксирует тарифы, trial, read-only browser boundary и то, что enforcement по умолчанию не включён.
