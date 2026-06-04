# Automation workflow: Прозора робота

Цей workflow наповнює Прозора робота як бібліотеку інформації про роботодавців і вакансії без змішування джерел.

## Джерела даних

1. `public.reviews`

Відгуки користувачів Прозора робота. Тільки вони впливають на внутрішній рейтинг і кількість відгуків.

2. `external_ratings`

Числові оцінки з відкритих джерел: Google, Work.ua, Robota.ua, DOU, Djinni тощо. Вони не впливають на рейтинг Прозора робота.

3. `external_review_signals`

Короткі admin-verified узагальнення того, що пишуть у відкритих джерелах. Це не дослівні зовнішні відгуки, не `public.reviews`, не rating і не факти вакансій. Автоматично публікувати не можна: тільки `status=verified` + `is_public=true` після перевірки.

4. `company_open_facts`

Факти з відкритих вакансій Work.ua / Robota.ua: зарплата, місто, графік, оформлення, умови, вимоги, обов’язки, бонуси, опис компанії. Це заявлені умови роботодавця, а не підтверджений досвід працівників.

5. `company_discovery_queue`

Черга кандидатів на нові компанії, знайдені у відкритих джерелах. За замовчуванням нові компанії не створюються автоматично.

## Що публікується автоматично

`company_open_facts` можуть публікуватися автоматично, якщо виконані всі умови:

- джерело Work.ua або Robota.ua;
- сторінка доступна звичайним public fetch;
- є `source_url`;
- компанія matched з `public.companies` з високою впевненістю;
- є назва вакансії;
- є хоча б місто, зарплата, опис вакансії, графік або тип оформлення.

Тоді запис зберігається як `status=verified` і `is_public=true`. Це означає, що джерело і структура даних перевірені, а не що умови підтверджені працівниками.

## Що потребує ручної перевірки

- `external_review_signals`: завжди ручна/CSV перевірка, без auto-publication.
- `external_ratings`: admin або CSV workflow.
- слабкі vacancy matches: `needs_verification` / `is_public=false`.
- нові компанії: `company_discovery_queue`, якщо auto-import явно не ввімкнено.

## Bulk discovery

Dry-run без запису:

```bash
npm run discover:vacancies -- --dry-run
```

Окрема компанія і джерело:

```bash
npm run discover:vacancies -- --company=nova-poshta --source=workua --max-vacancies-per-company=2
npm run discover:vacancies -- --company=a-bank --source=robotaua --max-vacancies-per-company=2
```

Обмежити кількість компаній:

```bash
npm run discover:vacancies -- --limit=50
```

Повний enrichment flow зараз делегує vacancy discovery:

```bash
npm run enrich:companies -- --limit=100
```

Auto-import нових компаній вимкнений за замовчуванням. Увімкнути його можна тільки явно:

```bash
npm run enrich:companies -- --limit=10 --auto-import-companies=true
```

Сумнівні компанії залишаються у `company_discovery_queue` зі статусом `needs_review`.

## Bulk import vacancy URLs

Коли пошукові сторінки Work.ua / Robota.ua недоступні для звичайного fetch або повертають 403/captcha, використовується практичний fallback: імпорт готового списку URL вакансій. Скрипт не обходить захист, не логіниться і не використовує browser automation.

TXT формат: один URL на рядок. CSV формат: `url`, `company_slug`, `company_name`, `source_name`, `note`; усі поля, крім `url`, опціональні. Якщо `company_slug` передано, він використовується як підказка, але компанія все одно перевіряється в `public.companies`.

Шаблони:

```bash
data/vacancy-urls.txt
data/vacancy-urls-template.csv
```

Dry-run без запису:

```bash
npm run import:vacancy-urls -- --file=data/vacancy-urls.txt --dry-run
```

Реальний імпорт:

```bash
npm run import:vacancy-urls -- --file=data/vacancy-urls.txt
npm run import:vacancy-urls -- --file=data/vacancy-urls.csv --limit=100
npm run import:vacancy-urls -- --file=data/vacancy-urls.csv --source=workua
npm run import:vacancy-urls -- --file=data/vacancy-urls.csv --source=robotaua
```

Trusted facts з Work.ua / Robota.ua при впевненому збігу компанії зберігаються в `company_open_facts` як `status=verified` і `is_public=true`. Це публікує тільки заявлені умови з вакансії: зарплату, місто, графік, оформлення, умови, вимоги та опис. Скрипт не пише в `public.reviews`, не змінює внутрішній рейтинг і не збільшує кількість відгуків.

Якщо компанію не знайдено, запис іде в `company_discovery_queue` зі статусом `needs_review`. Нові компанії не створюються автоматично, якщо явно не передати:

```bash
npm run import:vacancy-urls -- --file=data/vacancy-urls.csv --auto-import-companies=true
```

Навіть з цим прапорцем імпорт створює компанію тільки для trusted source, вільного slug і достатніх фактів. Сумнівні збіги залишаються в черзі. `external_review_signals` не створюються і не публікуються автоматично через цей workflow.

## CSV workflow для company discovery

```bash
npm run export:company-discovery
npm run import:company-discovery
npm run check:company-discovery
```

Файл імпорту: `data/company-discovery-import.csv`.

## Admin workflow

У `/admin` є блоки:

- “Нові компанії з відкритих джерел” для `company_discovery_queue`;
- “Дані з відкритих вакансій” для `company_open_facts`;
- “Зовнішні оцінки” для `external_ratings`;
- “Сигнали з відкритих джерел” для `external_review_signals`.

Якщо auto-import або parser помилився, admin може приховати, відхилити або видалити запис у відповідному блоці.

## Safety rules

- No browser automation.
- No Playwright/Puppeteer for scraping.
- No captcha/login/anti-bot bypass.
- No paid APIs.
- No AI APIs.
- No copied external reviews.
- No personal data collection.
- If a source returns 403/captcha/empty HTML, script records skip and stops for that URL.
- Public UI must always label source type: “за відгуками Прозора робота”, “за відкритими оцінками”, “за відкритими вакансіями”, “за відкритими джерелами”.
