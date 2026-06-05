# Robota.ua vacancy facts collection

Цей workflow потрібен, коли server-side fetch не підходить або джерело змінює HTML.
Він не обходить captcha, не логіниться і не використовує browser automation.

Людина відкриває сторінку Robota.ua у звичайному браузері, прокручує сторінку,
а snippet нижче читає тільки вже видимий DOM і формує CSV, сумісний з:

```bash
data/vacancy-facts-import.csv
```

Importer:

```bash
npm run import:vacancy-facts -- --file=data/vacancy-facts-import.csv --dry-run
npm run import:vacancy-facts -- --file=data/vacancy-facts-import.csv
```

Усі записи імпортуються як `needs_verification` і `is_public=false`.

## Browser console snippet

```js
(function () {
  const SOURCE = 'Robota.ua';
  const companyName = prompt('company_name для CSV:', '')?.trim() || '';
  const companySlug = prompt('company_slug (можна залишити порожнім):', '')?.trim() || '';
  const note = prompt('note / batch label:', companyName ? `${companyName} Robota.ua batch 1` : 'Robota.ua batch 1')?.trim() || '';
  const seen = new Set();
  const rows = [];

  const escapeCsv = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const normalizeUrl = (href) => {
    try {
      const url = new URL(href, location.href);
      const parts = url.pathname.split('/').filter(Boolean);
      const index = parts.findIndex((part) => /^vacancy\d+$/i.test(part));
      if (index === -1) return '';
      return `${url.origin}/${parts.slice(0, index + 1).join('/')}`;
    } catch {
      return '';
    }
  };
  const parseSalaryNumbers = (salaryText) => {
    const text = clean(salaryText).replace(/\u00a0|\u202f/g, ' ');
    const range = text.match(/(\d[\d\s.,]*)\s*[–—-]\s*(\d[\d\s.,]*)/);
    const one = text.match(/(\d[\d\s.,]*)/);
    const norm = (value) => clean(value).replace(/\s/g, '').replace(',', '.');
    if (range) return [norm(range[1]), norm(range[2])];
    if (one) return [norm(one[1]), ''];
    return ['', ''];
  };

  document.querySelectorAll('a[href]').forEach((a) => {
    const sourceUrl = normalizeUrl(a.href || '');
    if (!sourceUrl || seen.has(sourceUrl)) return;
    seen.add(sourceUrl);

    const card = a.closest('[data-testid], article, li, [class*="card"], [class*="vacancy"]') || a.parentElement || a;
    const rawExcerpt = clean(card.textContent).slice(0, 500);
    const vacancyTitle = clean(
      a.textContent ||
      card.querySelector('h2, h3, [class*="title"], [class*="name"]')?.textContent ||
      ''
    ).slice(0, 120);
    if (!vacancyTitle) return;

    const salaryMatch = rawExcerpt.match(/\d[\d\s\u00a0\u202f]*(?:[–—-]\s*\d[\d\s\u00a0\u202f]*)?\s*(?:грн|₴|uah)(?:\s*[+]\s*\d[\d\s\u00a0\u202f]*\s*\S*)?/i);
    const salaryText = clean(salaryMatch?.[0] || '');
    const [salaryMin, salaryMax] = parseSalaryNumbers(salaryText);
    const cityMatch = rawExcerpt.match(/\b(Київ|Львів|Одеса|Дніпро|Харків|Запоріжжя|Вінниця|Полтава|Черкаси|Чернігів|Житомир|Рівне|Луцьк|Тернопіль|Івано-Франківськ|Ужгород|Хмельницький|Чернівці|Миколаїв|Херсон|Суми|Кропивницький)\b/i);
    const city = clean(cityMatch?.[0] || '');

    rows.push({
      source_url: sourceUrl,
      source_name: SOURCE,
      company_name: companyName,
      company_slug: companySlug,
      vacancy_title: vacancyTitle,
      city,
      salary_text: salaryText,
      salary_min: salaryMin,
      salary_max: salaryMax,
      raw_excerpt: rawExcerpt,
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

  console.group(`✅ Robota.ua facts — знайдено ${rows.length} вакансій`);
  console.log(csv);
  console.groupEnd();

  navigator.clipboard?.writeText(csv).then(
    () => console.info('📋 Facts CSV скопійовано в буфер обміну'),
    () => console.info('Скопіюйте CSV вручну з виводу вище')
  );
})();
```
