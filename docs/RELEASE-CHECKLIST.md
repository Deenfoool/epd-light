# Release checklist

Этот документ разделяет безопасный выпуск текущего MVP и будущий коммерческий запуск юридически значимого ЭПД.

## Перед каждым изменением

1. Создать отдельную ветку.
2. Установить зафиксированные зависимости командой `npm ci`.
3. Не добавлять в Git файлы `.env*`, дампы БД, ключи, токены, материалы КЭП и реальные персональные данные.
4. Не включать `EPD_OPERATOR_MODE=sandbox` без отдельного Supabase JWT/RLS-контура и серверных реквизитов.
5. Не реализовывать обход `/api/operator/send`: production-отправка остаётся закрытой до готовности полного операторского процесса.

## Проверка pull request

Единая локальная команда:

```bash
npm ci
npm run check
```

Она обязана успешно завершить:

- синтаксическую проверку всех server/scripts модулей и deploy shell-скриптов;
- deployment, migrations, backup, privacy, billing и runtime preflight;
- 23 тестовые группы;
- проверку форматирования `src/App.tsx`;
- TypeScript и production Vite build.

Дополнительно перед слиянием:

```bash
npm audit --omit=dev --audit-level=high
docker build --tag epd-light-web:release .
docker build --tag epd-light-gateway:release ./server
```

Сливать изменения можно только после зелёного GitHub Actions CI.

## Безопасный выпуск MVP

Текущий продукт можно выпускать только как:

- local/browser demo;
- сервис подготовки и хранения внутренних черновиков;
- sandbox-инструмент `GenerateTitleXml` на вымышленных данных после настройки оператора;
- систему без оплаты и без юридически значимой отправки.

Обязательные значения до подключения внешних контуров:

```env
EPD_OPERATOR_PROVIDER=none
EPD_OPERATOR_MODE=disabled
EPD_BILLING_PROVIDER=none
```

## Production deployment

Выполнять только по инструкции [DEPLOYMENT.md](DEPLOYMENT.md):

1. Подготовить российский production-контур и секреты вне Git.
2. Проверить актуальный encrypted backup и отдельную restore-test БД.
3. Применить миграции guarded runner-ом.
4. Запустить `npm run deploy:server-day -- .env.production`.
5. Проверить `/healthz`, `/api/system/version` и `/api/system/readiness`.
6. Убедиться, что runtime release и commit совпадают с выпущенным Git commit.

## Запрещённые утверждения

До завершения коммерческого контура нельзя заявлять, что:

- XML подтверждён актуальной XSD ФНС;
- документ подписывается КЭП;
- документ отправляется оператору или в ГИС ЭПД;
- сервис является оператором ИС ЭПД;
- тариф можно оплатить;
- заявка на удаление автоматически стирает все данные.

## Условия коммерческого запуска

Каждый пункт требует отдельного подтверждения:

- актуальная XSD/UserDataXsd и mapping на реальных sandbox-ответах;
- договор и production-доступ аккредитованного оператора;
- архитектура подписи и безопасная работа с КЭП;
- `PostMessage`, получение статусов, повторные попытки и сверка;
- payment provider, verified webhook, чеки и smoke-test;
- российский контур хранения персональных данных;
- retention matrix и server-controlled deletion processor;
- юридические документы, реквизиты владельца и ответы регуляторов;
- offsite backup, регулярный restore drill, мониторинг и оповещения.

Ни один из этих пунктов не должен включаться только изменением UI-флага.
