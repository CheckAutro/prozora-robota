# Збір реальних URL вакансій без обходу захисту

Цей документ описує безпечний ручний спосіб збору посилань на вакансії
з Work.ua та Robota.ua прямо з браузера, без автоматизації, fetch-запитів
або обходу captcha/anti-bot.

---

## Кроки

### 1. Відкрийте сторінку з вакансіями

Відкрийте у звичайному браузері потрібну сторінку вручну. Наприклад:

**Work.ua — сторінка компанії:**
```
https://www.work.ua/jobs/by-company/34748/       ← Нова Пошта
https://www.work.ua/jobs/by-company/1/            ← замініть ID
```

**Work.ua — пошукова видача:**
```
https://www.work.ua/jobs-нова+пошта/
https://www.work.ua/jobs-київ-продавець/
```

**Robota.ua — сторінка компанії:**
```
https://robota.ua/company562625                   ← Сільпо
https://robota.ua/company941895                   ← замініть ID
```

**Robota.ua — пошукова видача:**
```
https://robota.ua/zapros/silpo/kyiv
https://robota.ua/zapros/nova-poshta
```

Дочекайтеся повного завантаження сторінки і прокрутіть вниз,
щоб підвантажились усі картки вакансій.

---

### 2. Запустіть snippet у консолі браузера

Відкрийте DevTools (`F12` → вкладка **Console**) і вставте один з двох
snippet-ів нижче залежно від сайту.

> **Важливо:** Snippet лише читає посилання, вже видимі в DOM поточної
> сторінки. Він НЕ робить fetch, НЕ переходить на інші URL,
> НЕ обходить захист.

---

#### Snippet для Work.ua

```js
(function () {
  const SOURCE = 'Work.ua';
  const pattern = /work\.ua\/jobs\/(\d+)\/?/;

  const seen = new Set();
  const rows = [];

  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.href || '';
    if (!pattern.test(href)) return;
    const url = href.split('?')[0].replace(/\/$/, '') + '/';
    if (seen.has(url)) return;
    seen.add(url);

    // спробуємо знайти назву компанії поряд із посиланням
    const card = a.closest('[class*="card"], [class*="job"], li, article') || a;
    const companyEl = card.querySelector(
      '[class*="company"], [class*="employer"], span b, .company-name'
    );
    const company = (companyEl?.textContent || '').trim().replace(/,/g, ' ');

    // назва міста / посади з тексту картки — для note
    const titleEl = card.querySelector('h2, h3, [class*="title"]');
    const title = (titleEl?.textContent || '').trim().slice(0, 80).replace(/,/g, ' ');

    rows.push({ url, company, note: title, source: SOURCE });
  });

  if (!rows.length) {
    console.warn('Вакансій не знайдено. Прокрутіть сторінку та спробуйте ще раз.');
    return;
  }

  const csv = [
    'url,company_slug,company_name,source_name,note',
    ...rows.map(
      (r) => `${r.url},,${r.company},${r.source},${r.note}`
    ),
  ].join('\n');

  const txt = rows.map((r) => r.url).join('\n');

  console.group(`✅ Work.ua — знайдено ${rows.length} вакансій`);
  console.log('=== CSV ===\n' + csv);
  console.log('\n=== TXT (тільки URL) ===\n' + txt);
  console.groupEnd();

  // автоматично копіює CSV у буфер обміну (якщо сайт це дозволяє)
  navigator.clipboard?.writeText(csv).then(
    () => console.info('📋 CSV скопійовано в буфер обміну'),
    () => console.info('Скопіюйте CSV вручну з виводу вище')
  );
})();
```

---

#### Snippet для Robota.ua

```js
(function () {
  const SOURCE = 'Robota.ua';
  // обидва формати: /companyNNN/vacancyNNN  та  /ua/company/NNN/vacancy/NNN
  const pattern =
    /robota\.ua\/(ua\/)?company\d+\/vacancy\d+|robota\.ua\/company\d+\/vacancy\d+/i;

  const seen = new Set();
  const rows = [];

  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.href || '';
    if (!pattern.test(href)) return;
    const url = href.split('?')[0];
    if (seen.has(url)) return;
    seen.add(url);

    const card = a.closest('[class*="card"], [class*="vacancy"], li, article') || a;
    const companyEl = card.querySelector(
      '[class*="company"], [class*="employer"], .company-name'
    );
    const company = (companyEl?.textContent || '').trim().replace(/,/g, ' ');

    const titleEl = card.querySelector('h2, h3, [class*="title"], [class*="name"]');
    const title = (titleEl?.textContent || '').trim().slice(0, 80).replace(/,/g, ' ');

    rows.push({ url, company, note: title, source: SOURCE });
  });

  if (!rows.length) {
    console.warn('Вакансій не знайдено. Прокрутіть сторінку та спробуйте ще раз.');
    return;
  }

  const csv = [
    'url,company_slug,company_name,source_name,note',
    ...rows.map(
      (r) => `${r.url},,${r.company},${r.source},${r.note}`
    ),
  ].join('\n');

  const txt = rows.map((r) => r.url).join('\n');

  console.group(`✅ Robota.ua — знайдено ${rows.length} вакансій`);
  console.log('=== CSV ===\n' + csv);
  console.log('\n=== TXT (тільки URL) ===\n' + txt);
  console.groupEnd();

  navigator.clipboard?.writeText(csv).then(
    () => console.info('📋 CSV скопійовано в буфер обміну'),
    () => console.info('Скопіюйте CSV вручну з виводу вище')
  );
})();
```

