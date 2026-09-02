import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronRight,
  ClipboardCheck,
  Copy,
  CreditCard,
  Database,
  Download,
  FileJson,
  FileText,
  Home,
  Import,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Package,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Truck,
  UserRound,
  Users,
  X,
  Trash2,
} from 'lucide-react'
import type {
  BillingState,
  Company,
  DocumentRow,
  Driver,
  EtrnData,
  OperatorAttempt,
  Party,
  Profile,
  RussianAddressDraft,
  Vehicle,
} from './types'
import {
  cargoTotals,
  emptyCargo,
  emptyRussianAddress,
  exportJson,
  isReady,
  newDoc,
  normalizeEtrn,
  operatorReadiness,
  statusLabel,
  validateEtrn,
  validGuid,
  validInn,
} from './etrn'
import { buildOperatorDraft } from './operator-draft'
import { gatewayFetch } from './gateway'
import {
  billingErrorMessage,
  billingRemainingDocuments,
  billingStatusLabel,
  getBillingState,
} from './billing'
import {
  billingPaymentEventStatusLabel,
  listBillingPaymentEvents,
} from './billing-events'
import {
  listOperatorAttempts,
  operatorAttemptStatusLabel,
} from './operator-attempts'
import {
  buildAccountDataExport,
  deletionRequestStatusLabel,
  downloadAccountDataExport,
  listAccountDeletionRequests,
  requestAccountDeletion,
} from './privacy'
import {
  cloudEnabled,
  deleteCompany,
  deleteDocument,
  deleteDriver,
  deleteVehicle,
  getProfile,
  getSessionEmail,
  listCompanies,
  listDocuments,
  listDrivers,
  listVehicles,
  saveCompany,
  saveDocument,
  saveDriver,
  saveIntegrationRequest,
  saveProfile,
  saveVehicle,
  seedDemo,
  signIn,
  signOut,
  signUp,
  subscribeAuth,
} from './data'

const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
const route = () => window.location.pathname + window.location.search
const go = (to: string) => {
  history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
const fmt = (v: string) => (v ? new Date(v).toLocaleDateString('ru-RU') : '—')
const cls = (...x: (string | false | undefined)[]) =>
  x.filter(Boolean).join(' ')

function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled = false,
  className = '',
}: {
  children: any
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'primary' | 'outline' | 'ghost' | 'danger'
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cls('btn', `btn-${variant}`, className)}
    >
      {children}
    </button>
  )
}
function Input(props: any) {
  return <input {...props} className={cls('input', props.className)} />
}
function Select(props: any) {
  return (
    <select {...props} className={cls('input', props.className)}>
      {props.children}
    </select>
  )
}
function Textarea(props: any) {
  return (
    <textarea
      {...props}
      className={cls('input', 'textarea', props.className)}
    />
  )
}
function Badge({
  children,
  tone = 'neutral',
}: {
  children: any
  tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'info'
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: any
  hint?: string
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}
function Card({
  children,
  className = '',
}: {
  children: any
  className?: string
}) {
  return <div className={cls('card', className)}>{children}</div>
}
function Toast({ text }: { text: string }) {
  return text ? <div className="toast">{text}</div> : null
}

function Logo() {
  return (
    <button className="logo" onClick={() => go('/')}>
      <span className="logo-mark">
        <FileText size={17} />
      </span>
      <span>ЭПД Лайт</span>
    </button>
  )
}

function PublicHeader() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <header className="public-header">
        <div className="container nav-row">
          <Logo />
          <nav className={cls('public-nav', open && 'open')}>
            <button onClick={() => go('/')}>Главная</button>
            <button onClick={() => go('/pricing')}>Тарифы</button>
            <button onClick={() => go('/legal')}>Документы</button>
          </nav>
          <div className="nav-actions">
            <Button variant="ghost" onClick={() => go('/auth')}>
              Войти
            </Button>
            <Button onClick={() => go('/auth?mode=signup')}>
              Начать бесплатно
            </Button>
          </div>
          <button className="mobile-menu" onClick={() => setOpen(!open)}>
            <Menu size={20} />
          </button>
        </div>
      </header>
    </>
  )
}
function PublicFooter() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <Logo />
          <p>
            Сервис подготовки, проверки и хранения черновиков электронных
            перевозочных документов.
          </p>
        </div>
        <div className="official-links">
          <b>Официальные источники</b>
          <p>
            <a
              href="https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/edotransp/"
              target="_blank"
              rel="noreferrer"
            >
              ФНС: обязательный транспортный ЭДО
            </a>
          </p>
          <p>
            <a
              href="https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/approved_formats/16631750/"
              target="_blank"
              rel="noreferrer"
            >
              ФНС: форматы черновиков, ЭТрН КНД 1110339
            </a>
          </p>
          <p>
            <a
              href="https://www.mintrans.gov.ru/activities/376"
              target="_blank"
              rel="noreferrer"
            >
              Минтранс: ГИС ЭПД
            </a>
          </p>
        </div>
        <div>
          <b>Важно</b>
          <p>
            «ЭПД Лайт» не является оператором ИС ЭПД, не подписывает КЭП и не
            отправляет документы в ГИС ЭПД.
          </p>
        </div>
      </div>
    </footer>
  )
}
function PublicShell({ children }: { children: any }) {
  return (
    <>
      <PublicHeader />
      <main>{children}</main>
      <PublicFooter />
    </>
  )
}

