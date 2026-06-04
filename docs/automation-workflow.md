# Automation Workflow — Прозора Робота

Загальний опис автоматизованих процесів в проекті.

---

## Імпорт вакансій

### Bulk import vacancy URLs

```bash
npm run import:vacancy-urls -- --file=data/vacancy-urls-import.csv --dry-run
npm run import:vacancy-urls -- --file=data/vacancy-urls-import.csv
```

Importer читає CSV або TXT зі списком URL вакансій і записує дані
виключно в `company_open_facts`. Дані з Work.ua / Robota.ua, створені
через importer, не публікуються автоматично: нові записи зберігаються як
`status=needs_verification` і `is_public=false`.

Публікація можлива тільки після перевірки в адмінці. Це важливо, бо факти з
вакансій є заявленими умовами роботодавця, а не підтвердженим досвідом
працівників.

Формат CSV:
```
url,company_slug,company_name,source_name,note
```

---

## Як зібрати реальні URL вакансій без обходу захисту

### Чому Claude не повинен вигадувати vacancy IDs

Вакансії на Work.ua та Robota.ua мають числові ідентифікатори:
- `https://www.work.ua/jobs/8140419/`
- `https://robota.ua/company941895/vacancy9375874`

Claude не знає, які з цих ID актуальні на сьогодні. Будь-яка спроба
"вспомнити" або підібрати числові ID — це вигадані посилання.
Вигадані URL порушують вимоги до якості даних і призводять до 404
під час імпорту.

**Правило:** Claude не генерує vacancy ID. Лише справжні, вручну зібрані URL.

### Чому server-side fetch не підходить

Search pages Work.ua та Robota.ua часто повертають bot-detection error
при автоматичних запитах. Навіть якщо одна сторінка відповідає,
масове отримання 100+ URL через fetch — ненадійне, крихке і порушує
умови використання сайтів.

### Правильний безпечний спосіб: ручний збір з браузера

Найнадійніший підхід, що не порушує захист:

1. Людина відкриває Work.ua / Robota.ua у звичайному браузері.
2. Запускає browser console snippet (без fetch, без переходів).
3. Snippet читає посилання, вже видимі у DOM.
4. Отриманий CSV передається в importer.

**Переваги:**
- Завжди реальні, актуальні URL.
- Не порушується anti-bot захист.
- Не потребує Playwright, Puppeteer або browser automation.
- Повторюється в будь-який момент для отримання свіжих даних.

### Де знайти інструкції та snippets

→ Повна інструкція: [`docs/vacancy-url-collection.md`](./vacancy-url-collection.md)

→ Admin helper (UI у браузері): `http://localhost:3000/admin/vacancy-url-tools`

### Схема процесу

```
Браузер (людина)
    │
    ├─ Work.ua / Robota.ua search або company page
    │
    ├─ Прокрутити сторінку → підвантажити всі картки
    │
    ├─ F12 → Console → вставити snippet
    │          (тільки читає DOM, без fetch)
    │
    ├─ Скопіювати CSV з консолі
    │   або вставити HTML в /admin/vacancy-url-tools
    │
    └─ Зберегти в data/vacancy-urls-import.csv
           │
           ▼
    npm run import:vacancy-urls -- --file=... --dry-run
           │
           ▼
    npm run import:vacancy-urls -- --file=...
           │
           ▼
    company_open_facts (needs_verification / is_public=false)
```

### Важливо

| ✅ Дозволено | ❌ Заборонено |
|---|---|
| Ручне відкриття сторінки в браузері | Обхід captcha або anti-bot |
| Browser console snippet (читає DOM) | Playwright / Puppeteer / automation |
| Вставка HTML у /admin/vacancy-url-tools | Server-side fetch сторінок сайтів |
| Реальні URL з відкритих публічних сторінок | Вигадані / згенеровані vacancy IDs |
| Пагінація вручну (page 2, page 3...) | AI-генерація числових ID вакансій |

---

## Структура файлів

```
data/
  vacancy-urls-import.csv    ← ваш файл для імпорту

docs/
  vacancy-url-collection.md  ← browser snippets + інструкція
  automation-workflow.md     ← цей файл

scripts/
  bulk-import-vacancy-urls.ts  ← importer

app/admin/vacancy-url-tools/
  page.tsx                   ← UI helper для витягування URL з HTML
```