---

#### Snippet для Work.ua facts CSV

Цей варіант потрібен, коли server-side fetch Work.ua блокується. Він збирає
готові факти з видимих карток вакансій у форматі `data/vacancy-facts-import.csv`.
Snippet не робить fetch і не відкриває сторінки вакансій.

```js
(function () {
  const SOURCE = 'Work.ua';
  const companyName = prompt('company_name для CSV:', '')?.trim() || '';
  const companySlug = prompt('company_slug (можна залишити порожнім):', '')?.trim() || '';
  const note = prompt('note / batch label:', companyName ? `${companyName} batch 1` : 'Work.ua batch 1')?.trim() || '';
  const pattern = /work\.ua\/jobs\/(\d+)\/?/;

  const escapeCsv = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const seen = new Set();
  const rows = [];

  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.href || '';
    const match = pattern.exec(href);
    if (!match) return;

    const sourceUrl = `https://www.work.ua/jobs/${match[1]}/`;
    if (seen.has(sourceUrl)) return;
    seen.add(sourceUrl);

    const card = a.closest('[data-id], article, li, .card, [class*="job"]') || a.parentElement || a;
    const cardText = clean(card.textContent).slice(0, 500);
    const title = clean(
      a.textContent ||
      card.querySelector('h2, h3, [class*="title"]')?.textContent ||
      ''
    ).slice(0, 120);

    const salaryMatch = cardText.match(/(?:від\s*)?\d[\d\s\u00a0\u202f]*(?:[–—-]\s*\d[\d\s\u00a0\u202f]*)?\s*(?:грн|₴|uah)(?:\s*[+]\s*\d[\d\s\u00a0\u202f]*\s*\S*)?/i);
    const salaryText = clean(salaryMatch?.[0] || '');
    const cityMatch = cardText.match(/\b(Київ|Львів|Одеса|Дніпро|Харків|Запоріжжя|Вінниця|Полтава|Черкаси|Чернігів|Житомир|Рівне|Луцьк|Тернопіль|Івано-Франківськ|Ужгород|Хмельницький|Чернівці|Миколаїв|Херсон|Суми|Кропивницький)\b/i);
    const city = clean(cityMatch?.[0] || '');

    if (!title) return;

    rows.push({
      source_url: sourceUrl,
      source_name: SOURCE,
      company_name: companyName,
      company_slug: companySlug,
      vacancy_title: title,
      city,
      salary_text: salaryText,
      salary_min: '',
      salary_max: '',
      raw_excerpt: cardText,
      note,
    });
  });

  if (!rows.length) {
    console.warn('Вакансій не знайдено. Прокрутіть сторінку та спробуйте ще раз.');
    return;
  }

  const columns = [
    'source_url',
    'source_name',
    'company_name',
    'company_slug',
    'vacancy_title',
    'city',
    'salary_text',
    'salary_min',
    'salary_max',
    'raw_excerpt',
    'note',
  ];
  const csv = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(',')),
  ].join('\n');

  console.group(`✅ Work.ua facts — знайдено ${rows.length} вакансій`);
  console.log(csv);
  console.groupEnd();

  navigator.clipboard?.writeText(csv).then(
    () => console.info('📋 Facts CSV скопійовано в буфер обміну'),
    () => console.info('Скопіюйте CSV вручну з виводу вище')
  );
})();
```

Для такого CSV використовуйте окремий importer:

```bash
npm run import:vacancy-facts -- --file=data/vacancy-facts-import.csv --dry-run
npm run import:vacancy-facts -- --file=data/vacancy-facts-import.csv
```

---

### 3. Збережіть результат у data/vacancy-urls-import.csv

Скопіюйте вивід **=== CSV ===** з консолі та збережіть у файл:

```
data/vacancy-urls-import.csv
```

Файл повинен починатися з рядка-заголовку:

```
url,company_slug,company_name,source_name,note
```

---

### 4. Запустіть importer

**Dry-run (тільки перевірка, без запису в БД):**
```bash
npm run import:vacancy-urls -- --file=data/vacancy-urls-import.csv --dry-run
```

**Реальний імпорт:**
```bash
npm run import:vacancy-urls -- --file=data/vacancy-urls-import.csv
```

---

## Поради

| Порада | Деталі |
|--------|--------|
| Прокрутіть до кінця | Деякі сторінки підвантажують картки lazy-load — прокрутіть перед запуском snippet |
| Кілька сторінок пагінації | Перейдіть на `/page/2/`, `/page/3/` і запустіть snippet на кожній окремо |
| Об'єднайте кілька CSV | Вручну скопіюйте рядки з кількох запусків в один файл (заголовок — тільки одного разу) |
| company_slug | Залиште порожнім — importer знайде компанію за URL або company_name |
| Дублі | Importer ігнорує дублі за URL автоматично |

---

## Приклад готового CSV

```csv
url,company_slug,company_name,source_name,note
https://www.work.ua/jobs/8140419/,nova-poshta,Нова Пошта,Work.ua,Київ; оператор відділення
https://www.work.ua/jobs/8201337/,,Нова Пошта,Work.ua,Львів; кур'єр
https://robota.ua/company941895/vacancy9375874,,А-Банк,Robota.ua,Кам'янець-Подільський
https://robota.ua/company562625/vacancy9100001,,Сільпо,Robota.ua,Київ; касир
```