function HomePage() {
  return (
    <PublicShell>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <Badge tone="info">Черновики ЭТрН · КНД 1110339</Badge>
            <h1>Электронные перевозочные документы без тяжёлой 1С</h1>
            <p className="lead">
              Подготовьте и проверьте черновик ЭТрН, сохраните справочники и
              будьте готовы передать документ оператору ИС ЭПД.
            </p>
            <div className="hero-actions">
              <Button onClick={() => go('/auth?mode=signup')}>
                Создать первый черновик <ArrowRight size={16} />
              </Button>
              <Button variant="outline" onClick={() => go('/auth?mode=demo')}>
                Посмотреть демо
              </Button>
            </div>
            <p className="muted small">
              Для аккаунта создаётся 14-дневный пробный entitlement. Реальная
              оплата и автоматические списания пока не подключены.
            </p>
          </div>
          <Card className="demo-card">
            <div className="card-head">
              <b>Черновик ЭТрН-2026-118</b>
              <Badge tone="success">Готов к передаче оператору</Badge>
            </div>
            {[
              ['Грузоотправитель', 'ООО «Вымышленный Склад»'],
              ['Грузополучатель', 'ООО «Пример Ритейл»'],
              ['Перевозчик', 'ИП Тестовый И. И.'],
              ['Маршрут', 'Москва → Тверь'],
              ['Груз', '12 мест · 840 кг'],
              ['Транспорт', 'Тестовая Марка · А001АА777'],
            ].map((x) => (
              <div className="kv" key={x[0]}>
                <span>{x[0]}</span>
                <b>{x[1]}</b>
              </div>
            ))}
            <p className="muted tiny">
              Все данные вымышлены. Это не перевозочный документ.
            </p>
          </Card>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <Card className="law-card">
            <ShieldAlert />
            <div>
              <h2>С 1 сентября 2026 года</h2>
              <p>
                Для участников перевозочного процесса, на которых
                распространяется Федеральный закон от 07.06.2025 №140-ФЗ,
                отдельные перевозочные и экспедиторские документы оформляются в
                электронном виде. Для автомобильных грузоперевозок это, в
                частности, транспортная накладная и заказ (заявка). Обмен идёт
                через операторов ИС ЭПД с передачей сведений в ГИС ЭПД.
              </p>
              <p className="muted">
                ФНС публикует официальные форматы и отдельные форматы
                черновиков; для ЭТрН указан КНД 1110339. ЭПД Лайт пока создаёт
                только внутренний черновик и не заявляет XSD-совместимость до
                отдельной интеграционной валидации.
              </p>
              <div className="law-links">
                <a
                  href="https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/edotransp/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Разъяснения ФНС
                </a>
                <a
                  href="https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/approved_formats/16631750/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Форматы черновиков ФНС
                </a>
                <a
                  href="https://www.mintrans.gov.ru/activities/376"
                  target="_blank"
                  rel="noreferrer"
                >
                  ГИС ЭПД — Минтранс
                </a>
              </div>
            </div>
          </Card>
        </div>
      </section>
      <section className="section alt">
        <div className="container">
          <h2>Как это работает</h2>
          <div className="three-grid">
            {[
              [FileText, 'Заполнить', 'Мастер из 6 шагов и справочники.'],
              [
                ClipboardCheck,
                'Проверить',
                'Покажем обязательные и рекомендуемые поля.',
              ],
              [
                Send,
                'Передать оператору',
                'Подготовьте JSON и передайте через подключённого оператора.',
              ],
            ].map(([I, t, d]: any) => (
              <Card key={t}>
                <I className="feature-icon" />
                <h3>{t}</h3>
                <p>{d}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <h2>Что входит в MVP</h2>
          <div className="three-grid">
            {[
              [Database, 'Справочники'],
              [Copy, 'Дублирование'],
              [Import, 'CSV-импорт'],
              [FileJson, 'JSON-экспорт'],
              [Printer, 'Печатное превью'],
              [ShieldAlert, 'Контроль статусов'],
            ].map(([I, t]: any) => (
              <Card key={t}>
                <I className="feature-icon" />
                <h3>{t}</h3>
              </Card>
            ))}
          </div>
        </div>
      </section>
      <section className="section alt">
        <div className="container">
          <h2>Частые вопросы</h2>
          <div className="two-cards">
            <Card>
              <h3>ЭПД Лайт — оператор ИС ЭПД?</h3>
              <p>
                Нет. Сервис готовит и проверяет черновики. Юридически значимый
                обмен и передача сведений в ГИС ЭПД выполняются через
                аккредитованного оператора.
              </p>
            </Card>
            <Card>
              <h3>Нужна ли 1С?</h3>
              <p>
                Для подготовки черновика — нет. Цель MVP как раз в том, чтобы
                небольшая компания могла начать с браузера. Интеграцию с 1С
                можно подключить позже.
              </p>
            </Card>
            <Card>
              <h3>JSON уже соответствует официальной XSD?</h3>
              <p>
                Нет. Экспорт MVP — внутренний нормализованный формат. Перед
                боевой отправкой требуется сопоставление с актуальной схемой ФНС
                и API выбранного оператора.
              </p>
            </Card>
            <Card>
              <h3>Где хранятся данные?</h3>
              <p>
                В демо-режиме — только в браузере. Облачный режим работает через
                PostgreSQL/Supabase с RLS; production-контур для персональных
                данных граждан РФ должен быть отдельно подготовлен с учётом
                требований российского законодательства.
              </p>
            </Card>
          </div>
          <div className="center top-gap">
            <h2>Попробуйте создать черновик ЭТрН</h2>
            <p className="muted">
              Без оплаты и без имитации отправки в ГИС ЭПД.
            </p>
            <Button onClick={() => go('/auth?mode=demo')}>Открыть демо</Button>
          </div>
        </div>
      </section>
    </PublicShell>
  )
}
function Pricing() {
  const [modal, setModal] = useState(false)
  return (
    <PublicShell>
      <section className="section">
        <div className="container">
          <h1>Предварительные тарифы</h1>
          <p className="lead">
            Каркас тарифов, пробного периода и месячного usage уже подготовлен.
            Реальные списания, эквайринг и автоматическая смена тарифа пока не
            подключены, а серверное enforcement лимитов намеренно выключено до
            готовности платёжного контура.
          </p>
          <div className="three-grid pricing">
            {[
              [
                'Старт',
                '990 ₽',
                'до 50 новых черновиков / мес',
                [
                  '1 пользователь',
                  'Справочники',
                  'JSON и печать',
                  'CSV-импорт',
                ],
              ],
              [
                'Бизнес',
                '2 490 ₽',
                'до 500 новых черновиков / мес',
                [
                  'Всё из «Старт»',
                  'Дублирование черновиков',
                  'Увеличенный месячный лимит',
                  'Приоритет подключения оператора',
                ],
              ],
              [
                'Команда',
                '4 990 ₽',
                'до 2000 новых черновиков / мес',
                [
                  'Функции «Бизнес»',
                  'Командный доступ — в roadmap',
                  '1С/API — в roadmap',
                  'Интеграция с оператором — после API-доступа',
                ],
              ],
            ].map((p, i) => (
              <Card className={i === 1 ? 'featured' : ''} key={p[0] as string}>
                <h3>{p[0]}</h3>
                <div className="price">
                  {p[1]} <span>/ мес</span>
                </div>
                <p>{p[2]}</p>
                <ul>
                  {(p[3] as string[]).map((x) => (
                    <li key={x}>
                      <Check size={16} />
                      {x}
                    </li>
                  ))}
                </ul>
                <Button
                  variant={i === 1 ? 'primary' : 'outline'}
                  className="full"
                  onClick={() => setModal(true)}
                >
                  Попробовать MVP
                </Button>
              </Card>
            ))}
          </div>
          <div className="warning top-gap">
            <ShieldAlert size={18} />
            <span>
              Это пока не оферта на активную подписку: пользователь не может
              оплатить тариф, а payment provider/webhooks/чеки ещё не
              подключены. В облачном кабинете уже можно увидеть свой trial, план
              и фактический usage.
            </span>
          </div>
        </div>
      </section>
      {modal && (
        <div className="modal">
          <Card>
            <button className="modal-x" onClick={() => setModal(false)}>
              <X />
            </button>
            <h3>MVP пока работает без списаний</h3>
            <p>
              Транзакция не создаётся и деньги не списываются. При регистрации в
              БД создаётся пробный entitlement, но его enforcement пока выключен
              до подключения реальной оплаты.
            </p>
            <div className="actions">
              <Button
                variant="outline"
                onClick={() => {
                  setModal(false)
                  go('/auth?mode=demo')
                }}
              >
                Открыть демо
              </Button>
              <Button
                onClick={() => {
                  setModal(false)
                  go('/auth?mode=signup')
                }}
              >
                Создать аккаунт
              </Button>
            </div>
          </Card>
        </div>
      )}
    </PublicShell>
  )
}

function Legal() {
  return (
    <PublicShell>
      <section className="section">
        <div className="container narrow">
          <h1>Правовые документы</h1>
          <div className="warning">
            <ShieldAlert size={18} />
            <b>
              Шаблоны требуют заполнения владельцем сервиса и юридической
              проверки до коммерческого запуска.
            </b>
          </div>
          <h2>Политика конфиденциальности</h2>
          <p>
            Сервис обрабатывает данные учётной записи, реквизиты организации,
            контрагентов, транспорта, водителей и содержимое черновиков для
            предоставления функциональности. В облачном режиме доступ ограничен
            политиками RLS: пользователь видит только свои записи.
          </p>
          <h2>Управление своими данными</h2>
          <p>
            В кабинете предусмотрен self-service JSON-экспорт данных, доступных
            текущему аккаунту, и отдельная заявка на удаление аккаунта. Экспорт
            может содержать персональные и коммерческие данные, поэтому его
            необходимо хранить как конфиденциальный файл.
          </p>
          <p>
            Заявка на удаление не стирает данные мгновенно. Фактическое удаление
            должно выполняться отдельным server-controlled процессом с учётом
            применимых сроков хранения, резервных копий и иных обязательств. До
            утверждения такой процедуры браузер не получает право удалять
            учётную запись или server-owned журналы.
          </p>
          <h2>Пользовательское соглашение</h2>
          <p>
            «ЭПД Лайт» предоставляет инструменты подготовки и проверки
            черновиков. Сервис не является оператором ИС ЭПД, не подписывает
            документы КЭП и не передаёт сведения в ГИС ЭПД без отдельной
            интеграции.
          </p>
          <h2>Реквизиты</h2>
          <p>
            [Заполнить наименование владельца, ИНН/ОГРН, юридический адрес,
            контакты поддержки.]
          </p>
        </div>
      </section>
    </PublicShell>
  )
}

function Auth({ onAuthed }: { onAuthed: () => void }) {
  const sp = new URLSearchParams(location.search)
  const initial = sp.get('mode') === 'signup' ? 'signup' : 'signin'
  const [mode, setMode] = useState<'signin' | 'signup'>(initial)
  const [email, setEmail] = useState(
    sp.get('mode') === 'demo' ? 'demo@example.test' : '',
  )
  const [password, setPassword] = useState(
    sp.get('mode') === 'demo' ? 'demo123' : '',
  )
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: any) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    setNotice('')
    try {
      if (mode === 'signup') {
        const authed = await signUp(email, password)
        if (!authed) {
          setNotice(
            'Аккаунт создан. Подтвердите email по ссылке в письме, затем войдите.',
          )
          setMode('signin')
          return
        }
      } else await signIn(email, password)
      if (!cloudEnabled) seedDemo()
      onAuthed()
      go('/app')
    } catch (x: any) {
      setErr(x.message || 'Не удалось выполнить вход')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-logo">
        <Logo />
      </div>
      <Card className="auth-card">
        <h2>{mode === 'signup' ? 'Регистрация' : 'Вход в кабинет'}</h2>
        <p className="muted">
          {cloudEnabled
            ? 'Подключён облачный режим Supabase.'
            : 'Демо-режим: данные хранятся только в этом браузере.'}
        </p>
        <form onSubmit={submit}>
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e: any) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Пароль">
            <Input
              type="password"
              minLength={6}
              value={password}
              onChange={(e: any) => setPassword(e.target.value)}
              required
            />
          </Field>
          {notice && <div className="success-box">{notice}</div>}
          {err && <div className="error-box">{err}</div>}
          <Button type="submit" disabled={busy} className="full">
            {busy
              ? 'Подождите…'
              : mode === 'signup'
                ? 'Создать аккаунт'
                : 'Войти'}
          </Button>
        </form>
        <p className="center small muted">
          {mode === 'signup' ? 'Уже есть аккаунт?' : 'Нет аккаунта?'}{' '}
          <button
            className="link-btn"
            onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
          >
            {mode === 'signup' ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </p>
      </Card>
    </div>
  )
}

const navItems = [
  ['/app', LayoutDashboard, 'Обзор'],
  ['/app/documents', FileText, 'Документы'],
  ['/app/companies', Building2, 'Контрагенты'],
  ['/app/vehicles', Truck, 'Транспорт'],
  ['/app/drivers', UserRound, 'Водители'],
  ['/app/import', Import, 'Импорт'],
  ['/app/integrations', Settings, 'Интеграции'],
  ['/app/billing', CreditCard, 'Тариф и лимиты'],
  ['/app/privacy', ShieldAlert, 'Данные и удаление'],
] as const
function AppShell({
  email,
  children,
  onSignout,
}: {
  email: string
  children: any
  onSignout: () => void
}) {
  const [mobile, setMobile] = useState(false)
  return (
    <div className="app-shell">
      <aside className={cls('sidebar', mobile && 'mobile-open')}>
        <div className="side-logo">
          <Logo />
        </div>
        <nav>
          {navItems.map(([p, I, t]) => (
            <button
              className={
                location.pathname === p || location.pathname.startsWith(p + '/')
                  ? 'active'
                  : ''
              }
              key={p}
              onClick={() => {
                go(p)
                setMobile(false)
              }}
            >
              <I size={18} />
              {t}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="user-chip">
            <div className="avatar">{email.slice(0, 1).toUpperCase()}</div>
            <div>
              <b>{email}</b>
              <small>{cloudEnabled ? 'Облако' : 'Демо'}</small>
            </div>
          </div>
          <button onClick={onSignout}>
            <LogOut size={17} />
            Выйти
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-top">
          <button className="mobile-menu" onClick={() => setMobile(!mobile)}>
            <Menu />
          </button>
          <div className="spacer" />
          <Badge tone={cloudEnabled ? 'success' : 'warn'}>
            {cloudEnabled ? 'Supabase подключён' : 'Демо-режим'}
          </Badge>
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  )
}

function Dashboard({ docs }: { docs: DocumentRow[] }) {
  const month = new Date().toISOString().slice(0, 7)
  const current = docs.filter((d) => d.created_at.startsWith(month))
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Обзор</h1>
          <p>Черновики ЭТрН и готовность к передаче оператору.</p>
        </div>
        <Button onClick={() => go('/app/documents/new')}>
          <Plus size={16} />
          Новая ЭТрН
        </Button>
      </div>
      <div className="stats">
        <Card>
          <span>Черновики за месяц</span>
          <b>{current.length}</b>
        </Card>
        <Card>
          <span>Готовы к передаче</span>
          <b>{docs.filter((d) => d.status === 'ready').length}</b>
        </Card>
        <Card>
          <span>Требуют заполнения</span>
          <b>{docs.filter((d) => d.status === 'incomplete').length}</b>
        </Card>
        <Card>
          <span>Всего документов</span>
          <b>{docs.length}</b>
        </Card>
      </div>
      <Card>
        <div className="card-head">
          <h3>Последние документы</h3>
          <Button variant="ghost" onClick={() => go('/app/documents')}>
            Все документы <ChevronRight size={16} />
          </Button>
        </div>
        <DocTable docs={docs.slice(0, 5)} onReload={() => {}} />
      </Card>
    </>
  )
}

function StatusBadge({ s }: { s: DocumentRow['status'] }) {
  return (
    <Badge
      tone={
        s === 'ready'
          ? 'success'
          : s === 'incomplete'
            ? 'warn'
            : s === 'archived'
              ? 'neutral'
              : 'info'
      }
    >
      {statusLabel[s]}
    </Badge>
  )
}
function DocTable({
  docs,
  onReload,
}: {
  docs: DocumentRow[]
  onReload: () => void
}) {
  const dup = async (d: DocumentRow) => {
    try {
      const x = {
        ...d,
        id: uid(),
        doc_number: `${d.doc_number}-копия`,
        status: 'draft' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      await saveDocument(x)
      onReload()
    } catch (e) {
      alert(billingErrorMessage(e))
    }
  }
  const arch = async (d: DocumentRow) => {
    await saveDocument({
      ...d,
      status: d.status === 'archived' ? 'draft' : 'archived',
    })
    onReload()
  }
  const del = async (d: DocumentRow) => {
    if (confirm(`Удалить ${d.doc_number}?`)) {
      await deleteDocument(d.id)
      onReload()
    }
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>№</th>
            <th>Дата</th>
            <th>Маршрут</th>
            <th>Перевозчик</th>
            <th>Статус</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {docs.length === 0 ? (
            <tr>
              <td colSpan={6} className="empty">
                Документов пока нет
              </td>
            </tr>
          ) : (
            docs.map((d) => (
              <tr key={d.id}>
                <td>
                  <button
                    className="table-link"
                    onClick={() => go(`/app/documents/${d.id}`)}
                  >
                    {d.doc_number}
                  </button>
                </td>
                <td>{fmt(d.doc_date)}</td>
                <td>
                  {d.data.route.loadAddress || '—'} →{' '}
                  {d.data.route.unloadAddress || '—'}
                </td>
                <td>{d.data.carrier.name || '—'}</td>
                <td>
                  <StatusBadge s={d.status} />
                </td>
                <td>
                  <div className="row-actions">
                    <button title="Дублировать" onClick={() => dup(d)}>
                      <Copy size={16} />
                    </button>
                    <button title="Архив" onClick={() => arch(d)}>
                      <Archive size={16} />
                    </button>
                    <button title="Удалить" onClick={() => del(d)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function NewDocumentPage({
  onCreated,
}: {
  onCreated: (d: DocumentRow) => void
}) {
  const started = useRef(false)
  const [error, setError] = useState('')
  const create = async () => {
    if (started.current) return
    started.current = true
    setError('')
    try {
      const d = newDoc()
      const saved = await saveDocument(d)
      onCreated(saved)
      go(`/app/documents/${saved.id}/edit`)
    } catch (e: any) {
      started.current = false
      setError(billingErrorMessage(e))
    }
  }
  useEffect(() => {
    void create()
  }, [])
  return (
    <Card>
      {error ? (
        <div className="stack">
          <div className="error-box">{error}</div>
          <p className="muted">
            Если сообщение связано с тарифом, откройте «Тариф и лимиты». Для
            ошибок базы проверьте подключение и применены ли SQL-миграции.
          </p>
          <div className="actions">
            <Button variant="outline" onClick={() => go('/app/documents')}>
              К документам
            </Button>
            <Button variant="outline" onClick={() => go('/app/billing')}>
              Тариф и лимиты
            </Button>
            <Button onClick={() => void create()}>Повторить</Button>
          </div>
        </div>
      ) : (
        <div className="loading-inline">
          <RefreshCw className="spin" size={18} />
          Создаём черновик…
        </div>
      )}
    </Card>
  )
}

function Documents({
  docs,
  reload,
}: {
  docs: DocumentRow[]
  reload: () => void
}) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const shown = docs.filter(
    (d) =>
      (filter === 'all' || d.status === filter) &&
      [
        d.doc_number,
        d.data.shipper.name,
        d.data.consignee.name,
        d.data.carrier.name,
        d.data.route.loadAddress,
        d.data.route.unloadAddress,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q.toLowerCase()),
  )
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Документы</h1>
          <p>Черновики электронной транспортной накладной.</p>
        </div>
        <Button onClick={() => go('/app/documents/new')}>
          <Plus size={16} />
          Новая ЭТрН
        </Button>
      </div>
      <Card>
        <div className="toolbar">
          <div className="search">
            <Search size={17} />
            <Input
              placeholder="Поиск по документам"
              value={q}
              onChange={(e: any) => setQ(e.target.value)}
            />
          </div>
          <Select
            value={filter}
            onChange={(e: any) => setFilter(e.target.value)}
          >
            <option value="all">Все статусы</option>
            <option value="draft">Черновик</option>
            <option value="incomplete">Требует заполнения</option>
            <option value="ready">Готов</option>
            <option value="archived">Архив</option>
          </Select>
        </div>
        <DocTable docs={shown} onReload={reload} />
      </Card>
    </>
  )
}

function RussianAddressEditor({
  title,
  value,
  onChange,
  open = false,
}: {
  title: string
  value?: RussianAddressDraft
  onChange: (a: RussianAddressDraft) => void
  open?: boolean
}) {
  const a = { ...emptyRussianAddress(), ...(value ?? {}) }
  const set = (key: keyof RussianAddressDraft, v: string) =>
    onChange({ ...a, [key]: v })
  return (
    <details className="address-details" open={open}>
      <summary>
        {title}
        <span>для точного маппинга оператору</span>
      </summary>
      <div className="form-grid address-grid">
        <Field label="Индекс">
          <Input
            inputMode="numeric"
            value={a.zipCode}
            placeholder="620050"
            onChange={(e: any) =>
              set('zipCode', e.target.value.replace(/\D/g, ''))
            }
          />
        </Field>
        <Field label="Код региона">
          <Input
            inputMode="numeric"
            value={a.region}
            placeholder="66"
            onChange={(e: any) =>
              set('region', e.target.value.replace(/\D/g, ''))
            }
          />
        </Field>
        <Field label="Город">
          <Input
            value={a.city}
            placeholder="Екатеринбург"
            onChange={(e: any) => set('city', e.target.value)}
          />
        </Field>
        <Field label="Населённый пункт">
          <Input
            value={a.settlement}
            placeholder="Если отличается от города"
            onChange={(e: any) => set('settlement', e.target.value)}
          />
        </Field>
        <Field label="Улица">
          <Input
            value={a.street}
            placeholder="Ленина"
            onChange={(e: any) => set('street', e.target.value)}
          />
        </Field>
        <Field label="Дом">
          <Input
            value={a.building}
            placeholder="1"
            onChange={(e: any) => set('building', e.target.value)}
          />
        </Field>
        <Field label="Корпус / строение">
          <Input
            value={a.corpus}
            placeholder="2"
            onChange={(e: any) => set('corpus', e.target.value)}
          />
        </Field>
        <Field label="Квартира / офис">
          <Input
            value={a.apartment}
            placeholder="3"
            onChange={(e: any) => set('apartment', e.target.value)}
          />
        </Field>
      </div>
      <p className="muted tiny">
        Мы не разбираем обычную строку адреса автоматически: неверно угаданный
        регион, город или дом может испортить операторский XML.
      </p>
    </details>
  )
}
const partyToCompany = (p: Party, roles: string[]): Company => ({
  id: uid(),
  org_type: p.kind,
  name: p.name,
  inn: p.inn,
  kpp: p.kpp,
  roles,
  address: p.address,
  phone: p.phone,
  email: p.email,
  edo_id: p.edoId ?? '',
  address_zip_code: p.russianAddress?.zipCode ?? '',
  address_region: p.russianAddress?.region ?? '',
  address_city: p.russianAddress?.city ?? '',
  address_settlement: p.russianAddress?.settlement ?? '',
  address_street: p.russianAddress?.street ?? '',
  address_building: p.russianAddress?.building ?? '',
  address_corpus: p.russianAddress?.corpus ?? '',
  address_apartment: p.russianAddress?.apartment ?? '',
})
function PartyEditor({
  title,
  value,
  onChange,
  companies,
  onCreate,
}: {
  title: string
  value: Party
  onChange: (p: Party) => void
  companies: Company[]
  onCreate?: () => void
}) {
  const choose = (id: string) => {
    const c = companies.find((x) => x.id === id)
    if (c)
      onChange({
        ...value,
        kind: c.org_type ?? value.kind,
        name: c.name,
        inn: c.inn,
        kpp: c.kpp,
        address: c.address,
        phone: c.phone,
        email: c.email,
        edoId: c.edo_id ?? '',
        russianAddress: {
          zipCode: c.address_zip_code ?? '',
          region: c.address_region ?? '',
          city: c.address_city ?? '',
          settlement: c.address_settlement ?? '',
          street: c.address_street ?? '',
          building: c.address_building ?? '',
          corpus: c.address_corpus ?? '',
          apartment: c.address_apartment ?? '',
        },
      })
  }
  return (
    <Card className="subcard">
      <h3>{title}</h3>
      <Field label="Из справочника">
        <Select defaultValue="" onChange={(e: any) => choose(e.target.value)}>
          <option value="">— Выбрать —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.inn}
            </option>
          ))}
        </Select>
      </Field>
      <div className="form-grid">
        <Field label="Тип">
          <Select
            value={value.kind}
            onChange={(e: any) => onChange({ ...value, kind: e.target.value })}
          >
            <option value="org">Организация</option>
            <option value="ip">ИП</option>
          </Select>
        </Field>
        <Field label="Наименование">
          <Input
            value={value.name}
            onChange={(e: any) => onChange({ ...value, name: e.target.value })}
          />
        </Field>
        <Field label="ИНН">
          <Input
            inputMode="numeric"
            value={value.inn}
            onChange={(e: any) =>
              onChange({ ...value, inn: e.target.value.replace(/\D/g, '') })
            }
          />
        </Field>
        <Field label="КПП">
          <Input
            value={value.kpp}
            onChange={(e: any) => onChange({ ...value, kpp: e.target.value })}
          />
        </Field>
        <Field label="Телефон">
          <Input
            value={value.phone}
            onChange={(e: any) => onChange({ ...value, phone: e.target.value })}
          />
        </Field>
        <Field label="Email">
          <Input
            value={value.email}
            onChange={(e: any) => onChange({ ...value, email: e.target.value })}
          />
        </Field>
        <Field label="Адрес">
          <Input
            value={value.address}
            onChange={(e: any) =>
              onChange({ ...value, address: e.target.value })
            }
          />
        </Field>
        <Field label="BoxId / ID участника ЭДО">
          <Input
            value={value.edoId ?? ''}
            placeholder="Например BoxId в Диадоке"
            onChange={(e: any) =>
              onChange({ ...value, edoId: e.target.value.trim() })
            }
          />
        </Field>
      </div>
      <p className="muted tiny">
        Для первого адаптера Контур это поле используется как BoxId организации.
        ИНН сюда не подставляется.
      </p>
      <RussianAddressEditor
        title="Структурированный адрес участника (опционально)"
        value={value.russianAddress}
        onChange={(a) => onChange({ ...value, russianAddress: a })}
      />
      {onCreate && (
        <div className="inline-create">
          <Button
            variant="outline"
            disabled={!value.name.trim() || !validInn(value.inn)}
            onClick={onCreate}
          >
            <Plus size={14} />
            Сохранить в справочник
          </Button>
        </div>
      )}
    </Card>
  )
}

function Wizard({
  doc,
  companies,
  vehicles,
  drivers,
  onSaved,
  onDirectoriesChanged,
}: {
  doc: DocumentRow
  companies: Company[]
  vehicles: Vehicle[]
  drivers: Driver[]
  onSaved: (d: DocumentRow) => void
  onDirectoriesChanged: () => Promise<void>
}) {
  const prepared = { ...doc, data: normalizeEtrn(doc.data) }
  const [d, setD] = useState(prepared)
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('Сохранено')
  const timer = useRef<any>(null)
  const latest = useRef(prepared)
  const dirty = useRef(false)
  const issues = validateEtrn(d.data)
  const required = issues.filter((x) => x.kind === 'required')
  const operatorIssues = issues.filter((x) => x.kind === 'operator')
  const recommended = issues.filter((x) => x.kind !== 'required')
  const readiness = operatorReadiness(d.data)
  const loading = d.data.loadingDetails!
  const persist = async (x = latest.current) => {
    setSaving(true)
    try {
      const n = await saveDocument(x)
      latest.current = n
      dirty.current = false
      setD(n)
      onSaved(n)
      setSaved('Сохранено')
      return n
    } catch (e) {
      dirty.current = true
      setSaved('Ошибка сохранения')
      throw e
    } finally {
      setSaving(false)
    }
  }
  const change = (data: EtrnData) => {
    const n = {
      ...d,
      data,
      status: (isReady(data) ? 'draft' : 'incomplete') as DocumentRow['status'],
    }
    latest.current = n
    dirty.current = true
    setD(n)
    setSaved(
      d.status === 'ready'
        ? 'Изменено — подтвердите готовность заново'
        : 'Есть изменения',
    )
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void persist(n).catch(() => {})
    }, 700)
  }
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    addEventListener('beforeunload', beforeUnload)
    return () => {
      removeEventListener('beforeunload', beforeUnload)
      clearTimeout(timer.current)
      if (dirty.current) {
        const pending = latest.current
        onSaved(pending)
        void saveDocument(pending).catch(() => {})
      }
    }
  }, [])
  const markReady = async () => {
    if (!isReady(d.data)) return
    const n = { ...d, status: 'ready' as const }
    latest.current = n
    dirty.current = true
    await persist(n)
  }
  const addCargo = () =>
    change({ ...d.data, cargo: [...d.data.cargo, emptyCargo()] })
  return (
    <>
      <div className="page-title">
        <div>
          <Button variant="ghost" onClick={() => go('/app/documents')}>
            <ArrowLeft size={16} />К документам
          </Button>
          <h1>{d.doc_number}</h1>
          <p>
            {fmt(d.doc_date)} · <StatusBadge s={d.status} />
          </p>
        </div>
        <div className="save-status">
          <Save size={15} />
          {saving ? 'Сохраняем…' : saved}
        </div>
      </div>
      <div className="wizard">
        <div className="steps">
          {[
            'Участники',
            'Маршрут',
            'Груз',
            'Транспорт',
            'Условия',
            'Проверка',
          ].map((x, i) => (
            <button
              className={step === i + 1 ? 'active' : ''}
              onClick={() => setStep(i + 1)}
              key={x}
            >
              <span>{i + 1}</span>
              {x}
            </button>
          ))}
        </div>
        <Card className="wizard-body">
          {step === 1 && (
            <div className="stack">
              <PartyEditor
                title="Грузоотправитель"
                value={d.data.shipper}
                companies={companies}
                onChange={(p) => change({ ...d.data, shipper: p })}
                onCreate={async () => {
                  await saveCompany(
                    partyToCompany(d.data.shipper, ['грузоотправитель']),
                  )
                  await onDirectoriesChanged()
                }}
              />
              <PartyEditor
                title="Грузополучатель"
                value={d.data.consignee}
                companies={companies}
                onChange={(p) => change({ ...d.data, consignee: p })}
                onCreate={async () => {
                  await saveCompany(
                    partyToCompany(d.data.consignee, ['грузополучатель']),
                  )
                  await onDirectoriesChanged()
                }}
              />
              <PartyEditor
                title="Перевозчик"
                value={d.data.carrier}
                companies={companies}
                onChange={(p) => change({ ...d.data, carrier: p })}
                onCreate={async () => {
                  await saveCompany(
                    partyToCompany(d.data.carrier, ['перевозчик']),
                  )
                  await onDirectoriesChanged()
                }}
              />
            </div>
          )}
          {step === 2 && (
            <>
              <h2>Маршрут и погрузка</h2>
              <div className="form-grid">
                <Field label="Адрес погрузки">
                  <Input
                    value={d.data.route.loadAddress}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        route: { ...d.data.route, loadAddress: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Дата погрузки">
                  <Input
                    type="date"
                    value={d.data.route.loadDate}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        route: { ...d.data.route, loadDate: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Время погрузки">
                  <Input
                    type="time"
                    value={d.data.route.loadTime}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        route: { ...d.data.route, loadTime: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Адрес выгрузки">
                  <Input
                    value={d.data.route.unloadAddress}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        route: {
                          ...d.data.route,
                          unloadAddress: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Дата выгрузки">
                  <Input
                    type="date"
                    value={d.data.route.unloadDate}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        route: { ...d.data.route, unloadDate: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Время выгрузки">
                  <Input
                    type="time"
                    value={d.data.route.unloadTime}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        route: { ...d.data.route, unloadTime: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Фактическое прибытие на погрузку">
                  <Input
                    type="datetime-local"
                    value={d.data.route.loadArrival ?? ''}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        route: { ...d.data.route, loadArrival: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Фактическое убытие после погрузки">
                  <Input
                    type="datetime-local"
                    value={d.data.route.loadDeparture ?? ''}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        route: {
                          ...d.data.route,
                          loadDeparture: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Фактическая масса брутто, кг">
                  <Input
                    inputMode="decimal"
                    value={d.data.route.actualWeight ?? ''}
                    placeholder="Если отличается от суммы позиций"
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        route: {
                          ...d.data.route,
                          actualWeight: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Фактически принято мест">
                  <Input
                    inputMode="numeric"
                    value={d.data.route.actualPlaces ?? ''}
                    placeholder="Если отличается от суммы позиций"
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        route: {
                          ...d.data.route,
                          actualPlaces: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Код метода определения массы">
                  <Input
                    value={d.data.route.massMethod ?? ''}
                    placeholder="Например 01 — сверим с UserDataXsd"
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        route: {
                          ...d.data.route,
                          massMethod: e.target.value.trim(),
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Примечание">
                  <Textarea
                    value={d.data.route.note}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        route: { ...d.data.route, note: e.target.value },
                      })
                    }
                  />
                </Field>
              </div>
              <div className="address-pair">
                <RussianAddressEditor
                  title="Структурированный адрес погрузки"
                  value={d.data.route.loadRussianAddress}
                  onChange={(a) =>
                    change({
                      ...d.data,
                      route: { ...d.data.route, loadRussianAddress: a },
                    })
                  }
                  open
                />
                <RussianAddressEditor
                  title="Структурированный адрес выгрузки"
                  value={d.data.route.unloadRussianAddress}
                  onChange={(a) =>
                    change({
                      ...d.data,
                      route: { ...d.data.route, unloadRussianAddress: a },
                    })
                  }
                  open
                />
              </div>
              <Card className="subcard loading-details-card">
                <div className="card-head">
                  <div>
                    <h3>Лицо и владелец места погрузки</h3>
                    <p className="muted">
                      Поля-кандидаты для <code>LoadingPartyDetails</code> и{' '}
                      <code>LoadingOwnerDetails</code> Диадока.
                    </p>
                  </div>
                </div>
                <div className="form-grid">
                  <Field label="MatchingShipper">
                    <Select
                      value={loading.matchingShipper}
                      onChange={(e: any) =>
                        change({
                          ...d.data,
                          loadingDetails: {
                            ...loading,
                            matchingShipper: e.target.value,
                          },
                        })
                      }
                    >
                      <option value="">— Не задано —</option>
                      <option value="1">
                        1 — совпадает с грузоотправителем
                      </option>
                      <option value="0">0 — не совпадает</option>
                    </Select>
                  </Field>
                  <Field label="ИНН лица, осуществляющего погрузку">
                    <Input
                      inputMode="numeric"
                      value={loading.partyInn}
                      placeholder={
                        loading.matchingShipper === '1'
                          ? d.data.shipper.inn
                          : 'ИНН'
                      }
                      onChange={(e: any) =>
                        change({
                          ...d.data,
                          loadingDetails: {
                            ...loading,
                            partyInn: e.target.value.replace(/\D/g, ''),
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="ФИО сотрудника погрузки">
                    <Input
                      value={loading.employeeFullName}
                      placeholder="Фамилия Имя Отчество"
                      onChange={(e: any) =>
                        change({
                          ...d.data,
                          loadingDetails: {
                            ...loading,
                            employeeFullName: e.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Должность сотрудника">
                    <Input
                      value={loading.employeePosition}
                      placeholder="Сотрудник"
                      onChange={(e: any) =>
                        change({
                          ...d.data,
                          loadingDetails: {
                            ...loading,
                            employeePosition: e.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Должностные обязанности">
                    <Input
                      value={loading.employeeResponsibilities}
                      placeholder="Если применимо"
                      onChange={(e: any) =>
                        change({
                          ...d.data,
                          loadingDetails: {
                            ...loading,
                            employeeResponsibilities: e.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="LoadingOwnerDetails Type">
                    <Input
                      value={loading.ownerType}
                      placeholder="Код Type из UserDataXsd"
                      onChange={(e: any) =>
                        change({
                          ...d.data,
                          loadingDetails: {
                            ...loading,
                            ownerType: e.target.value.trim(),
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="ИНН владельца места погрузки">
                    <Input
                      inputMode="numeric"
                      value={loading.ownerInn}
                      placeholder="ИНН"
                      onChange={(e: any) =>
                        change({
                          ...d.data,
                          loadingDetails: {
                            ...loading,
                            ownerInn: e.target.value.replace(/\D/g, ''),
                          },
                        })
                      }
                    />
                  </Field>
                </div>
                <p className="muted tiny">
                  Если <code>MatchingShipper=1</code> и отдельный ИНН лица
                  погрузки не указан, preview может использовать ИНН
                  грузоотправителя. Код <code>Type</code> владельца не угадываем
                  — его нужно сверить с актуальным UserDataXsd.
                </p>
              </Card>
              <div className="warning">
                <ShieldAlert size={18} />
                <span>
                  Для Kontur UserDataXml адреса погрузки/доставки формируются из
                  структурированных полей. Обычная строка адреса остаётся
                  удобным отображением и не парсится автоматически.
                </span>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <div className="card-head">
                <div>
                  <h2>Груз</h2>
                  <p className="muted">
                    Позиции перевозимого груза и данные-кандидаты для титула Т1.
                  </p>
                </div>
                <Button variant="outline" onClick={addCargo}>
                  <Plus size={15} />
                  Добавить позицию
                </Button>
              </div>
              {d.data.cargo.map((c, i) => (
                <Card className="subcard cargo-row" key={c.id}>
                  <div className="card-head">
                    <b>Позиция {i + 1}</b>
                    {d.data.cargo.length > 1 && (
                      <button
                        onClick={() =>
                          change({
                            ...d.data,
                            cargo: d.data.cargo.filter((x) => x.id !== c.id),
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  <div className="form-grid">
                    <Field label="Наименование">
                      <Input
                        value={c.name}
                        onChange={(e: any) =>
                          change({
                            ...d.data,
                            cargo: d.data.cargo.map((x) =>
                              x.id === c.id
                                ? { ...x, name: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Состояние груза">
                      <Input
                        value={c.state ?? ''}
                        placeholder="Например: Целый"
                        onChange={(e: any) =>
                          change({
                            ...d.data,
                            cargo: d.data.cargo.map((x) =>
                              x.id === c.id
                                ? { ...x, state: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Количество мест">
                      <Input
                        type="number"
                        min="0"
                        value={c.places}
                        onChange={(e: any) =>
                          change({
                            ...d.data,
                            cargo: d.data.cargo.map((x) =>
                              x.id === c.id
                                ? { ...x, places: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Единица">
                      <Input
                        value={c.unit}
                        onChange={(e: any) =>
                          change({
                            ...d.data,
                            cargo: d.data.cargo.map((x) =>
                              x.id === c.id
                                ? { ...x, unit: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Масса брутто, кг">
                      <Input
                        inputMode="decimal"
                        value={c.weight}
                        onChange={(e: any) =>
                          change({
                            ...d.data,
                            cargo: d.data.cargo.map((x) =>
                              x.id === c.id
                                ? { ...x, weight: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Объявленная стоимость">
                      <Input
                        inputMode="decimal"
                        value={c.value}
                        onChange={(e: any) =>
                          change({
                            ...d.data,
                            cargo: d.data.cargo.map((x) =>
                              x.id === c.id
                                ? { ...x, value: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Код валюты">
                      <Input
                        value={c.currency ?? '643'}
                        placeholder="643"
                        onChange={(e: any) =>
                          change({
                            ...d.data,
                            cargo: d.data.cargo.map((x) =>
                              x.id === c.id
                                ? { ...x, currency: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Тара / упаковка">
                      <Input
                        value={c.packaging}
                        onChange={(e: any) =>
                          change({
                            ...d.data,
                            cargo: d.data.cargo.map((x) =>
                              x.id === c.id
                                ? { ...x, packaging: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Способ упаковки / PackageMethod">
                      <Input
                        value={c.packagingMethod ?? ''}
                        placeholder="Например: Коробки"
                        onChange={(e: any) =>
                          change({
                            ...d.data,
                            cargo: d.data.cargo.map((x) =>
                              x.id === c.id
                                ? { ...x, packagingMethod: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="Код тары / ContainerType"
                      hint="В публичном примере Диадока встречаются 00 и 1W; полный перечень сверяем по UserDataXsd."
                    >
                      <Input
                        value={c.packagingCode ?? ''}
                        placeholder="Например: 00"
                        onChange={(e: any) =>
                          change({
                            ...d.data,
                            cargo: d.data.cargo.map((x) =>
                              x.id === c.id
                                ? { ...x, packagingCode: e.target.value.trim() }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Маркировка">
                      <Input
                        value={c.marking ?? ''}
                        placeholder="Например: Отсутствует"
                        onChange={(e: any) =>
                          change({
                            ...d.data,
                            cargo: d.data.cargo.map((x) =>
                              x.id === c.id
                                ? { ...x, marking: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Особые условия">
                      <Input
                        value={c.conditions}
                        onChange={(e: any) =>
                          change({
                            ...d.data,
                            cargo: d.data.cargo.map((x) =>
                              x.id === c.id
                                ? { ...x, conditions: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                  </div>
                </Card>
              ))}
              <div className="totals">
                Итого: <b>{cargoTotals(d.data).places} мест</b> ·{' '}
                <b>{cargoTotals(d.data).weight} кг</b>
              </div>
              <div className="warning">
                <ShieldAlert size={18} />
                <span>
                  Названия <b>PackageMethod</b> и <b>ContainerType</b>{' '}
                  соответствуют текущему публичному примеру Диадока, но
                  допустимые коды должны проверяться по актуальному UserDataXsd
                  перед GenerateTitleXml.
                </span>
              </div>
            </>
          )}
          {step === 4 && (
            <>
              <h2>Транспорт и водитель</h2>
              <div className="form-grid">
                <Field label="Автомобиль из справочника">
                  <Select
                    defaultValue=""
                    onChange={(e: any) => {
                      const v = vehicles.find((x) => x.id === e.target.value)
                      if (v)
                        change({
                          ...d.data,
                          transport: {
                            ...d.data.transport,
                            brand: v.brand,
                            model: v.model,
                            plate: v.plate,
                            trailerPlate: v.trailer_plate,
                            vehicleType:
                              v.vehicle_type || d.data.transport.vehicleType,
                            ownershipType: v.ownership_type ?? '',
                            loadCapacity: v.load_capacity ?? '',
                            volumeCapacity: v.volume_capacity ?? '',
                          },
                        })
                    }}
                  >
                    <option value="">— Выбрать —</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.brand} {v.model} · {v.plate}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Тип ТС">
                  <Input
                    value={d.data.transport.vehicleType ?? ''}
                    placeholder="Например: грузовой автомобиль"
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          vehicleType: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Марка">
                  <Input
                    value={d.data.transport.brand}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          brand: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Модель">
                  <Input
                    value={d.data.transport.model}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          model: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Госномер">
                  <Input
                    value={d.data.transport.plate}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          plate: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Прицеп">
                  <Input
                    value={d.data.transport.trailerPlate}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          trailerPlate: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Код Ownership (оператор)">
                  <Input
                    value={d.data.transport.ownershipType ?? ''}
                    placeholder="Сверяется с актуальным UserDataXsd"
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          ownershipType: e.target.value.trim(),
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Грузоподъёмность / MaxWeight">
                  <Input
                    inputMode="decimal"
                    value={d.data.transport.loadCapacity ?? ''}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          loadCapacity: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Вместимость / Capacity">
                  <Input
                    inputMode="decimal"
                    value={d.data.transport.volumeCapacity ?? ''}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          volumeCapacity: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Водитель из справочника">
                  <Select
                    defaultValue=""
                    onChange={(e: any) => {
                      const x = drivers.find((y) => y.id === e.target.value)
                      if (x)
                        change({
                          ...d.data,
                          transport: {
                            ...d.data.transport,
                            driverName: x.full_name,
                            driverPhone: x.phone,
                            driverLicense: x.license,
                            driverLicenseSeries: x.license_series ?? '',
                            driverLicenseNumber: x.license_number ?? '',
                            driverLicenseDate: x.license_date ?? '',
                          },
                        })
                    }}
                  >
                    <option value="">— Выбрать —</option>
                    {drivers.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.full_name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="ФИО водителя">
                  <Input
                    value={d.data.transport.driverName}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          driverName: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Телефон">
                  <Input
                    value={d.data.transport.driverPhone}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          driverPhone: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="ВУ из старого справочника">
                  <Input
                    value={d.data.transport.driverLicense}
                    placeholder="Свободный текст для совместимости"
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          driverLicense: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Серия ВУ">
                  <Input
                    value={d.data.transport.driverLicenseSeries ?? ''}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          driverLicenseSeries: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Номер ВУ">
                  <Input
                    value={d.data.transport.driverLicenseNumber ?? ''}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          driverLicenseNumber: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Дата выдачи ВУ">
                  <Input
                    type="date"
                    value={d.data.transport.driverLicenseDate ?? ''}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          driverLicenseDate: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Номер путевого листа">
                  <Input
                    value={d.data.transport.waybillNumber ?? ''}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          waybillNumber: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Дата путевого листа">
                  <Input
                    type="date"
                    value={d.data.transport.waybillDate ?? ''}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        transport: {
                          ...d.data.transport,
                          waybillDate: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
              </div>
              <div className="warning">
                <ShieldAlert size={18} />
                <span>
                  <b>Ownership, MaxWeight и Capacity</b> сейчас сохраняются как
                  операторские поля-кандидаты. Мы не подставляем выдуманные
                  коды: перечисления должны быть сверены с актуальным
                  UserDataXsd перед GenerateTitleXml.
                </span>
              </div>
              <div className="inline-create two">
                <Button
                  variant="outline"
                  disabled={!d.data.transport.plate.trim()}
                  onClick={async () => {
                    await saveVehicle({
                      id: uid(),
                      brand: d.data.transport.brand,
                      model: d.data.transport.model,
                      plate: d.data.transport.plate,
                      vehicle_type: d.data.transport.vehicleType || 'грузовой',
                      trailer_plate: d.data.transport.trailerPlate,
                      ownership_type: d.data.transport.ownershipType ?? '',
                      load_capacity: d.data.transport.loadCapacity ?? '',
                      volume_capacity: d.data.transport.volumeCapacity ?? '',
                    })
                    await onDirectoriesChanged()
                  }}
                >
                  <Plus size={14} />
                  Сохранить транспорт
                </Button>
                <Button
                  variant="outline"
                  disabled={!d.data.transport.driverName.trim()}
                  onClick={async () => {
                    const license =
                      [
                        d.data.transport.driverLicenseSeries,
                        d.data.transport.driverLicenseNumber,
                      ]
                        .filter(Boolean)
                        .join(' ') || d.data.transport.driverLicense
                    await saveDriver({
                      id: uid(),
                      full_name: d.data.transport.driverName,
                      phone: d.data.transport.driverPhone,
                      license,
                      license_series:
                        d.data.transport.driverLicenseSeries ?? '',
                      license_number:
                        d.data.transport.driverLicenseNumber ?? '',
                      license_date: d.data.transport.driverLicenseDate ?? '',
                    })
                    await onDirectoriesChanged()
                  }}
                >
                  <Plus size={14} />
                  Сохранить водителя
                </Button>
              </div>
            </>
          )}
          {step === 5 && (
            <>
              <h2>Основание, условия и подписант</h2>
              <div className="form-grid">
                <Field label="Номер заказа / заявки">
                  <Input
                    value={d.data.terms.orderNumber ?? ''}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        terms: { ...d.data.terms, orderNumber: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Дата заказа / заявки">
                  <Input
                    type="date"
                    value={d.data.terms.orderDate ?? ''}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        terms: { ...d.data.terms, orderDate: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Номер договора">
                  <Input
                    value={d.data.terms.contractNumber}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        terms: {
                          ...d.data.terms,
                          contractNumber: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Дата договора">
                  <Input
                    type="date"
                    value={d.data.terms.contractDate}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        terms: {
                          ...d.data.terms,
                          contractDate: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Стоимость перевозки">
                  <Input
                    value={d.data.terms.price}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        terms: { ...d.data.terms, price: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Указания грузоотправителя">
                  <Textarea
                    value={d.data.terms.shipperInstructions ?? ''}
                    placeholder="Или явно укажите: отсутствуют"
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        terms: {
                          ...d.data.terms,
                          shipperInstructions: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Контакт для переадресовки">
                  <Input
                    value={d.data.terms.redirectionContact ?? ''}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        terms: {
                          ...d.data.terms,
                          redirectionContact: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="ФИО подписанта грузоотправителя">
                  <Input
                    value={d.data.signer?.fullName ?? ''}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        signer: {
                          fullName: e.target.value,
                          position: d.data.signer?.position ?? '',
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Должность подписанта">
                  <Input
                    value={d.data.signer?.position ?? ''}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        signer: {
                          fullName: d.data.signer?.fullName ?? '',
                          position: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Комментарий">
                  <Textarea
                    value={d.data.terms.comment}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        terms: { ...d.data.terms, comment: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Дополнительные условия">
                  <Textarea
                    value={d.data.terms.extra}
                    onChange={(e: any) =>
                      change({
                        ...d.data,
                        terms: { ...d.data.terms, extra: e.target.value },
                      })
                    }
                  />
                </Field>
              </div>
              <div className="warning">
                <ShieldAlert size={18} />
                <span>
                  ФИО и должность здесь — данные внутреннего черновика.
                  Фактический способ подписания и статус подписанта определяются
                  оператором и правилами ЭПД.
                </span>
              </div>
            </>
          )}
          {step === 6 && (
            <>
              <h2>Проверка черновика</h2>
              <div className="review-grid">
                <Card>
                  <h3>Обязательное для черновика ЭПД Лайт</h3>
                  {required.length === 0 ? (
                    <div className="success-box">
                      <Check size={18} />
                      Все базовые обязательные поля заполнены.
                    </div>
                  ) : (
                    <ul className="issues">
                      {required.map((x, i) => (
                        <li key={i}>
                          <b>{x.field}:</b> {x.message}{' '}
                          <button onClick={() => setStep(x.step)}>
                            исправить
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card>
                  <div className="card-head">
                    <h3>Подготовка к Т1 / оператору</h3>
                    <Badge tone={readiness.candidate ? 'success' : 'warn'}>
                      {readiness.candidate
                        ? 'поля заполнены'
                        : `ещё ${readiness.missing}`}
                    </Badge>
                  </div>
                  {operatorIssues.length === 0 ? (
                    <div className="success-box">
                      <Check size={18} />
                      Известные нам поля-кандидаты Т1 заполнены. Это всё ещё не
                      XSD-валидация.
                    </div>
                  ) : (
                    <ul className="issues optional">
                      {operatorIssues.map((x, i) => (
                        <li key={i}>
                          <b>{x.field}:</b> {x.message}{' '}
                          <button onClick={() => setStep(x.step)}>
                            заполнить
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="muted tiny">
                    Список построен по текущей структуре титула Т1 и будет
                    уточнён после ответа ФНС и API выбранного оператора.
                  </p>
                </Card>
                <Card>
                  <h3>Дополнительные рекомендации</h3>
                  {recommended.filter((x) => x.kind === 'recommended')
                    .length === 0 ? (
                    <p className="muted">Дополнительных замечаний нет.</p>
                  ) : (
                    <ul className="issues optional">
                      {recommended
                        .filter((x) => x.kind === 'recommended')
                        .map((x, i) => (
                          <li key={i}>
                            <b>{x.field}:</b> {x.message}
                          </li>
                        ))}
                    </ul>
                  )}
                </Card>
              </div>
              <div className="warning">
                <ShieldAlert size={18} />
                <span>
                  Кнопка ниже{' '}
                  <b>
                    не валидирует XML по XSD ФНС, не подписывает документ и не
                    отправляет его в ГИС ЭПД
                  </b>
                  . Она фиксирует только внутреннюю готовность черновика.
                </span>
              </div>
              <Button disabled={!isReady(d.data)} onClick={markReady}>
                <Check size={16} />
                Отметить черновик готовым к интеграции
              </Button>
            </>
          )}
          <div className="wizard-nav">
            <Button
              variant="outline"
              disabled={step === 1}
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft size={16} />
              Назад
            </Button>
            <Button disabled={step === 6} onClick={() => setStep(step + 1)}>
              Далее
              <ArrowRight size={16} />
            </Button>
          </div>
        </Card>
      </div>
    </>
  )
}
function DocumentView({
  doc,
  reload,
}: {
  doc: DocumentRow
  reload: () => void
}) {
  const [serverCheck, setServerCheck] = useState<any>(null)
  const [konturCheck, setKonturCheck] = useState<any>(null)
  const [sandboxCheck, setSandboxCheck] = useState<any>(null)
  const [gatewayCaps, setGatewayCaps] = useState<any>(null)
  const [attempts, setAttempts] = useState<OperatorAttempt[]>([])
  const [attemptsLoading, setAttemptsLoading] = useState(false)
  const [attemptsError, setAttemptsError] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkingKontur, setCheckingKontur] = useState(false)
  const [checkingSandbox, setCheckingSandbox] = useState(false)

  const refreshAttempts = async () => {
    setAttemptsLoading(true)
    setAttemptsError('')
    try {
      setAttempts(await listOperatorAttempts(doc.id))
    } catch (e) {
      setAttemptsError(
        e instanceof Error ? e.message : 'Не удалось загрузить журнал',
      )
    } finally {
      setAttemptsLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    fetch('/api/operator/capabilities', {
      headers: { accept: 'application/json' },
    })
      .then(async (r) => {
        const ct = r.headers.get('content-type') || ''
        if (!r.ok || !ct.includes('application/json')) return null
        return r.json()
      })
      .then((x) => {
        if (alive) setGatewayCaps(x)
      })
      .catch(() => {})
    void listOperatorAttempts(doc.id)
      .then((x) => {
        if (alive) setAttempts(x)
      })
      .catch((e) => {
        if (alive)
          setAttemptsError(
            e instanceof Error ? e.message : 'Не удалось загрузить журнал',
          )
      })
    return () => {
      alive = false
    }
  }, [doc.id])

  const download = (payload: any, suffix: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${doc.doc_number}${suffix}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const downloadText = (text: string, suffix: string, type = 'text/plain') => {
    const blob = new Blob([text], { type })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${doc.doc_number}${suffix}`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const dl = () => download(exportJson(doc), '')
  const dlIntegration = () =>
    download(buildOperatorDraft(doc), '-integration-candidate')

  const serverPreflight = async () => {
    setChecking(true)
    setServerCheck(null)
    try {
      const r = await gatewayFetch('/api/operator/preflight', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildOperatorDraft(doc)),
      })
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json'))
        throw new Error('Backend gateway не подключён')
      const body = await r.json()
      setServerCheck({ ...body, httpStatus: r.status })
    } catch (e) {
      setServerCheck({
        ok: false,
        gatewayUnavailable: true,
        errors: [e instanceof Error ? e.message : 'Backend gateway недоступен'],
      })
    } finally {
      setChecking(false)
    }
  }

  const konturPreview = async () => {
    setCheckingKontur(true)
    setKonturCheck(null)
    try {
      const r = await gatewayFetch('/api/operator/kontur/userdata-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildOperatorDraft(doc)),
      })
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json'))
        throw new Error('Backend gateway не подключён')
      const body = await r.json()
      const result = { ...body, httpStatus: r.status }
      setKonturCheck(result)
      if (r.ok && body.xml)
        downloadText(
          body.xml,
          '-kontur-userdata-preview.xml',
          'application/xml;charset=utf-8',
        )
    } catch (e) {
      setKonturCheck({
        ok: false,
        gatewayUnavailable: true,
        errors: [e instanceof Error ? e.message : 'Backend gateway недоступен'],
      })
    } finally {
      setCheckingKontur(false)
    }
  }

  const sandboxReady = Boolean(gatewayCaps?.sandboxGenerateTitle?.ready)
  const persistentJournal = Boolean(
    gatewayCaps?.sandboxGenerateTitle?.persistentAttemptJournal?.configured,
  )
  const konturSandbox = async () => {
    if (!sandboxReady) return
    if (
      !window.confirm(
        'Будет выполнен реальный sandbox-запрос GenerateTitleXml к Контур/Диадок. Документ НЕ будет подписан и НЕ будет отправлен через PostMessage. Продолжить?',
      )
    )
      return
    setCheckingSandbox(true)
    setSandboxCheck(null)
    try {
      const r = await gatewayFetch(
        '/api/operator/kontur/generate-title-sandbox',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ documentId: doc.id }),
        },
      )
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json'))
        throw new Error('Backend gateway не подключён')
      const body = await r.json()
      const result = { ...body, httpStatus: r.status }
      setSandboxCheck(result)
      if (r.ok && body.generatedXml)
        downloadText(
          body.generatedXml,
          '-kontur-generated-title-sandbox.xml',
          'application/xml;charset=utf-8',
        )
      if (
        r.ok ||
        [
          'sandbox_already_generated',
          'sandbox_generation_in_progress',
        ].includes(body?.error)
      )
        void refreshAttempts()
    } catch (e) {
      setSandboxCheck({
        ok: false,
        gatewayUnavailable: true,
        message: e instanceof Error ? e.message : 'Sandbox gateway недоступен',
      })
    } finally {
      setCheckingSandbox(false)
    }
  }

  const print = () => window.print()
  const required = validateEtrn(doc.data).filter((x) => x.kind === 'required')
  const checked = required.length === 0
  const op = operatorReadiness(doc.data)

  return (
    <>
      <div className="page-title no-print">
        <div>
          <Button variant="ghost" onClick={() => go('/app/documents')}>
            <ArrowLeft size={16} />К документам
          </Button>
          <h1>{doc.doc_number}</h1>
          <p>
            <StatusBadge s={doc.status} /> · обновлён {fmt(doc.updated_at)}
          </p>
        </div>
        <div className="actions">
          <Button variant="outline" onClick={dl}>
            <Download size={16} />
            Черновик JSON
          </Button>
          <Button variant="outline" onClick={dlIntegration}>
            <FileJson size={16} />
            Integration JSON
          </Button>
          <Button
            variant="outline"
            disabled={checking}
            onClick={serverPreflight}
          >
            <ClipboardCheck size={16} />
            {checking ? 'Проверяем…' : 'Server preflight'}
          </Button>
          <Button
            variant="outline"
            disabled={checkingKontur}
            onClick={konturPreview}
          >
            <FileText size={16} />
            {checkingKontur ? 'Собираем XML…' : 'Kontur XML preview'}
          </Button>
          {sandboxReady && (
            <Button
              variant="outline"
              disabled={checkingSandbox}
              onClick={konturSandbox}
            >
              <Send size={16} />
              {checkingSandbox ? 'GenerateTitleXml…' : 'Kontur sandbox'}
            </Button>
          )}
          <Button variant="outline" onClick={print}>
            <Printer size={16} />
            Печать
          </Button>
          <Button onClick={() => go(`/app/documents/${doc.id}/edit`)}>
            Редактировать
          </Button>
        </div>
      </div>

      <Card className="status-flow no-print">
        <div className="done">
          <Check />
          Черновик создан
        </div>
        <div className={checked ? 'done' : 'pending'}>
          <ClipboardCheck />
          {checked
            ? 'Базовая проверка пройдена'
            : `Требует исправлений: ${required.length}`}
        </div>
        <div className={op.candidate ? 'done' : 'pending'}>
          <FileJson />
          {op.candidate
            ? 'Поля-кандидаты Т1 заполнены'
            : `До T1-кандидата: ${op.missing}`}
        </div>
        <div className={doc.status === 'ready' ? 'done' : 'pending'}>
          <Check />
          Внутренне готов
        </div>
        <div className="locked">
          Передан оператору <small>недоступно до интеграции</small>
        </div>
        <div className="locked">
          Подписан / принят <small>недоступно</small>
        </div>
      </Card>

      {serverCheck && (
        <div
          className={
            serverCheck.ok ? 'success-box no-print' : 'error-box no-print'
          }
        >
          {serverCheck.ok ? <Check size={18} /> : <ShieldAlert size={18} />}
          <span>
            {serverCheck.gatewayUnavailable
              ? 'Gateway не обнаружен. Для server preflight запустите Docker Compose или production backend.'
              : serverCheck.ok
                ? `Server preflight пройден. Предупреждений: ${serverCheck.warnings?.length ?? 0}. Это не XSD-валидация и не отправка оператору.`
                : `Server preflight не пройден: ${(serverCheck.errors || [serverCheck.message || serverCheck.error]).filter(Boolean).join('; ')}`}
          </span>
        </div>
      )}
      {konturCheck && (
        <div
          className={
            konturCheck.ok ? 'success-box no-print' : 'error-box no-print'
          }
        >
          {konturCheck.ok ? <Check size={18} /> : <ShieldAlert size={18} />}
          <span>
            {konturCheck.gatewayUnavailable
              ? 'Gateway не обнаружен. Kontur XML preview доступен только при запущенном backend gateway.'
              : konturCheck.ok
                ? `Kontur UserDataXml preview сформирован и скачан. Внешний API не вызывался; это ещё не результат GenerateTitleXml и не XSD-проверка ФНС. Предупреждений: ${konturCheck.warnings?.length ?? 0}.`
                : `Kontur XML preview не сформирован: ${(konturCheck.errors || [konturCheck.message || konturCheck.error]).filter(Boolean).join('; ')}`}
          </span>
        </div>
      )}
      {sandboxCheck && (
        <div
          className={
            sandboxCheck.ok ? 'success-box no-print' : 'error-box no-print'
          }
        >
          {sandboxCheck.ok ? <Check size={18} /> : <ShieldAlert size={18} />}
          <span>
            {sandboxCheck.gatewayUnavailable
              ? 'Sandbox gateway недоступен.'
              : sandboxCheck.ok
                ? `${sandboxCheck.externalResultShared ? 'Параллельный дубль схлопнут: использован тот же sandbox-результат без второго внешнего вызова.' : 'Kontur GenerateTitleXml выполнен в sandbox, результат скачан.'} Revision: ${sandboxCheck.idempotency?.sourceRevision || '—'}; fingerprint: ${String(sandboxCheck.idempotency?.requestFingerprint || '—').slice(0, 16)}…. ${sandboxCheck.persistence?.persisted ? 'Попытка записана в persistent journal.' : persistentJournal ? 'Persistent journal включён, но подтверждение записи не получено.' : 'Результат защищён только in-memory dedupe текущего gateway-процесса.'} XML не подписан и PostMessage не вызывался.`
                : `Sandbox GenerateTitleXml не выполнен: ${sandboxCheck.message || sandboxCheck.error || 'неизвестная ошибка'}`}
          </span>
        </div>
      )}

      <Card className="top-gap no-print">
        <div className="page-title" style={{ marginBottom: 12 }}>
          <div>
            <h3>История действий оператора</h3>
            <p>
              Только безопасные metadata из <code>operator_attempts</code>. XML,
              токены и данные ЭТрН здесь не хранятся.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={attemptsLoading}
            onClick={() => void refreshAttempts()}
          >
            <RefreshCw size={16} />
            {attemptsLoading ? 'Обновляем…' : 'Обновить'}
          </Button>
        </div>
        {attemptsError ? (
          <div className="error-box">
            <ShieldAlert size={18} />
            <span>Журнал недоступен: {attemptsError}</span>
          </div>
        ) : attempts.length === 0 ? (
          <p className="muted">
            Для этого документа ещё нет записей operator journal. В demo/local
            режиме это нормально.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Операция</th>
                  <th>Режим</th>
                  <th>Статус</th>
                  <th>Revision</th>
                  <th>Fingerprint</th>
                  <th>Код</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.created_at).toLocaleString('ru-RU')}</td>
                    <td>
                      {a.provider} · {a.operation}
                    </td>
                    <td>{a.mode}</td>
                    <td>
                      <b>{operatorAttemptStatusLabel(a.status)}</b>
                    </td>
                    <td>
                      <code>
                        {String(a.document_revision || '').slice(0, 19)}
                      </code>
                    </td>
                    <td>
                      <code>
                        {String(a.request_fingerprint || '').slice(0, 12)}…
                      </code>
                    </td>
                    <td>{a.safe_error_code || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="warning no-print">
        <ShieldAlert size={18} />
        <span>
          <b>Integration JSON</b> и <b>Kontur XML preview</b> — локальные
          технические представления. Кнопка <b>Kontur sandbox</b> появляется
          только когда backend явно включён в sandbox-режим и готов к реальному
          GenerateTitleXml; она передаёт backend только ID документа, а сам
          документ перечитывается через RLS. Для одинаковой revision backend
          вычисляет SHA-256 idempotency identity и схлопывает одновременные
          дубли.{' '}
          {persistentJournal
            ? 'Persistent journal включён: успешная попытка сохраняется как безопасные metadata и блокирует повторный внешний GenerateTitleXml той же revision после рестарта gateway.'
            : 'Persistent journal не настроен: после рестарта gateway завершённая попытка не будет известна процессу.'}{' '}
          Даже sandbox-результат не подписан, не отправлен через PostMessage и
          не является фактом регистрации ЭТрН в ГИС ЭПД.
        </span>
      </div>
      <PrintPreview doc={doc} />
    </>
  )
}
function PrintPreview({ doc }: { doc: DocumentRow }) {
  const d = normalizeEtrn(doc.data)
  const t = cargoTotals(d)
  const l = d.loadingDetails!
  return (
    <div className="print-sheet">
      <div className="watermark">
        ЧЕРНОВИК — НЕ ЯВЛЯЕТСЯ ПЕРЕВОЗОЧНЫМ ДОКУМЕНТОМ
      </div>
      <h1>Электронная транспортная накладная — ЧЕРНОВИК</h1>
      <div className="print-meta">
        <b>{doc.doc_number}</b>
        <span>{fmt(doc.doc_date)}</span>
      </div>
      {(d.terms.orderNumber || d.terms.orderDate) && (
        <p>
          <b>Заказ / заявка:</b> {d.terms.orderNumber || '—'} от{' '}
          {d.terms.orderDate ? fmt(d.terms.orderDate) : '—'}
        </p>
      )}
      <h3>Участники</h3>
      {[
        ['Грузоотправитель', d.shipper],
        ['Грузополучатель', d.consignee],
        ['Перевозчик', d.carrier],
      ].map(([n, p]: any) => (
        <div className="print-row" key={n}>
          <b>{n}</b>
          <span>
            {p.name || '—'} · ИНН {p.inn || '—'} · {p.address || '—'}
          </span>
        </div>
      ))}
      <h3>Маршрут и погрузка</h3>
      <p>
        {d.route.loadAddress || '—'} → {d.route.unloadAddress || '—'}
      </p>
      <p>
        План погрузки: {d.route.loadDate ? fmt(d.route.loadDate) : '—'}{' '}
        {d.route.loadTime || ''}; фактическое прибытие:{' '}
        {d.route.loadArrival || '—'}; убытие: {d.route.loadDeparture || '—'}
      </p>
      {(l.matchingShipper ||
        l.employeeFullName ||
        l.ownerType ||
        l.ownerInn) && (
        <>
          <p>
            <b>Лицо погрузки:</b> {l.employeeFullName || '—'}
            {l.employeePosition ? `, ${l.employeePosition}` : ''};
            MatchingShipper: {l.matchingShipper || '—'}; ИНН:{' '}
            {l.partyInn || (l.matchingShipper === '1' ? d.shipper.inn : '—')}
          </p>
          <p>
            <b>Владелец места погрузки:</b> Type {l.ownerType || '—'}; ИНН{' '}
            {l.ownerInn || '—'}
          </p>
        </>
      )}
      <h3>Груз</h3>
      <table>
        <thead>
          <tr>
            <th>Наименование</th>
            <th>Состояние</th>
            <th>Мест</th>
            <th>Масса, кг</th>
            <th>Упаковка / маркировка</th>
          </tr>
        </thead>
        <tbody>
          {d.cargo.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.state || '—'}</td>
              <td>{c.places}</td>
              <td>{c.weight}</td>
              <td>
                {c.packaging || '—'} / {c.marking || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <b>Итого:</b> {t.places} мест, {t.weight} кг
      </p>
      <h3>Транспорт и водитель</h3>
      <p>
        {d.transport.vehicleType || 'ТС'}: {d.transport.brand}{' '}
        {d.transport.model}, {d.transport.plate}; водитель:{' '}
        {d.transport.driverName}
      </p>
      <p>
        ВУ:{' '}
        {[d.transport.driverLicenseSeries, d.transport.driverLicenseNumber]
          .filter(Boolean)
          .join(' ') ||
          d.transport.driverLicense ||
          '—'}
        , дата выдачи:{' '}
        {d.transport.driverLicenseDate
          ? fmt(d.transport.driverLicenseDate)
          : '—'}
        ; путевой лист: {d.transport.waybillNumber || '—'} от{' '}
        {d.transport.waybillDate ? fmt(d.transport.waybillDate) : '—'}
      </p>
      {(d.signer?.fullName || d.signer?.position) && (
        <p>
          <b>Подписант черновика:</b> {d.signer?.fullName || '—'},{' '}
          {d.signer?.position || '—'}
        </p>
      )}
      <div className="print-disclaimer">
        Этот файл — печатное превью внутреннего черновика. Он не проверен по XSD
        ФНС, не подписан КЭП, не передан оператору ИС ЭПД и не является
        юридически значимым перевозочным документом.
      </div>
    </div>
  )
}
type DirectoryField<T> = {
  key: keyof T
  label: string
  hiddenInTable?: boolean
  options?: { value: string; label: string }[]
  inputType?: string
  placeholder?: string
}
function DirectoryPage<T extends { id: string }>({
  title,
  subtitle,
  items,
  fields,
  onSave,
  onDelete,
  newItem,
}: {
  title: string
  subtitle: string
  items: T[]
  fields: DirectoryField<T>[]
  onSave: (x: T) => Promise<void>
  onDelete: (id: string) => Promise<void>
  newItem: () => T
}) {
  const [edit, setEdit] = useState<T | null>(null)
  const [q, setQ] = useState('')
  const shown = items.filter((x) =>
    JSON.stringify(x).toLowerCase().includes(q.toLowerCase()),
  )
  const visible = fields.filter((f) => !f.hiddenInTable)
  const valueOf = (f: DirectoryField<T>) =>
    edit
      ? Array.isArray(edit[f.key])
        ? (edit[f.key] as any[]).join(', ')
        : String(edit[f.key] ?? '')
      : ''
  const setValue = (f: DirectoryField<T>, value: string) => {
    if (!edit) return
    setEdit({
      ...edit,
      [f.key]: Array.isArray(edit[f.key])
        ? value
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : value,
    })
  }
  return (
    <>
      <div className="page-title">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <Button onClick={() => setEdit(newItem())}>
          <Plus size={16} />
          Добавить
        </Button>
      </div>
      <Card>
        <div className="toolbar">
          <div className="search">
            <Search size={16} />
            <Input
              value={q}
              onChange={(e: any) => setQ(e.target.value)}
              placeholder="Поиск"
            />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {visible.map((f) => (
                  <th key={String(f.key)}>{f.label}</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td className="empty" colSpan={visible.length + 1}>
                    Пока пусто
                  </td>
                </tr>
              ) : (
                shown.map((x) => (
                  <tr key={x.id}>
                    {visible.map((f) => (
                      <td key={String(f.key)}>
                        {Array.isArray(x[f.key])
                          ? (x[f.key] as any[]).join(', ')
                          : String(x[f.key] ?? '')}
                      </td>
                    ))}
                    <td>
                      <div className="row-actions">
                        <button onClick={() => setEdit(x)}>Изменить</button>
                        <button
                          onClick={async () => {
                            if (confirm('Удалить запись?')) {
                              await onDelete(x.id)
                            }
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {edit && (
        <div className="modal">
          <Card className="modal-card directory-modal">
            <button className="modal-x" onClick={() => setEdit(null)}>
              <X />
            </button>
            <h3>{edit.id ? 'Редактирование' : 'Новая запись'}</h3>
            <div className="directory-form">
              {fields.map((f) => (
                <Field label={f.label} key={String(f.key)}>
                  {f.options ? (
                    <Select
                      value={valueOf(f)}
                      onChange={(e: any) => setValue(f, e.target.value)}
                    >
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      type={f.inputType || 'text'}
                      placeholder={f.placeholder || ''}
                      value={valueOf(f)}
                      onChange={(e: any) => setValue(f, e.target.value)}
                    />
                  )}
                </Field>
              ))}
            </div>
            <Button
              className="full"
              onClick={async () => {
                await onSave(edit)
                setEdit(null)
              }}
            >
              Сохранить
            </Button>
          </Card>
        </div>
      )}
    </>
  )
}

function ImportPage({
  reloadCompanies,
  onDocCreated,
}: {
  reloadCompanies: () => void
  onDocCreated: (d: DocumentRow) => void
}) {
  const [rows, setRows] = useState<any[]>([])
  const [cargoRows, setCargoRows] = useState<any[]>([])
  const [error, setError] = useState('')
  const positiveNumber = (value: any) =>
    Number(String(value ?? '').replace(',', '.')) > 0
  const readCsv = (
    file: File,
    required: string[],
    done: (x: any[]) => void,
  ) => {
    const r = new FileReader()
    r.onload = () => {
      const text = String(r.result || '').replace(/^\uFEFF/, '')
      const lines = text.split(/\r?\n/).filter((x) => x.trim())
      if (!lines.length) {
        setError('CSV-файл пуст')
        return
      }
      const headers = lines[0].split(';').map((x) => x.trim().toLowerCase())
      if (!required.every((x) => headers.includes(x))) {
        setError(`Нужны колонки: ${required.join(', ')}. Разделитель — ;`)
        return
      }
      setError('')
      done(
        lines.slice(1).map((line) => {
          const v = line.split(';')
          const o: any = {}
          headers.forEach((h, i) => (o[h] = v[i]?.trim() || ''))
          return o
        }),
      )
    }
    r.onerror = () => setError('Не удалось прочитать CSV-файл')
    r.readAsText(file, 'utf-8')
  }
  const sample = (kind: 'companies' | 'cargo') => {
    const content =
      kind === 'companies'
        ? 'name;inn;kpp;org_type;roles;address;phone;email;box_id;address_zip_code;address_region;address_city;address_settlement;address_street;address_building;address_corpus;address_apartment\nООО «Пример»;7700000000;770001001;org;грузоотправитель;Москва, Тестовая ул., 1;+79000000000;demo@example.test;11111111-1111-1111-1111-111111111111;109000;77;Москва;;Тестовая;1;;'
        : 'name;state;places;unit;weight;value;currency;packaging;packaging_method;packaging_code;marking;conditions\nДемонстрационный груз;Без нареканий;10;мест;500;;643;короб;Ручной;00;Отсутствует;'
    const blob = new Blob([content], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download =
      kind === 'companies' ? 'companies-example-t1.csv' : 'cargo-example-v2.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const commitCompanies = async () => {
    const invalid = rows
      .map((r, i) => {
        const orgType = String(r.org_type || 'org')
          .trim()
          .toLowerCase()
        const boxId = String(r.box_id || '').trim()
        return !String(r.name || '').trim() ||
          !validInn(String(r.inn || '')) ||
          !['org', 'ip'].includes(orgType) ||
          (boxId && !validGuid(boxId))
          ? i + 2
          : 0
      })
      .filter(Boolean)
    if (invalid.length) {
      setError(
        `Не импортировано: проверьте название, ИНН, org_type и box_id в строках ${invalid.slice(0, 10).join(', ')}${invalid.length > 10 ? '…' : ''}`,
      )
      return
    }
    setError('')
    for (const r of rows) {
      await saveCompany({
        id: uid(),
        org_type:
          String(r.org_type || 'org')
            .trim()
            .toLowerCase() === 'ip'
            ? 'ip'
            : 'org',
        name: r.name,
        inn: r.inn,
        kpp: r.kpp || '',
        roles: (r.roles || '')
          .split(',')
          .map((x: string) => x.trim())
          .filter(Boolean),
        address: r.address || '',
        phone: r.phone || '',
        email: r.email || '',
        edo_id: r.box_id || '',
        address_zip_code: r.address_zip_code || '',
        address_region: r.address_region || '',
        address_city: r.address_city || '',
        address_settlement: r.address_settlement || '',
        address_street: r.address_street || '',
        address_building: r.address_building || '',
        address_corpus: r.address_corpus || '',
        address_apartment: r.address_apartment || '',
      })
    }
    setRows([])
    await reloadCompanies()
  }
  const createCargoDoc = async () => {
    const invalid = cargoRows
      .map((r, i) =>
        !String(r.name || '').trim() ||
        !positiveNumber(r.places) ||
        !positiveNumber(r.weight)
          ? i + 2
          : 0,
      )
      .filter(Boolean)
    if (invalid.length) {
      setError(
        `Черновик не создан: проверьте название, количество мест и массу в строках ${invalid.slice(0, 10).join(', ')}${invalid.length > 10 ? '…' : ''}`,
      )
      return
    }
    setError('')
    const d = newDoc()
    d.data.cargo = cargoRows.map((r) => ({
      id: uid(),
      name: r.name,
      state: r.state || '',
      places: r.places || '',
      unit: r.unit || 'шт',
      weight: r.weight || '',
      value: r.value || '',
      currency: r.currency || '643',
      packaging: r.packaging || '',
      packagingMethod: r.packaging_method || '',
      packagingCode: r.packaging_code || '',
      marking: r.marking || '',
      conditions: r.conditions || '',
    }))
    d.status = 'incomplete'
    const saved = await saveDocument(d)
    onDocCreated(saved)
    setCargoRows([])
    go(`/app/documents/${saved.id}/edit`)
  }
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Импорт</h1>
          <p>Контрагенты и грузовые позиции из CSV. XLSX — в разработке.</p>
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="two-cards">
        <Card>
          <div className="card-head">
            <h3>Контрагенты</h3>
            <Button variant="ghost" onClick={() => sample('companies')}>
              <Download size={15} />
              Пример T1
            </Button>
          </div>
          <p className="muted">
            Обязательные колонки: <code>name</code>, <code>inn</code>. Для
            будущего Контур T1 можно сразу передать <code>org_type</code>,{' '}
            <code>box_id</code>, <code>address_region</code>,{' '}
            <code>address_city</code> и остальные <code>address_*</code>.
          </p>
          <input
            className="file-input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) =>
              e.target.files?.[0] &&
              readCsv(e.target.files[0], ['name', 'inn'], setRows)
            }
          />
          {rows.length > 0 && (
            <>
              <h3>Предпросмотр: {rows.length}</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>name</th>
                      <th>inn</th>
                      <th>org_type</th>
                      <th>box_id</th>
                      <th>region/city</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 15).map((r, i) => (
                      <tr key={i}>
                        <td>{r.name}</td>
                        <td>{r.inn}</td>
                        <td>{r.org_type || 'org'}</td>
                        <td>{r.box_id || '—'}</td>
                        <td>
                          {[
                            r.address_region,
                            r.address_city || r.address_settlement,
                          ]
                            .filter(Boolean)
                            .join(' / ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button onClick={commitCompanies}>
                Импортировать {rows.length}
              </Button>
            </>
          )}
        </Card>
        <Card>
          <div className="card-head">
            <h3>Грузовые позиции</h3>
            <Button variant="ghost" onClick={() => sample('cargo')}>
              <Download size={15} />
              Пример v2
            </Button>
          </div>
          <p className="muted">
            Обязательные: <code>name</code>, <code>places</code>,{' '}
            <code>weight</code>. Дополнительно поддерживаются <code>state</code>
            , <code>currency</code>, <code>packaging_method</code>,{' '}
            <code>packaging_code</code>, <code>marking</code>.
          </p>
          <input
            className="file-input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) =>
              e.target.files?.[0] &&
              readCsv(
                e.target.files[0],
                ['name', 'places', 'weight'],
                setCargoRows,
              )
            }
          />
          {cargoRows.length > 0 && (
            <>
              <h3>Предпросмотр: {cargoRows.length}</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>name</th>
                      <th>state</th>
                      <th>places</th>
                      <th>weight</th>
                      <th>marking</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cargoRows.slice(0, 15).map((r, i) => (
                      <tr key={i}>
                        <td>{r.name}</td>
                        <td>{r.state}</td>
                        <td>{r.places}</td>
                        <td>{r.weight}</td>
                        <td>{r.marking}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button onClick={createCargoDoc}>
                Создать черновик с грузом
              </Button>
            </>
          )}
        </Card>
      </div>
    </>
  )
}

function Integrations({ profile }: { profile: Profile }) {
  const [form, setForm] = useState({
    company_name: profile.company_name,
    inn: profile.inn,
    operator: 'Не выбрали',
    contact: profile.email || profile.phone,
  })
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [gateway, setGateway] = useState<any>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/operator/capabilities', {
      headers: { accept: 'application/json' },
    })
      .then(async (r) => {
        const ct = r.headers.get('content-type') || ''
        if (!r.ok || !ct.includes('application/json'))
          throw new Error('gateway unavailable')
        return r.json()
      })
      .then((x) => {
        if (alive) setGateway(x)
      })
      .catch(() => {
        if (alive) setGateway(false)
      })
    return () => {
      alive = false
    }
  }, [])
  const submit = async (e: any) => {
    e.preventDefault()
    setError('')
    if (!form.company_name.trim() || !form.contact.trim()) {
      setError('Укажите компанию и контакт для связи')
      return
    }
    if (form.inn && !validInn(form.inn)) {
      setError('ИНН должен содержать 10 или 12 цифр')
      return
    }
    await saveIntegrationRequest(form)
    setSent(true)
  }
  const adapter = gateway && gateway !== false ? gateway.providerAdapter : null
  const auth = gateway && gateway !== false ? gateway.auth : null
  const authorization =
    gateway && gateway !== false ? gateway.authorization : null
  const repository = authorization?.repository
  const sandbox =
    gateway && gateway !== false ? gateway.sandboxGenerateTitle : null
  const journal = sandbox?.persistentAttemptJournal
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Интеграции</h1>
          <p>
            Реальная отправка ЭПД подключается только через аккредитованного
            оператора.
          </p>
        </div>
      </div>
      <div className="three-grid">
        <Card>
          <h3>Оператор ИС ЭПД</h3>
          <Badge tone="warn">Не подключен</Badge>
          <p>
            Для пилота рассматриваем операторов с API-интеграцией.
            Контур.Логистика и Такском публично заявляют API для учётных систем.
          </p>
          <p className="small">
            <a
              href="https://kontur.ru/logistika/way-work"
              target="_blank"
              rel="noreferrer"
            >
              Контур: интеграция по API
            </a>{' '}
            ·{' '}
            <a href="https://taxcom.ru/epd/" target="_blank" rel="noreferrer">
              Такском: ЭПД и API
            </a>
          </p>
        </Card>
        <Card>
          <h3>1С</h3>
          <Badge>В разработке</Badge>
          <p>
            Импорт справочников и черновиков без хранения секретов оператора в
            1С-модуле.
          </p>
        </Card>
        <Card>
          <h3>Backend gateway</h3>
          {gateway === null ? (
            <Badge>Проверяем…</Badge>
          ) : gateway === false ? (
            <Badge tone="warn">Не обнаружен</Badge>
          ) : (
            <Badge tone="success">Gateway online</Badge>
          )}
          <p>
            {gateway && gateway !== false
              ? `Режим: ${gateway.mode}; provider: ${gateway.provider}. Внешняя отправка: ${gateway.externalSendEnabled ? 'включена' : 'заблокирована'}.`
              : 'В статическом/демо-развёртывании gateway может отсутствовать. В Docker Compose он доступен через тот же /api origin.'}
          </p>
          {gateway && gateway !== false && (
            <div className="integration-tech">
              <p className="small">
                <b>Auth:</b>{' '}
                {auth?.mode === 'supabase'
                  ? 'Supabase JWT/JWKS'
                  : 'локальный demo mode'}
                ; защита operator API —{' '}
                {auth?.requiredForOperatorApi
                  ? 'обязательна'
                  : 'отключена только для demo'}
                ; лимит — {gateway.rateLimit?.maxPerAuthenticatedSubject ?? '—'}{' '}
                запросов /{' '}
                {Math.round((gateway.rateLimit?.windowMs ?? 0) / 1000) || '—'}{' '}
                сек.
              </p>
              <p className="small">
                <b>Authorization:</b> server-loaded document —{' '}
                {authorization?.serverLoadedDocumentRequired
                  ? 'обязателен'
                  : 'нет'}
                ; проверка владельца —{' '}
                {authorization?.ownershipMatchRequired ? 'обязательна' : 'нет'};
                RLS repository adapter —{' '}
                {authorization?.backendDocumentRepositoryAdapterReady
                  ? 'готов'
                  : 'нет'}
                ; runtime-конфигурация —{' '}
                {repository?.configured ? 'готова' : 'не настроена'}.
              </p>
              <p className="small">
                <b>Sandbox:</b> {sandbox?.enabled ? 'включён' : 'выключен'};
                GenerateTitle ready — {sandbox?.ready ? 'да' : 'нет'};
                persistent journal —{' '}
                {journal?.configured ? 'включён' : 'не настроен'}.
              </p>
              <p className="tiny muted">
                Для внешнего GenerateTitle backend перечитывает документ через
                Supabase Data API с пользовательским JWT; политика RLS
                `auth.uid() = user_id` остаётся авторитетной. Persistent
                journal, если включён, использует отдельный restricted
                PostgreSQL login и хранит только безопасные metadata попытки,
                без XML/ФИО/токенов.
              </p>
            </div>
          )}
          {adapter?.provider === 'kontur' && (
            <div className="integration-tech">
              <p className="small">
                <b>Контур adapter:</b> UserDataXml preview —{' '}
                {adapter.userDataPreviewWiredToGateway ? 'готов' : 'нет'};
                GenerateTitle boundary —{' '}
                {adapter.generateTitleBoundaryReady ? 'готов' : 'нет'};
                production GenerateTitle/send route —{' '}
                {adapter.generateTitleWiredToGateway ? 'включён' : 'закрыт'};
                PostMessage —{' '}
                {adapter.postMessageImplemented
                  ? 'реализован'
                  : 'не реализован'}
                .
              </p>
              <p className="tiny muted">
                Sandbox GenerateTitleXml — отдельный ограниченный route; даже
                при серверных реквизитах он не подписывает и не отправляет
                документ.
              </p>
            </div>
          )}
          <p className="tiny muted">
            API-ключи, access token, сервисные токены и материалы КЭП не должны
            попадать в application logs. Пользовательский access token
            используется как Authorization Bearer для JWT-проверки и RLS-чтения
            своего документа.
          </p>
        </Card>
      </div>
      <div className="warning top-gap">
        <ShieldAlert size={18} />
        <span>
          Статусы «Передан оператору», «Подписан» и «Принят ГИС ЭПД» недоступны
          до реального подключения и подтверждения ответа оператора.
        </span>
      </div>
      <Card className="top-gap">
        <h3>Оставить заявку на подключение оператора</h3>
        {sent ? (
          <div className="success-box">
            <Check />
            Заявка сохранена. Мы не считаем документ подключённым или
            отправленным только по факту этой заявки.
          </div>
        ) : (
          <form onSubmit={submit} className="form-grid">
            <Field label="Компания">
              <Input
                required
                value={form.company_name}
                onChange={(e: any) =>
                  setForm({ ...form, company_name: e.target.value })
                }
              />
            </Field>
            <Field label="ИНН">
              <Input
                inputMode="numeric"
                value={form.inn}
                onChange={(e: any) =>
                  setForm({ ...form, inn: e.target.value.replace(/\D/g, '') })
                }
              />
            </Field>
            <Field label="Какой оператор">
              <Select
                value={form.operator}
                onChange={(e: any) =>
                  setForm({ ...form, operator: e.target.value })
                }
              >
                <option>Не выбрали</option>
                <option>Контур</option>
                <option>Такском</option>
                <option>СБИС / Тензор</option>
                <option>Другой</option>
              </Select>
            </Field>
            <Field label="Контакт">
              <Input
                required
                value={form.contact}
                onChange={(e: any) =>
                  setForm({ ...form, contact: e.target.value })
                }
              />
            </Field>
            {error && <div className="error-box">{error}</div>}
            <div>
              <Button type="submit">Отправить заявку</Button>
            </div>
          </form>
        )}
      </Card>
    </>
  )
}

function BillingPage() {
  const [state, setState] = useState<BillingState | null>(null)
  const [error, setError] = useState('')
  const [paymentEvents, setPaymentEvents] = useState<any[]>([])
  const [paymentEventsError, setPaymentEventsError] = useState('')
  const [billingCaps, setBillingCaps] = useState<any>(null)
  useEffect(() => {
    let alive = true
    getBillingState()
      .then((x) => {
        if (alive) setState(x)
      })
      .catch((e) => {
        if (alive)
          setError(
            e instanceof Error ? e.message : 'Не удалось загрузить биллинг',
          )
      })
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    let alive = true
    listBillingPaymentEvents(20)
      .then((x) => {
        if (alive) setPaymentEvents(x)
      })
      .catch((e) => {
        if (alive)
          setPaymentEventsError(
            e instanceof Error
              ? e.message
              : 'Не удалось загрузить историю платежей',
          )
      })
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    let alive = true
    fetch('/api/billing/capabilities', {
      headers: { accept: 'application/json' },
    })
      .then(async (r) => {
        const ct = r.headers.get('content-type') || ''
        if (!r.ok || !ct.includes('application/json'))
          throw new Error('billing gateway unavailable')
        return r.json()
      })
      .then((x) => {
        if (alive) setBillingCaps(x)
      })
      .catch(() => {
        if (alive) setBillingCaps(false)
      })
    return () => {
      alive = false
    }
  }, [])
  if (error)
    return (
      <>
        <div className="page-title">
          <div>
            <h1>Тариф и лимиты</h1>
            <p>Состояние подписки и использования.</p>
          </div>
        </div>
        <div className="error-box">
          <ShieldAlert size={18} />
          <span>
            Биллинг-данные пока недоступны: {error}. Проверьте, что миграция
            billing foundation применена.
          </span>
        </div>
      </>
    )
  if (!state)
    return (
      <div className="loading">
        <RefreshCw className="spin" />
        Загрузка тарифа…
      </div>
    )
  const plan = state.currentPlan
  const used = Number(state.usage?.documents_created || 0)
  const remaining = billingRemainingDocuments(state)
  const trialEnd = state.subscription?.trial_ends_at
    ? fmt(state.subscription.trial_ends_at)
    : '—'
  const money = (kopecks: number | null, currency: string) =>
    kopecks == null
      ? '—'
      : `${(kopecks / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'RUB' ? '₽' : currency}`
  const paymentsClosed =
    billingCaps &&
    billingCaps !== false &&
    billingCaps.provider === 'none' &&
    billingCaps.checkoutEnabled === false &&
    billingCaps.webhookEnabled === false &&
    billingCaps.realMoneyEnabled === false
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Тариф и лимиты</h1>
          <p>
            Entitlement хранится в БД. Пользователь может только читать своё
            состояние — менять план напрямую из браузера нельзя.
          </p>
        </div>
        <Badge tone={state.enforcementEnabled ? 'success' : 'warn'}>
          {state.enforcementEnabled
            ? 'Лимиты активны'
            : 'Лимиты пока не блокируют'}
        </Badge>
      </div>
      <div className="three-grid">
        <Card>
          <h3>Текущий доступ</h3>
          <div className="price">{plan?.name || '—'}</div>
          <p>
            <b>{billingStatusLabel(state)}</b>
          </p>
          {state.subscription?.status === 'trialing' && (
            <p className="muted">Пробный период до {trialEnd}</p>
          )}
          <p className="tiny muted">
            Платёжный провайдер в entitlement:{' '}
            {state.subscription?.payment_provider || 'не подключён'}.
          </p>
        </Card>
        <Card>
          <h3>Документы в этом месяце</h3>
          <div className="price">
            {used}
            {plan?.document_limit != null ? ` / ${plan.document_limit}` : ''}
          </div>
          <p>
            {remaining == null
              ? 'Без указанного лимита'
              : `Осталось: ${remaining}`}
          </p>
          <p className="tiny muted">
            Удаление документа не возвращает использованную квоту. Счётчик
            увеличивает сама БД только при создании новой записи.
          </p>
        </Card>
        <Card>
          <h3>Платёжный backend</h3>
          {billingCaps === null ? (
            <Badge>Проверяем…</Badge>
          ) : billingCaps === false ? (
            <Badge tone="warn">Gateway не обнаружен</Badge>
          ) : paymentsClosed ? (
            <Badge tone="warn">Оплата выключена</Badge>
          ) : (
            <Badge tone="danger">Требует проверки</Badge>
          )}
          <p>
            {billingCaps && billingCaps !== false
              ? `Provider: ${billingCaps.provider}; checkout: ${billingCaps.checkoutEnabled ? 'включён' : 'выключен'}; webhook: ${billingCaps.webhookEnabled ? 'включён' : 'выключен'}; реальные деньги: ${billingCaps.realMoneyEnabled ? 'да' : 'нет'}.`
              : 'Статус backend недоступен. В local/static demo это допустимо.'}
          </p>
          {billingCaps && billingCaps !== false && (
            <p className="tiny muted">
              Прямая активация подписки runtime-ролью:{' '}
              {billingCaps.directRuntimeSubscriptionUpdateAllowed
                ? 'разрешена'
                : 'запрещена'}
              ; DB verified-event function:{' '}
              {billingCaps.entitlementDatabaseFunctionRequired
                ? 'обязательна'
                : 'не требуется'}
              .
            </p>
          )}
        </Card>
      </div>
      <h2 className="top-gap">Доступные тарифы</h2>
      <div className="three-grid pricing">
        {state.plans
          .filter((x) => x.code !== 'trial')
          .map((p) => (
            <Card
              key={p.code}
              className={p.code === plan?.code ? 'featured' : ''}
            >
              <h3>{p.name}</h3>
              <div className="price">
                {p.monthly_price_rub.toLocaleString('ru-RU')} ₽{' '}
                <span>/ мес</span>
              </div>
              <p>
                До {p.document_limit?.toLocaleString('ru-RU') || '—'} новых
                черновиков в месяц.
              </p>
              {p.code === plan?.code ? (
                <Badge tone="success">Текущий</Badge>
              ) : (
                <Badge>Оплата скоро</Badge>
              )}
            </Card>
          ))}
      </div>
      <Card className="top-gap">
        <div className="card-head">
          <div>
            <h3>История платежных событий</h3>
            <p className="muted small">
              Только безопасные metadata событий, принадлежащих вашему аккаунту.
            </p>
          </div>
          <Badge>{paymentEvents.length}</Badge>
        </div>
        {paymentEventsError ? (
          <div className="error-box">
            <ShieldAlert size={18} />
            <span>
              История пока недоступна: {paymentEventsError}. Если billing
              payment migration ещё не применена, это ожидаемо.
            </span>
          </div>
        ) : paymentEvents.length === 0 ? (
          <p className="muted">
            Платёжных событий пока нет. Это нормально: реальный платёжный
            провайдер ещё не подключён.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Провайдер</th>
                  <th>Событие</th>
                  <th>Тариф</th>
                  <th>Сумма</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {paymentEvents.map((event: any, i: number) => (
                  <tr key={`${event.created_at}-${i}`}>
                    <td>
                      {new Date(event.created_at).toLocaleString('ru-RU')}
                    </td>
                    <td>{event.provider}</td>
                    <td>
                      <code>{event.event_type}</code>
                    </td>
                    <td>{event.plan_code || '—'}</td>
                    <td>{money(event.amount_kopecks, event.currency)}</td>
                    <td>
                      <Badge
                        tone={
                          event.event_status === 'applied'
                            ? 'success'
                            : event.event_status === 'failed'
                              ? 'danger'
                              : event.event_status === 'verified'
                                ? 'info'
                                : 'neutral'
                        }
                      >
                        {billingPaymentEventStatusLabel(event.event_status)}
                      </Badge>
                      {event.safe_error_code && (
                        <div className="tiny muted">
                          <code>{event.safe_error_code}</code>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="tiny muted top-gap">
          Browser получает только provider/type/status/plan/amount/currency/time
          и безопасный error code. Provider event ID, payload SHA-256, raw
          webhook, данные карты и секреты в этот UI не запрашиваются.
        </p>
      </Card>
      <div className="warning top-gap">
        <ShieldAlert size={18} />
        <span>
          <b>Деньги сейчас не списываются.</b> Таблицы подписок, trial, usage и
          server-owned payment-event ledger уже подготовлены, но provider
          adapter, verified webhook, checkout и чеки ещё не подключены. Success
          redirect никогда не считается доказательством оплаты; entitlement
          сможет активироваться только из проверенного server-to-server события.
          Поэтому enforcement по умолчанию выключен.
        </span>
      </div>
    </>
  )
}

function PrivacyPage() {
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setRequests(await listAccountDeletionRequests())
    } catch (e: any) {
      setError(
        e?.message ||
          'Не удалось загрузить заявки. Возможно, privacy migration ещё не применена.',
      )
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  const exportData = async () => {
    setExporting(true)
    setError('')
    setNotice('')
    try {
      const payload = await buildAccountDataExport()
      downloadAccountDataExport(payload)
      setNotice(
        'JSON-экспорт сформирован в браузере. Храните файл как конфиденциальный: в нём могут быть ФИО, телефоны, реквизиты ВУ и данные черновиков.',
      )
    } catch (e: any) {
      setError(e?.message || 'Не удалось сформировать экспорт')
    } finally {
      setExporting(false)
    }
  }
  const requestDeletion = async () => {
    const ok = window.confirm(
      'Создать заявку на удаление аккаунта? Это НЕ удалит данные мгновенно. Заявка попадёт в server-controlled процесс, где сначала должны быть учтены применимые сроки хранения и обязательства.',
    )
    if (!ok) return
    setRequesting(true)
    setError('')
    setNotice('')
    try {
      const req = await requestAccountDeletion()
      setNotice(
        `Заявка создана: ${deletionRequestStatusLabel(req.status)}. Автоматического удаления сейчас нет.`,
      )
      await load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось создать заявку')
    } finally {
      setRequesting(false)
    }
  }
  const active = requests.find(
    (x: any) => x.status === 'pending' || x.status === 'in_review',
  )
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Данные и удаление</h1>
          <p>
            Экспорт данных текущего аккаунта и безопасная заявка на удаление без
            мгновенного разрушительного действия.
          </p>
        </div>
        <Badge tone={cloudEnabled ? 'success' : 'warn'}>
          {cloudEnabled ? 'Cloud / RLS' : 'Demo / localStorage'}
        </Badge>
      </div>
      {error && (
        <div className="error-box">
          <ShieldAlert size={18} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="success-box">
          <Check size={18} />
          <span>{notice}</span>
        </div>
      )}
      <div className="two-grid top-gap">
        <Card>
          <h3>Экспорт моих данных</h3>
          <p>
            Собирает данные, доступные текущему аккаунту через его обычные
            RLS-права: профиль, справочники, черновики, заявки интеграции,
            billing metadata и безопасный operator journal.
          </p>
          <p className="tiny muted">
            Экспорт намеренно не содержит access token, refresh token, server
            secrets, DB credentials или скрытые payment payload hashes. Это
            пользовательский self-service export, а не формальный юридический
            ответ на запрос субъекта ПД.
          </p>
          <Button onClick={exportData} disabled={exporting}>
            <Download size={16} />
            {exporting ? 'Формируем…' : 'Скачать JSON'}
          </Button>
        </Card>
        <Card>
          <h3>Удаление аккаунта</h3>
          {active ? (
            <>
              <Badge tone="warn">
                {deletionRequestStatusLabel(active.status)}
              </Badge>
              <p>
                Активная заявка создана{' '}
                {new Date(active.requested_at).toLocaleString('ru-RU')}.
              </p>
              <p className="tiny muted">
                Повторная заявка не создаётся, пока текущая находится в статусе
                pending/in_review.
              </p>
            </>
          ) : (
            <>
              <p>
                Можно создать заявку на удаление аккаунта и связанных данных.
              </p>
              <Button
                variant="danger"
                onClick={requestDeletion}
                disabled={requesting}
              >
                <Trash2 size={16} />
                {requesting ? 'Создаём…' : 'Создать заявку на удаление'}
              </Button>
            </>
          )}
          <div className="warning top-gap">
            <ShieldAlert size={18} />
            <span>
              <b>Это не мгновенное удаление.</b> Реальное удаление остаётся
              server-controlled и должно учитывать применимые сроки хранения,
              документы и обязательства. Browser не получает права удалять auth
              user или server-owned журналы.
            </span>
          </div>
        </Card>
      </div>
      <Card className="top-gap">
        <div className="card-head">
          <div>
            <h3>История заявок</h3>
            <p className="muted small">
              Пользователь может только создать и читать свои заявки. Изменять
              статус или отмечать заявку выполненной из браузера нельзя.
            </p>
          </div>
          <Badge>{requests.length}</Badge>
        </div>
        {loading ? (
          <p className="muted">
            <RefreshCw className="spin" size={16} /> Загрузка…
          </p>
        ) : requests.length === 0 ? (
          <p className="muted">Заявок пока нет.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Статус</th>
                  <th>Завершено</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r: any) => (
                  <tr key={r.id}>
                    <td>{new Date(r.requested_at).toLocaleString('ru-RU')}</td>
                    <td>
                      <Badge
                        tone={
                          r.status === 'completed'
                            ? 'success'
                            : r.status === 'rejected'
                              ? 'danger'
                              : 'warn'
                        }
                      >
                        {deletionRequestStatusLabel(r.status)}
                      </Badge>
                    </td>
                    <td>
                      {r.resolved_at
                        ? new Date(r.resolved_at).toLocaleString('ru-RU')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

function Onboarding({
  profile,
  onDone,
}: {
  profile: Profile
  onDone: (p: Profile) => void
}) {
  const [p, setP] = useState(profile)
  const [err, setErr] = useState('')
  const save = async () => {
    if (!p.company_name.trim()) {
      setErr('Укажите название компании')
      return
    }
    if (!validInn(p.inn)) {
      setErr('ИНН должен содержать 10 или 12 цифр')
      return
    }
    const n = { ...p, onboarded: true }
    await saveProfile(n)
    onDone(n)
    go('/app')
  }
  return (
    <div className="onboarding">
      <Card>
        <h1>Настроим компанию</h1>
        <p className="muted">
          Эти данные будут доступны для подстановки в черновики.
        </p>
        <div className="form-grid">
          <Field label="Тип">
            <Select
              value={p.org_type}
              onChange={(e: any) => setP({ ...p, org_type: e.target.value })}
            >
              <option value="org">Организация</option>
              <option value="ip">ИП</option>
            </Select>
          </Field>
          <Field label="Название">
            <Input
              value={p.company_name}
              onChange={(e: any) =>
                setP({ ...p, company_name: e.target.value })
              }
            />
          </Field>
          <Field label="ИНН">
            <Input
              value={p.inn}
              onChange={(e: any) =>
                setP({ ...p, inn: e.target.value.replace(/\D/g, '') })
              }
            />
          </Field>
          <Field label="КПП">
            <Input
              value={p.kpp}
              onChange={(e: any) => setP({ ...p, kpp: e.target.value })}
            />
          </Field>
          <Field label="Телефон">
            <Input
              value={p.phone}
              onChange={(e: any) => setP({ ...p, phone: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <Input
              value={p.email}
              onChange={(e: any) => setP({ ...p, email: e.target.value })}
            />
          </Field>
        </div>
        {err && <div className="error-box">{err}</div>}
        <Button onClick={save}>Сохранить и продолжить</Button>
      </Card>
    </div>
  )
}

export default function App() {
  const [path, setPath] = useState(route())
  const [email, setEmail] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [profile, setProfileState] = useState<Profile>({
    company_name: '',
    inn: '',
    kpp: '',
    org_type: 'org',
    phone: '',
    email: '',
    onboarded: false,
  })
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [toast, setToast] = useState('')
  const flash = (x: string) => {
    setToast(x)
    setTimeout(() => setToast(''), 2200)
  }
  const load = async () => {
    try {
      const e = await getSessionEmail()
      setEmail(e)
      if (e) {
        if (!cloudEnabled) seedDemo()
        const [p, d, c, v, r] = await Promise.all([
          getProfile(),
          listDocuments(),
          listCompanies(),
          listVehicles(),
          listDrivers(),
        ])
        setProfileState({ ...p, email: p.email || e })
        setDocs(d)
        setCompanies(c)
        setVehicles(v)
        setDrivers(r)
      }
    } finally {
      setReady(true)
    }
  }
  useEffect(() => {
    const h = () => setPath(route())
    addEventListener('popstate', h)
    load()
    const unsub = subscribeAuth(load)
    return () => {
      removeEventListener('popstate', h)
      unsub()
    }
  }, [])
  const reloadDocs = async () => setDocs(await listDocuments())
  const reloadCompanies = async () => setCompanies(await listCompanies())
  const reloadVehicles = async () => setVehicles(await listVehicles())
  const reloadDrivers = async () => setDrivers(await listDrivers())
  if (!ready)
    return (
      <div className="loading">
        <RefreshCw className="spin" />
        Загрузка…
      </div>
    )
  const pathname = path.split('?')[0]
  if (pathname === '/') return <HomePage />
  if (pathname === '/pricing') return <Pricing />
  if (pathname === '/legal') return <Legal />
  if (pathname === '/auth') return <Auth onAuthed={load} />
  if (pathname.startsWith('/app')) {
    if (!email) {
      go('/auth')
      return null
    }
    const logout = async () => {
      await signOut()
      setEmail(null)
      go('/')
    }
    if (!profile.onboarded && cloudEnabled && pathname !== '/app/onboarding')
      return (
        <AppShell email={email} onSignout={logout}>
          <Onboarding profile={profile} onDone={setProfileState} />
        </AppShell>
      )
    let content: any
    if (pathname === '/app' || pathname === '/app/')
      content = <Dashboard docs={docs} />
    else if (pathname === '/app/documents')
      content = <Documents docs={docs} reload={reloadDocs} />
    else if (pathname === '/app/documents/new') {
      content = (
        <NewDocumentPage
          onCreated={(x) =>
            setDocs((a) => [x, ...a.filter((z) => z.id !== x.id)])
          }
        />
      )
    } else if (pathname.startsWith('/app/documents/')) {
      const parts = pathname.split('/')
      const id = parts[3]
      const edit = parts[4] === 'edit'
      const d = docs.find((x) => x.id === id)
      content = d ? (
        edit ? (
          <Wizard
            doc={d}
            companies={companies}
            vehicles={vehicles}
            drivers={drivers}
            onSaved={(x) =>
              setDocs((a) => a.map((z) => (z.id === x.id ? x : z)))
            }
            onDirectoriesChanged={async () => {
              await Promise.all([
                reloadCompanies(),
                reloadVehicles(),
                reloadDrivers(),
              ])
            }}
          />
        ) : (
          <DocumentView doc={d} reload={reloadDocs} />
        )
      ) : (
        <Card>
          <h2>Документ не найден</h2>
        </Card>
      )
    } else if (pathname === '/app/companies')
      content = (
        <DirectoryPage
          title="Контрагенты"
          subtitle="Организации и ИП с реквизитами для повторного заполнения ЭТрН."
          items={companies}
          fields={[
            {
              key: 'org_type',
              label: 'Тип',
              options: [
                { value: 'org', label: 'Организация' },
                { value: 'ip', label: 'ИП' },
              ],
            },
            { key: 'name', label: 'Название' },
            { key: 'inn', label: 'ИНН' },
            { key: 'kpp', label: 'КПП' },
            { key: 'roles', label: 'Роли/теги' },
            { key: 'address', label: 'Адрес' },
            { key: 'phone', label: 'Телефон' },
            { key: 'email', label: 'Email', hiddenInTable: true },
            {
              key: 'edo_id',
              label: 'BoxId / ID участника ЭДО',
              hiddenInTable: true,
              placeholder: 'UUID/GUID из Диадока',
            },
            {
              key: 'address_zip_code',
              label: 'Адрес: индекс',
              hiddenInTable: true,
            },
            {
              key: 'address_region',
              label: 'Адрес: код региона',
              hiddenInTable: true,
              placeholder: 'Например 77',
            },
            { key: 'address_city', label: 'Адрес: город', hiddenInTable: true },
            {
              key: 'address_settlement',
              label: 'Адрес: населённый пункт',
              hiddenInTable: true,
            },
            {
              key: 'address_street',
              label: 'Адрес: улица',
              hiddenInTable: true,
            },
            {
              key: 'address_building',
              label: 'Адрес: дом',
              hiddenInTable: true,
            },
            {
              key: 'address_corpus',
              label: 'Адрес: корпус / строение',
              hiddenInTable: true,
            },
            {
              key: 'address_apartment',
              label: 'Адрес: квартира / офис',
              hiddenInTable: true,
            },
          ]}
          newItem={(): Company => ({
            id: uid(),
            org_type: 'org',
            name: '',
            inn: '',
            kpp: '',
            roles: [],
            address: '',
            phone: '',
            email: '',
            edo_id: '',
            address_zip_code: '',
            address_region: '',
            address_city: '',
            address_settlement: '',
            address_street: '',
            address_building: '',
            address_corpus: '',
            address_apartment: '',
          })}
          onSave={async (x) => {
            await saveCompany(x)
            await reloadCompanies()
            flash('Контрагент сохранён')
          }}
          onDelete={async (id) => {
            await deleteCompany(id)
            await reloadCompanies()
          }}
        />
      )
    else if (pathname === '/app/vehicles')
      content = (
        <DirectoryPage
          title="Транспорт"
          subtitle="Автомобили и параметры-кандидаты для операторского T1 mapping."
          items={vehicles}
          fields={[
            { key: 'brand', label: 'Марка' },
            { key: 'model', label: 'Модель' },
            { key: 'plate', label: 'Госномер' },
            { key: 'vehicle_type', label: 'Тип' },
            { key: 'trailer_plate', label: 'Прицеп' },
            {
              key: 'ownership_type',
              label: 'Код Ownership',
              hiddenInTable: true,
              placeholder: 'Сверить с UserDataXsd',
            },
            {
              key: 'load_capacity',
              label: 'Грузоподъёмность / MaxWeight',
              hiddenInTable: true,
            },
            {
              key: 'volume_capacity',
              label: 'Вместимость / Capacity',
              hiddenInTable: true,
            },
          ]}
          newItem={() => ({
            id: uid(),
            brand: '',
            model: '',
            plate: '',
            vehicle_type: '',
            trailer_plate: '',
            ownership_type: '',
            load_capacity: '',
            volume_capacity: '',
          })}
          onSave={async (x) => {
            await saveVehicle(x)
            await reloadVehicles()
            flash('Транспорт сохранён')
          }}
          onDelete={async (id) => {
            await deleteVehicle(id)
            await reloadVehicles()
          }}
        />
      )
    else if (pathname === '/app/drivers')
      content = (
        <DirectoryPage
          title="Водители"
          subtitle="Водители с раздельными реквизитами водительского удостоверения."
          items={drivers}
          fields={[
            { key: 'full_name', label: 'ФИО' },
            { key: 'phone', label: 'Телефон' },
            { key: 'license', label: 'ВУ (совместимость)' },
            { key: 'license_series', label: 'Серия ВУ', hiddenInTable: true },
            { key: 'license_number', label: 'Номер ВУ', hiddenInTable: true },
            {
              key: 'license_date',
              label: 'Дата выдачи ВУ',
              hiddenInTable: true,
              inputType: 'date',
            },
          ]}
          newItem={() => ({
            id: uid(),
            full_name: '',
            phone: '',
            license: '',
            license_series: '',
            license_number: '',
            license_date: '',
          })}
          onSave={async (x) => {
            const normalized = {
              ...x,
              license:
                [x.license_series, x.license_number]
                  .filter(Boolean)
                  .join(' ') || x.license,
            }
            await saveDriver(normalized)
            await reloadDrivers()
            flash('Водитель сохранён')
          }}
          onDelete={async (id) => {
            await deleteDriver(id)
            await reloadDrivers()
          }}
        />
      )
    else if (pathname === '/app/import')
      content = (
        <ImportPage
          reloadCompanies={reloadCompanies}
          onDocCreated={(x) =>
            setDocs((a) => [x, ...a.filter((z) => z.id !== x.id)])
          }
        />
      )
    else if (pathname === '/app/integrations')
      content = <Integrations profile={profile} />
    else if (pathname === '/app/billing') content = <BillingPage />
    else if (pathname === '/app/privacy') content = <PrivacyPage />
    else if (pathname === '/app/onboarding')
      content = <Onboarding profile={profile} onDone={setProfileState} />
    else
      content = (
        <Card>
          <h2>Страница не найдена</h2>
        </Card>
      )
    return (
      <AppShell email={email} onSignout={logout}>
        {content}
        <Toast text={toast} />
      </AppShell>
    )
  }
  return (
    <PublicShell>
      <section className="section">
        <div className="container center">
          <h1>404</h1>
          <p>Страница не найдена.</p>
          <Button onClick={() => go('/')}>На главную</Button>
        </div>
      </section>
    </PublicShell>
  )
}
