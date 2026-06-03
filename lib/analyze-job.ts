import type { JobAnalysis, RiskLevel } from "./types";

// Mock "AI" job-posting analyzer. Pure heuristics over the pasted text.
// It is intentionally cautious: it never asserts facts it cannot derive.

const SALARY_RANGE_RE =
  /(\d[\d\s]{2,})\s?(?:–|-|—|до)\s?(\d[\d\s]{2,})/; // e.g. "15 000 - 45 000"

export function analyzeJobText(text: string, url?: string): JobAnalysis {
  const raw = (text || "").trim();
  const combined = `${raw} ${url || ""}`.toLowerCase();
  const wordCount = raw.split(/\s+/).filter(Boolean).length;

  // --- Not enough data path -------------------------------------------------
  if (wordCount < 12 && !url) {
    return {
      riskLevel: "unknown",
      summary:
        "Недостатньо тексту для аналізу. Вставте повний опис вакансії, щоб отримати детальнішу оцінку. Питання для співбесіди наведено нижче — вони актуальні для будь-якої вакансії.",
      booking: emptySection("Інформацію про бронювання не вдалося визначити."),
      salary: emptySection("Інформацію про зарплату не вдалося визначити."),
      employment: emptySection("Інформацію про оформлення не вдалося визначити."),
      internship: emptySection("Інформацію про стажування не вдалося визначити."),
      redFlags: ["Замало тексту, щоб оцінити умови вакансії"],
      interviewQuestions: BASE_QUESTIONS,
    };
  }

  const mentionsBooking = /(брон|бронюв|резерв\+|відстрочк)/.test(combined);
  const bookingHasDetails = /(дія|резерв\+|після|з першого дня|одразу|подаємо|оформлюємо бронь)/.test(
    combined
  );

  const salaryRange = raw.match(SALARY_RANGE_RE);
  const hasWideRange = !!salaryRange && parseRangeIsWide(salaryRange);
  const mentionsBonus = /(бонус|відсот|%|ставка|премі|kpi)/.test(combined);
  const mentionsSalary = !!salaryRange || /(зарплат|з\/п|грн|дохід|оплата)/.test(combined);

  const mentionsOfficial = /(офіційн|оформлен|трудов|за кзпп|білу|на біло)/.test(combined);
  const officialFromDayOne = /(з першого дня|одразу офіцій|офіційно одразу)/.test(combined);
  const mentionsProbation = /(випробувальн|випробув|пробний період)/.test(combined);

  const mentionsInternship = /(стажув|стажир|навчанн)/.test(combined);
  const internshipPaid = /(оплачуван|оплачуєм|оплата стажув)/.test(combined);

  // --- Red flags ------------------------------------------------------------
  const redFlags: string[] = [];
  if (hasWideRange) redFlags.push("Зарплата вказана дуже широким діапазоном");
  if (mentionsBooking && !bookingHasDetails)
    redFlags.push("Бронювання згадується без конкретних умов");
  if (!mentionsOfficial) redFlags.push("Не вказано, з якого дня офіційне оформлення");
  if (mentionsProbation) redFlags.push("Є випробувальний термін без чітких деталей");
  if (!/(графік|з \d{1,2}:?\d{0,2}|пн-пт|зміни|год)/.test(combined))
    redFlags.push("Немає чіткого графіку роботи");
  if (mentionsBonus && !salaryRange)
    redFlags.push("Дохід прив'язаний до бонусів без вказаної фіксованої ставки");

  // --- Risk level -----------------------------------------------------------
  let riskScore = 0;
  riskScore += hasWideRange ? 2 : 0;
  riskScore += mentionsBooking && !bookingHasDetails ? 2 : 0;
  riskScore += !mentionsOfficial ? 2 : 0;
  riskScore += mentionsProbation ? 1 : 0;
  riskScore += mentionsBonus && !salaryRange ? 1 : 0;

  let riskLevel: RiskLevel;
  if (riskScore >= 5) riskLevel = "high";
  else if (riskScore >= 2) riskLevel = "medium";
  else riskLevel = "low";

  const summary = buildSummary(riskLevel, {
    mentionsBooking,
    bookingHasDetails,
    mentionsOfficial,
    hasWideRange,
  });

  return {
    riskLevel,
    summary,
    booking: {
      status: mentionsBooking
        ? bookingHasDetails
          ? "Згадується з деякими деталями"
          : "Згадується без конкретики"
        : "Не згадується",
      detail: mentionsBooking
        ? "У тексті є згадка про бронювання чи відстрочку. Конкретні умови оформлення варто перевірити окремо."
        : "У тексті немає згадки про бронювання. Це не означає, що його немає — але краще уточнити напряму.",
      toClarify:
        "З якого дня подають на бронювання, через який сервіс (Дія / Резерв+) та чи є реальні приклади оформлення.",
    },
    salary: {
      status: salaryRange
        ? hasWideRange
          ? "Вказано широкий діапазон"
          : "Вказано діапазон"
        : mentionsSalary
        ? "Згадується без конкретних цифр"
        : "Не вказано",
      detail: hasWideRange
        ? "Дуже широкий діапазон зарплати часто означає, що верхня цифра — це рідкісний максимум із бонусами."
        : "Уточніть, яка частина доходу — фіксована ставка, а яка залежить від бонусів чи плану.",
      toClarify:
        "Яка фіксована ставка «на руки», від чого залежать бонуси та як часто їх реально отримують.",
    },
    employment: {
      status: officialFromDayOne
        ? "Заявлено офіційно з першого дня"
        : mentionsOfficial
        ? "Згадується офіційне оформлення"
        : "Не вказано",
      detail: mentionsOfficial
        ? "Згадка про офіційне оформлення є. Важливо уточнити саме дату — інколи оформлюють лише після стажування."
        : "У тексті немає згадки про офіційне оформлення. Це варто уточнити до виходу на роботу.",
      toClarify: "З якого дня підписують трудовий договір і чи є офіційне оформлення під час стажування.",
    },
    internship: {
      status: mentionsInternship
        ? internshipPaid
          ? "Згадується оплачуване стажування"
          : "Згадується стажування (оплату не вказано)"
        : "Не згадується",
      detail: mentionsInternship
        ? "Є згадка про стажування чи навчання. Уточніть тривалість і чи оплачується цей період."
        : "Стажування в тексті не згадується. Якщо воно є — уточніть умови окремо.",
      toClarify: "Скільки триває стажування, чи оплачується воно і за якою ставкою.",
    },
    redFlags: redFlags.length ? redFlags : ["Явних червоних прапорців у тексті не виявлено"],
    interviewQuestions: BASE_QUESTIONS,
  };
}

