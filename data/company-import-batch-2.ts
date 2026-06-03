// data/company-import-batch-2.ts
// Second batch of real Ukrainian employers for import into public.companies.
//
// Slugs are pre-computed via slugifyCompanyName() from lib/slugify.ts.
// Industries use canonical values from lib/industry.ts CANONICAL_INDUSTRIES.
//
// Companies already present in the mock-data (nova-poshta, atb, silpo, eva,
// rozetka, ukrposhta, varus, comfy) are EXCLUDED here — the import script
// deduplicates by slug before inserting.

export interface CompanyImportRow {
  name: string;
  slug: string;
  city: string | null;
  industry: string | null;
}

export const COMPANY_IMPORT_BATCH_2: CompanyImportRow[] = [
  // ── Логістика і доставка ──────────────────────────────────────────────────
  { name: "Meest",            slug: "meest",           city: "Львів",  industry: "Логістика і доставка" },
  { name: "Delivery",         slug: "delivery",        city: null,     industry: "Логістика і доставка" },
  { name: "SAT",              slug: "sat",             city: "Харків", industry: "Логістика і доставка" },
  { name: "Нічний Експрес",   slug: "nichnyi-ekspres", city: null,     industry: "Логістика і доставка" },
  { name: "Делфаст",          slug: "delfast",         city: "Київ",   industry: "Логістика і доставка" },
  { name: "Glovo",            slug: "glovo",           city: "Київ",   industry: "Логістика і доставка" },
  { name: "Bolt Food",        slug: "bolt-food",       city: "Київ",   industry: "Логістика і доставка" },

  // ── Роздрібна торгівля ────────────────────────────────────────────────────
  { name: "Фора",             slug: "fora",            city: "Київ",   industry: "Роздрібна торгівля" },
  { name: "Novus",            slug: "novus",           city: "Київ",   industry: "Роздрібна торгівля" },
  { name: "Ашан",             slug: "ashan",           city: "Київ",   industry: "Роздрібна торгівля" },
  { name: "Metro",            slug: "metro",           city: "Київ",   industry: "Роздрібна торгівля" },
  { name: "Епіцентр",         slug: "epicentr",        city: "Київ",   industry: "Роздрібна торгівля" },
  { name: "JYSK",             slug: "jysk",            city: null,     industry: "Роздрібна торгівля" },
  { name: "Аврора",           slug: "avrora",          city: "Харків", industry: "Роздрібна торгівля" },
  { name: "Watsons",          slug: "watsons",         city: "Київ",   industry: "Роздрібна торгівля" },
  { name: "Prostor",          slug: "prostor",         city: "Київ",   industry: "Роздрібна торгівля" },

  // ── E-commerce ────────────────────────────────────────────────────────────
  { name: "Prom",             slug: "prom",            city: "Харків", industry: "E-commerce" },
  { name: "OLX",              slug: "olx",             city: "Київ",   industry: "E-commerce" },
  { name: "Foxtrot",          slug: "foxtrot",         city: "Київ",   industry: "E-commerce" },
  { name: "Алло",             slug: "allo",            city: "Київ",   industry: "E-commerce" },
  { name: "Citrus",           slug: "citrus",          city: "Київ",   industry: "E-commerce" },
  { name: "MOYO",             slug: "moyo",            city: "Харків", industry: "E-commerce" },
  { name: "Brain",            slug: "brain",           city: "Харків", industry: "E-commerce" },

  // ── Банки і фінанси ───────────────────────────────────────────────────────
  { name: "ПриватБанк",       slug: "pryvatbank",      city: "Дніпро", industry: "Банки і фінанси" },
  { name: "monobank",         slug: "monobank",        city: "Київ",   industry: "Банки і фінанси" },
  { name: "A-Банк",           slug: "a-bank",          city: "Дніпро", industry: "Банки і фінанси" },
  { name: "Ощадбанк",         slug: "oshchadbank",     city: "Київ",   industry: "Банки і фінанси" },
  { name: "Райффайзен Банк",  slug: "raiffeisen-bank", city: "Київ",   industry: "Банки і фінанси" },
  { name: "ПУМБ",             slug: "pumb",            city: "Донецьк", industry: "Банки і фінанси" },
  { name: "Sense Bank",       slug: "sense-bank",      city: "Київ",   industry: "Банки і фінанси" },
  { name: "Укрсиббанк",       slug: "ukrsybbank",      city: "Харків", industry: "Банки і фінанси" },
  { name: "Кредобанк",        slug: "kredobank",       city: "Львів",  industry: "Банки і фінанси" },
  { name: "OTP Bank",         slug: "otp-bank",        city: "Київ",   industry: "Банки і фінанси" },
  { name: "Ідея Банк",        slug: "idea-bank",       city: "Київ",   industry: "Банки і фінанси" },
  { name: "Таскомбанк",       slug: "taskombank",      city: "Київ",   industry: "Банки і фінанси" },
  { name: "Універсал Банк",   slug: "universal-bank",  city: "Київ",   industry: "Банки і фінанси" },
  { name: "Credit Agricole",  slug: "credit-agricole", city: "Київ",   industry: "Банки і фінанси" },
  { name: "Правекс Банк",     slug: "praveks-bank",    city: "Київ",   industry: "Банки і фінанси" },

  // ── Аптеки і медицина ─────────────────────────────────────────────────────
  { name: "Аптека АНЦ",             slug: "apteka-ants",             city: "Київ",   industry: "Аптеки і медицина" },
  { name: "Аптека Доброго Дня",     slug: "apteka-dobroho-dnia",     city: null,     industry: "Аптеки і медицина" },
  { name: "Подорожник",             slug: "podorozhnyk",             city: null,     industry: "Аптеки і медицина" },
  { name: "Бажаємо здоров'я",       slug: "bazhaemo-zdorovia",       city: null,     industry: "Аптеки і медицина" },
  { name: "Аптека 911",             slug: "apteka-911",              city: null,     industry: "Аптеки і медицина" },
  { name: "Аптека низьких цін",     slug: "apteka-nyzkykh-tsin",     city: null,     industry: "Аптеки і медицина" },
  { name: "Мед-Сервіс",             slug: "med-servis",              city: null,     industry: "Аптеки і медицина" },
  { name: "Аптека Копійка",         slug: "apteka-kopiika",          city: null,     industry: "Аптеки і медицина" },
  { name: "Сінево",                 slug: "sinevo",                  city: "Київ",   industry: "Аптеки і медицина" },
  { name: "Діла",                   slug: "dila",                    city: "Київ",   industry: "Аптеки і медицина" },
  { name: "Ескулаб",                slug: "eskulab",                 city: "Київ",   industry: "Аптеки і медицина" },

  // ── Медицина ─────────────────────────────────────────────────────────────
  { name: "Добробут",               slug: "dobrobut",                city: "Київ",   industry: "Медицина" },
  { name: "Медіком",                slug: "medikom",                 city: "Київ",   industry: "Медицина" },
  { name: "Оксфорд Медікал",        slug: "oksford-medikal",         city: "Київ",   industry: "Медицина" },
  { name: "Борис",                  slug: "borys",                   city: "Київ",   industry: "Медицина" },

  // ── АЗС і авто ────────────────────────────────────────────────────────────
  { name: "ОККО",                   slug: "okko",                    city: "Львів",  industry: "АЗС і авто" },
  { name: "WOG",                    slug: "wog",                     city: "Київ",   industry: "АЗС і авто" },
  { name: "UPG",                    slug: "upg",                     city: null,     industry: "АЗС і авто" },
  { name: "Shell",                  slug: "shell",                   city: null,     industry: "АЗС і авто" },
  { name: "SOCAR",                  slug: "socar",                   city: null,     industry: "АЗС і авто" },
  { name: "БРСМ",                   slug: "brsm",                    city: null,     industry: "АЗС і авто" },
  { name: "KLO",                    slug: "klo",                     city: null,     industry: "АЗС і авто" },
  { name: "Avantage 7",             slug: "avantage-7",              city: null,     industry: "АЗС і авто" },
  { name: "AMIC Energy",            slug: "amic-energy",             city: null,     industry: "АЗС і авто" },

  // ── Ресторани і фастфуд ───────────────────────────────────────────────────
  { name: "McDonald's",             slug: "mcdonalds",               city: null,     industry: "Ресторани і фастфуд" },
  { name: "KFC",                    slug: "kfc",                     city: null,     industry: "Ресторани і фастфуд" },
  { name: "Domino's Pizza",         slug: "dominos-pizza",           city: null,     industry: "Ресторани і фастфуд" },
  { name: "Пузата Хата",            slug: "puzata-khata",            city: "Київ",   industry: "Ресторани і фастфуд" },
  { name: "Mafia",                  slug: "mafia",                   city: "Київ",   industry: "Ресторани і фастфуд" },
  { name: "Сушия",                  slug: "sushyia",                 city: "Київ",   industry: "Ресторани і фастфуд" },
  { name: "Lviv Croissants",        slug: "lviv-croissants",         city: "Львів",  industry: "Ресторани і фастфуд" },
  { name: "Aroma Kava",             slug: "aroma-kava",              city: "Київ",   industry: "Ресторани і фастфуд" },
  { name: "Salateira",              slug: "salateira",               city: "Київ",   industry: "Ресторани і фастфуд" },
  { name: "Чорноморка",             slug: "chornomorka",             city: null,     industry: "Ресторани і фастфуд" },

  // ── Телеком ───────────────────────────────────────────────────────────────
  { name: "Київстар",               slug: "kyivstar",                city: "Київ",   industry: "Телеком" },
  { name: "Vodafone Україна",       slug: "vodafone-ukraina",        city: "Київ",   industry: "Телеком" },
  { name: "lifecell",               slug: "lifecell",                city: "Київ",   industry: "Телеком" },
  { name: "Укртелеком",             slug: "ukrtelekom",              city: "Київ",   industry: "Телеком" },
  { name: "Volia",                  slug: "volia",                   city: "Київ",   industry: "Телеком" },
  { name: "Vega",                   slug: "vega",                    city: "Харків", industry: "Телеком" },
  { name: "Lanet",                  slug: "lanet",                   city: "Харків", industry: "Телеком" },
  { name: "Triolan",                slug: "triolan",                 city: "Харків", industry: "Телеком" },

  // ── Виробництво ───────────────────────────────────────────────────────────
  { name: "Roshen",                 slug: "roshen",                  city: "Київ",   industry: "Виробництво" },
  { name: "Coca-Cola HBC Україна",  slug: "coca-cola-hbc-ukraina",   city: "Київ",   industry: "Виробництво" },
  { name: "PepsiCo Україна",        slug: "pepsico-ukraina",         city: "Київ",   industry: "Виробництво" },
  { name: "Carlsberg Ukraine",      slug: "carlsberg-ukraine",       city: "Київ",   industry: "Виробництво" },
  { name: "Оболонь",                slug: "obolon",                  city: "Київ",   industry: "Виробництво" },
  { name: "IDS Ukraine",            slug: "ids-ukraine",             city: "Миколаїв", industry: "Виробництво" },
  { name: "Фармак",                 slug: "farmak",                  city: "Київ",   industry: "Виробництво" },
  { name: "Дарниця",                slug: "darnytsia",               city: "Київ",   industry: "Виробництво" },
  { name: "Артеріум",               slug: "arterium",                city: "Київ",   industry: "Виробництво" },
  { name: "Біофарма",               slug: "biofarma",                city: "Київ",   industry: "Виробництво" },
  { name: "Інтерпайп",              slug: "interpipe",               city: "Дніпро", industry: "Виробництво" },
  { name: "Метінвест",              slug: "metinvest",               city: "Маріуполь", industry: "Виробництво" },
  { name: "ДТЕК",                   slug: "dtek",                    city: "Київ",   industry: "Виробництво" },

  // ── Агро ──────────────────────────────────────────────────────────────────
  { name: "МХП",                    slug: "mkhp",                    city: "Київ",   industry: "Агро" },
  { name: "Kernel",                 slug: "kernel",                  city: "Київ",   industry: "Агро" },
  { name: "Нібулон",                slug: "nibulon",                 city: "Миколаїв", industry: "Агро" },
  { name: "Астарта-Київ",           slug: "astarta-kyiv",            city: "Київ",   industry: "Агро" },

  // ── Охорона ───────────────────────────────────────────────────────────────
  { name: "Sheriffs",               slug: "sheriffs",                city: "Київ",   industry: "Охорона" },
  { name: "Venbest",                slug: "venbest",                 city: "Київ",   industry: "Охорона" },
  { name: "Явір-2000",              slug: "iavir-2000",              city: "Київ",   industry: "Охорона" },
  { name: "Охоронний Холдинг",      slug: "okhoronnyi-kholdingh",    city: null,     industry: "Охорона" },

  // ── Послуги (contact centers / outsourcing) ───────────────────────────────
  { name: "Global Bilgi",           slug: "global-bilgi",            city: "Київ",   industry: "Послуги" },
  { name: "Adelina Call Center",    slug: "adelina-call-center",     city: "Київ",   industry: "Послуги" },
  { name: "Binotel",                slug: "binotel",                 city: "Київ",   industry: "Послуги" },
  { name: "UniCall",                slug: "unicall",                 city: "Київ",   industry: "Послуги" },
  { name: "SupportYourApp",         slug: "supportyourapp",          city: "Київ",   industry: "Послуги" },

  // ── IT ────────────────────────────────────────────────────────────────────
  { name: "Ajax Systems",           slug: "ajax-systems",            city: "Київ",   industry: "IT" },
  { name: "Ringostat",              slug: "ringostat",               city: "Київ",   industry: "IT" },
  { name: "SoftServe",              slug: "softserve",               city: "Львів",  industry: "IT" },
  { name: "EPAM Ukraine",           slug: "epam-ukraine",            city: "Київ",   industry: "IT" },
  { name: "GlobalLogic",            slug: "globallogic",             city: "Київ",   industry: "IT" },
  { name: "Luxoft",                 slug: "luxoft",                  city: "Київ",   industry: "IT" },
  { name: "Intellias",              slug: "intellias",               city: "Львів",  industry: "IT" },
  { name: "N-iX",                   slug: "n-ix",                    city: "Львів",  industry: "IT" },
  { name: "Ciklum",                 slug: "ciklum",                  city: "Київ",   industry: "IT" },
  { name: "DataArt",                slug: "dataart",                 city: "Харків", industry: "IT" },
  { name: "Genesis",                slug: "genesis",                 city: "Київ",   industry: "IT" },
  { name: "MacPaw",                 slug: "macpaw",                  city: "Київ",   industry: "IT" },
  { name: "Grammarly",              slug: "grammarly",               city: "Київ",   industry: "IT" },
  { name: "Jooble",                 slug: "jooble",                  city: "Київ",   industry: "IT" },
  { name: "EVO",                    slug: "evo",                     city: "Харків", industry: "IT" },
  { name: "Netpeak",                slug: "netpeak",                 city: "Харків", industry: "IT" },
  { name: "BetterMe",               slug: "betterme",                city: "Київ",   industry: "IT" },
  { name: "Preply",                 slug: "preply",                  city: "Київ",   industry: "IT" },

  // ── Будівництво і нерухомість ─────────────────────────────────────────────
  { name: "ЛУН",                    slug: "lun",                     city: "Київ",   industry: "Будівництво і нерухомість" },
  { name: "DIM",                    slug: "dim",                     city: "Київ",   industry: "Будівництво і нерухомість" },
  { name: "Ковальська",             slug: "kovalska",                city: "Київ",   industry: "Будівництво і нерухомість" },
  { name: "Інтергал-Буд",           slug: "interhal-bud",            city: "Київ",   industry: "Будівництво і нерухомість" },
  { name: "Ріел",                   slug: "riel",                    city: "Київ",   industry: "Будівництво і нерухомість" },
  { name: "Perfect Group",          slug: "perfect-group",           city: "Київ",   industry: "Будівництво і нерухомість" },
  { name: "Stolitsa Group",         slug: "stolitsa-group",          city: "Київ",   industry: "Будівництво і нерухомість" },
  { name: "Київміськбуд",           slug: "kyivmiskbud",             city: "Київ",   industry: "Будівництво і нерухомість" },

  // ── Освіта ────────────────────────────────────────────────────────────────
  { name: "Green Forest",           slug: "green-forest",            city: "Київ",   industry: "Освіта" },
  { name: "Grade Education Centre", slug: "grade-education-centre",  city: "Київ",   industry: "Освіта" },
  { name: "EnglishDom",             slug: "englishdom",              city: "Київ",   industry: "Освіта" },
  { name: "GoIT",                   slug: "goit",                    city: "Київ",   industry: "Освіта" },
  { name: "Mate academy",           slug: "mate-academy",            city: "Київ",   industry: "Освіта" },
  { name: "Projector Institute",    slug: "projector-institute",     city: "Київ",   industry: "Освіта" },
  { name: "Hillel IT School",       slug: "hillel-it-school",        city: "Київ",   industry: "Освіта" },
  { name: "DAN.IT Education",       slug: "dan-it-education",        city: "Київ",   industry: "Освіта" },
];