const BASE_QUESTIONS = [
  "З якого дня офіційне оформлення?",
  "Коли саме подають на бронювання?",
  "Чи є підтвердження через Дію або Резерв+?",
  "Яка фіксована ставка, а яка частина бонусна?",
  "Чи оплачується стажування?",
  "Чи є штрафи або утримання?",
  "Який реальний графік і чи є переробки?",
];

function emptySection(detail: string) {
  return {
    status: "недостатньо даних",
    detail,
    toClarify: "Уточніть це питання напряму до виходу на роботу.",
  };
}

function parseRangeIsWide(match: RegExpMatchArray): boolean {
  const low = Number(match[1].replace(/\s/g, ""));
  const high = Number(match[2].replace(/\s/g, ""));
  if (!low || !high) return false;
  return high >= low * 2; // top is 2x+ the bottom -> "wide"
}

function buildSummary(
  riskLevel: RiskLevel,
  ctx: {
    mentionsBooking: boolean;
    bookingHasDetails: boolean;
    mentionsOfficial: boolean;
    hasWideRange: boolean;
  }
): string {
  const points: string[] = [];
  if (!ctx.mentionsOfficial || !ctx.mentionsBooking) {
    const items: string[] = [];
    if (!ctx.mentionsBooking || !ctx.bookingHasDetails) items.push("умови бронювання");
    if (ctx.hasWideRange) items.push("структуру зарплати");
    if (!ctx.mentionsOfficial) items.push("дату офіційного оформлення");
    if (items.length) points.push(items.join(", "));
  }

  const tail = points.length
    ? ` Перед виходом варто письмово уточнити: ${points.join("; ")}.`
    : " Опис виглядає достатньо повним, але ключові умови все одно варто зафіксувати письмово.";

  switch (riskLevel) {
    case "high":
      return `Вакансію варто розглядати обережно: кілька важливих умов описано нечітко.${tail}`;
    case "medium":
      return `Вакансію можна розглядати, але є питання, які потребують уточнення.${tail}`;
    default:
      return `Вакансію можна розглядати.${tail}`;
  }
}
