"use client";

import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { Star, AlertTriangle, ShieldCheck, ChevronRight, ChevronLeft } from "lucide-react";
import {
  reviewSchema,
  defaultReviewValues,
  type ReviewFormValues,
} from "@/lib/review-schema";
import { containsPersonalContacts, isLowQualityText } from "@/lib/detect-risks";
import { generateReviewId } from "@/lib/storage";
import { slugifyCompanyName } from "@/lib/slugify";
import { searchCompanySuggestions, type CompanySuggestion } from "@/lib/company-autocomplete";
import { ROLE_SUGGESTIONS, ROLE_SEARCH_ALIASES, getContextualRoles } from "@/lib/roles";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import type { Review } from "@/lib/types";

const CITIES = [
  "Київ", "Львів", "Дніпро", "Одеса", "Харків", "Запоріжжя",
  "Вінниця", "Івано-Франківськ", "Тернопіль", "Чернівці",
  "Луцьк", "Рівне", "Житомир", "Полтава", "Черкаси",
  "Чернігів", "Суми", "Миколаїв", "Хмельницький", "Кропивницький",
  "Ужгород", "Україна / дистанційно",
];

const YEAR_OPTIONS = [2026, 2025, 2024, 2023, 2022, 2021] as const;

const TOTAL_STEPS = 3;
const STEP_TITLES = ["Ваш досвід", "Реальні умови", "Оцінка і коментар"];

// ── Reusable field components ─────────────────────────────────────────────────

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink">{children}</label>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

function ErrorText({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="flex items-center gap-1 text-xs font-medium text-red-600">
    <AlertTriangle className="h-3 w-3 shrink-0" /> {msg}
  </p>;
}

function RadioPills<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors focus-ring",
            value === opt.value
              ? "border-brand-500 bg-brand-50 text-brand-700"
              : "border-ink/12 bg-white text-ink-soft hover:border-brand-300"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className="focus-ring rounded"
          aria-label={`${n} з 5`}
        >
          <Star
            className={cn(
              "h-6 w-6 transition-colors",
              n <= value ? "fill-amber-400 text-amber-400" : "text-ink/20 hover:text-amber-300"
            )}
          />
        </button>
      ))}
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function StepProgress({ step }: { step: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-ink">{STEP_TITLES[step - 1]}</span>
        <span className="text-ink-muted">Крок {step} з {TOTAL_STEPS}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.06]">
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-300"
          style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
        />
      </div>
    </div>
  );
}

// ── Main form ─────────────────────────────────────────────────────────────────

// ── CompanyAutocomplete ───────────────────────────────────────────────────────

function CompanyAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (suggestion: CompanySuggestion) => void;
  placeholder?: string;
  className?: string;
}) {
  const [suggestions, setSuggestions] = useState<CompanySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Guard against undefined coming from react-hook-form before defaultValues kick in
  const safeValue = typeof value === "string" ? value : "";

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); setOpen(false); return; }
    setLoading(true);
    const results = await searchCompanySuggestions(q);
    setSuggestions(results);
    setOpen(results.length > 0);
    setLoading(false);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    onChange(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void search(v), 220);
  }

  function handleSelect(s: CompanySuggestion) {
    onChange(s.name);
    onSelect(s);
    setOpen(false);
    setSuggestions([]);
  }

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={safeValue}
        onChange={handleChange}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {loading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">
          …
        </span>
      )}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-ink/12 bg-white shadow-lg">
          {suggestions.map((s) => (
            <li key={s.slug}>
              <button
                type="button"
                onMouseDown={() => handleSelect(s)}
                className="flex w-full flex-col px-4 py-2.5 text-left hover:bg-brand-50 focus:bg-brand-50 focus:outline-none"
              >
                <span className="text-sm font-medium text-ink">{s.name}</span>
                {(s.city || s.industry) && (
                  <span className="text-xs text-ink-muted">
                    {[s.city, s.industry].filter(Boolean).join(" · ")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── RoleAutocomplete ──────────────────────────────────────────────────────────

/**
 * Scores how well a role matches the query.
 * Returns 0 if no match. Higher = better.
 *   100: role starts with query (prefix match)
 *    80: role contains query as a substring
 *    60: slugified role contains slugified query
 *    40: role's alias tokens contain query
 */
function scoreRole(role: string, q: string, slugQ: string): number {
  if (!q) return 0;
  const roleLow = role.toLowerCase();
  if (roleLow.startsWith(q)) return 100;
  if (roleLow.includes(q)) return 80;
  const roleSlug = slugifyCompanyName(role);
  if (slugQ && roleSlug.includes(slugQ)) return 60;
  // Check aliases for this role
  const aliases = ROLE_SEARCH_ALIASES[role] ?? [];
  for (const alias of aliases) {
    if (alias.includes(q) || (slugQ && slugifyCompanyName(alias).includes(slugQ))) return 40;
  }
  return 0;
}

function RoleAutocomplete({
  value,
  onChange,
  placeholder,
  className,
  companyName = "",
  companySlug = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  companyName?: string;
  companySlug?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Guard against undefined from react-hook-form before defaultValues kick in
  const safeValue = typeof value === "string" ? value : "";

  // Contextual base list — depends on selected company
  const baseRoles = useMemo(
    () => getContextualRoles(companyName, companySlug),
    [companyName, companySlug]
  );

  const filtered = useMemo(() => {
    const q = safeValue.trim().toLowerCase();
    if (!q) {
      // Show first 10 contextual roles on focus
      return baseRoles.slice(0, 10);
    }
    const slugQ = slugifyCompanyName(q);
    const scored = baseRoles
      .map((r) => ({ r, s: scoreRole(r, q, slugQ) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 9)
      .map((x) => x.r);

    // Append "use own input" option when text is long enough and doesn't match exactly
    if (safeValue.trim().length >= 3 && !scored.includes(safeValue.trim())) {
      return [...scored, `➕ Використати: ${safeValue.trim()}`];
    }
    return scored;
  }, [safeValue, baseRoles]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={safeValue}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-ink/12 bg-white shadow-lg">
          {filtered.map((role) => (
            <li key={role}>
              <button
                type="button"
                onMouseDown={() => {
                  if (role.startsWith("➕ Використати: ")) {
                    onChange(safeValue.trim());
                  } else {
                    onChange(role);
                  }
                  setOpen(false);
                }}
                className="w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-brand-50 focus:bg-brand-50 focus:outline-none"
              >
                {role}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReviewForm({
  defaultCompany,
  defaultCompanySlug,
}: {
  defaultCompany?: string;
  defaultCompanySlug?: string | null;
}) {
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Honeypot: hidden field filled only by bots. Managed outside react-hook-form
  // so Zod validation never fails on it for real users.
  const [honeypot, setHoneypot] = useState("");
  // Slug selected from autocomplete or pre-filled from ?company= query param.
  const [selectedCompanySlug, setSelectedCompanySlug] = useState<string | null>(
    defaultCompanySlug ?? null
  );

  const {
    register,
    handleSubmit,
    control,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { ...defaultReviewValues, company: defaultCompany ?? "" } as ReviewFormValues,
    mode: "onTouched",
  });

  const text = useWatch({
    control,
    name: "text",
  }) ?? "";
  const bookingPromised = useWatch({
    control,
    name: "bookingPromised",
  });
  const hadInternship = useWatch({
    control,
    name: "hadInternship",
  });
  const watchedCompany = useWatch({
    control,
    name: "company",
  });

  const hasContacts = useMemo(() => containsPersonalContacts(text), [text]);
  const isLowQuality = useMemo(() => isLowQualityText(text), [text]);

  // Conditional visibility
  const showBookingDetails =
    bookingPromised === "yes";
  const showInternshipPaid = hadInternship === "yes";

  // Step 1 fields to validate before advancing
  const STEP1_FIELDS: (keyof ReviewFormValues)[] = ["company", "city", "roleCategory", "type", "year"];
  const STEP2_FIELDS: (keyof ReviewFormValues)[] = [
    "salaryMatch", "officialEmployment", "paymentDelay",
    "bookingPromised", "hadInternship",
  ];

  async function goNext() {
    const fields = step === 1 ? STEP1_FIELDS : STEP2_FIELDS;
    const ok = await trigger(fields);
    if (ok) setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  async function onSubmit(values: ReviewFormValues) {
    if (containsPersonalContacts(values.text)) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (isLowQualityText(values.text)) {
      setSubmitError("Напишіть змістовний відгук про досвід роботи або співбесіди.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSubmitError(null);
    const review: Review = {
      id: generateReviewId(),
      // Use the slug from the autocomplete selection (canonical, from Supabase).
      // Fall back to transliteration only when the user typed a company
      // that is not in public.companies.
      companySlug: selectedCompanySlug ?? slugifyCompanyName(values.company),
      companyName: values.company,
      type: values.type,
      city: values.city,
      roleCategory: values.roleCategory,
      year: values.year,
      verified: false,
      text: values.text,
      salaryMatch: values.salaryMatch,
      officialEmployment: values.officialEmployment,
      bookingPromised: values.bookingPromised,
      bookingReceived: values.bookingReceived,
      bookingTiming: values.bookingTiming,
      internshipPaid: values.internshipPaid,
      paymentDelay: values.paymentDelay,
      ratings: {
        salary: values.ratingSalary,
        schedule: values.ratingSchedule,
        management: values.ratingManagement,
        conditions: values.ratingConditions,
        honesty: values.ratingHonesty,
      },
      badges: [],
      status: "pending",
    };
    try {
      // Send to server-side route (honeypot + rate limit + PII check + insert)
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...review, website: honeypot }),
      });
      if (res.ok) {
        setSubmitted(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        const data = await res.json() as { error?: string };
        setSubmitError(data.error ?? "Помилка збереження. Спробуйте ще раз.");
      }
    } catch {
      setSubmitError("Помилка зʼєднання. Спробуйте ще раз.");
    }
  }

  // ── Success state ───────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <Card className="space-y-4 p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-100">
          <ShieldCheck className="h-7 w-7 text-brand-600" />
        </div>
        <h2 className="font-display text-2xl font-bold text-ink">
          Дякуємо. Відгук надіслано на модерацію.
        </h2>
        <p className="mx-auto max-w-md text-ink-soft">
          Після перевірки він зʼявиться на сторінці компанії без ваших персональних даних.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Button href="/companies" variant="primary">
            До списку компаній
          </Button>
          <Button href="/add-review" variant="outline">
            Додати ще один відгук
          </Button>
        </div>
      </Card>
    );
  }

  const inputCls =
    "w-full rounded-xl border border-ink/12 bg-white px-3.5 py-2.5 text-sm focus-ring";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Honeypot — visually hidden; only bots fill this. If filled, the
          server silently discards the submission without saving. */}
      <div aria-hidden="true" style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}>
        <label htmlFor="hp-website">Website</label>
        <input
          id="hp-website"
          name="website"
          type="text"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          autoComplete="off"
          tabIndex={-1}
        />
      </div>
      {/* Progress */}
      <StepProgress step={step} />

      {/* ── Step 1: Ваш досвід ──────────────────────────────────────────────── */}
      {step === 1 && (
        <Card className="space-y-5 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel>Компанія</FieldLabel>
              <Controller
                control={control}
                name="company"
                render={({ field }) => (
                  <CompanyAutocomplete
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v);
                      // Reset the selected slug when the user edits the text
                      setSelectedCompanySlug(null);
                    }}
                    onSelect={(s) => {
                      field.onChange(s.name);
                      setSelectedCompanySlug(s.slug);
                    }}
                    placeholder="Напр. Нова Пошта"
                    className={inputCls}
                  />
                )}
              />
              {!selectedCompanySlug && watchedCompany?.trim().length > 1 && (
                <p className="text-xs text-ink-muted">
                  Якщо компанії немає у списку, ми додамо її після модерації відгуку.
                </p>
              )}
              {selectedCompanySlug && (
                <p className="text-xs text-brand-700">✓ Компанію знайдено в базі</p>
              )}
              <ErrorText msg={errors.company?.message} />
            </div>

            <div className="space-y-1.5">
              <FieldLabel>Місто</FieldLabel>
              <select
                {...register("city")}
                className={inputCls}
                defaultValue=""
              >
                <option value="" disabled>Оберіть місто</option>
                {CITIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <ErrorText msg={errors.city?.message} />
            </div>

            <div className="space-y-1.5">
              <FieldLabel>Посада або роль</FieldLabel>
              <Controller
                control={control}
                name="roleCategory"
                render={({ field }) => (
                  <RoleAutocomplete
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Напр. оператор відділення, слюсар, менеджер"
                    className={inputCls}
                    companyName={watchedCompany ?? ""}
                    companySlug={selectedCompanySlug ?? ""}
                  />
                )}
              />
              <p className="text-xs text-ink-muted">
                Можна обрати зі списку або ввести власний варіант.
              </p>
              <ErrorText msg={errors.roleCategory?.message} />
            </div>

            <div className="space-y-1.5">
              <FieldLabel>Рік досвіду</FieldLabel>
              <select
                {...register("year", { valueAsNumber: true })}
                className={inputCls}
              >
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
                <option value={2020}>Раніше</option>
              </select>
              <ErrorText msg={errors.year?.message} />
            </div>
          </div>

          <div className="space-y-1.5">
            <FieldLabel>Тип досвіду</FieldLabel>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <RadioPills
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: "employee", label: "Працював / працювала" },
                    { value: "interview", label: "Був / була на співбесіді" },
                    { value: "internship", label: "Проходив / проходила стажування" },
                    { value: "applicant", label: "Відгукувався, але не пішов" },
                  ]}
                />
              )}
            />
            <ErrorText msg={errors.type?.message} />
          </div>
        </Card>
      )}

      {/* ── Step 2: Реальні умови ───────────────────────────────────────────── */}
      {step === 2 && (
        <Card className="space-y-6 p-6">
          <p className="text-sm text-ink-muted">
            Якщо ви не працювали в компанії, вкажіть те, що вам обіцяли або пояснювали на
            співбесіді.
          </p>
          {/* Salary */}
          <div className="space-y-1.5">
            <FieldLabel>Зарплата збіглась з вакансією</FieldLabel>
            <Controller control={control} name="salaryMatch"
              render={({ field }) => (
                <RadioPills value={field.value} onChange={field.onChange}
                  options={[
                    { value: "yes", label: "Так" },
                    { value: "no", label: "Ні" },
                    { value: "partial", label: "Частково" },
                    { value: "unknown", label: "Не знаю" },
                  ]}
                />
              )}
            />
          </div>

          {/* Employment */}
          <div className="space-y-1.5">
            <FieldLabel>Оформлення</FieldLabel>
            <Controller control={control} name="officialEmployment"
              render={({ field }) => (
                <RadioPills value={field.value} onChange={field.onChange}
                  options={[
                    { value: "official_day_one", label: "Офіційне з першого дня" },
                    { value: "after_internship", label: "Після стажування" },
                    { value: "unofficial", label: "Неофіційне" },
                    { value: "unknown", label: "Не знаю" },
                  ]}
                />
              )}
            />
          </div>

          {/* Payment delay */}
          <div className="space-y-1.5">
            <FieldLabel>Були затримки виплат</FieldLabel>
            <Controller control={control} name="paymentDelay"
              render={({ field }) => (
                <RadioPills value={field.value} onChange={field.onChange}
                  options={[
                    { value: "yes", label: "Так" },
                    { value: "no", label: "Ні" },
                    { value: "unknown", label: "Не знаю" },
                  ]}
                />
              )}
            />
          </div>

          {/* Booking promised */}
          <div className="space-y-1.5">
            <FieldLabel>Бронювання обіцяли</FieldLabel>
            <Controller control={control} name="bookingPromised"
              render={({ field }) => (
                <RadioPills value={field.value} onChange={field.onChange}
                  options={[
                    { value: "yes", label: "Так" },
                    { value: "no", label: "Ні" },
                    { value: "not_applicable", label: "Не актуально" },
                  ]}
                />
              )}
            />
          </div>

          {/* Booking details — conditional */}
          {showBookingDetails && (
            <>
              <div className="space-y-1.5 border-l-2 border-brand-100 pl-4">
                <FieldLabel>Бронювання реально оформили</FieldLabel>
                <Controller control={control} name="bookingReceived"
                  render={({ field }) => (
                    <RadioPills value={field.value} onChange={field.onChange}
                      options={[
                        { value: "yes", label: "Так" },
                        { value: "no", label: "Ні" },
                        { value: "promised_later", label: "Обіцяли пізніше" },
                        { value: "unknown", label: "Не знаю" },
                        { value: "not_applicable", label: "Не актуально" },
                      ]}
                    />
                  )}
                />
              </div>

              <div className="space-y-1.5 border-l-2 border-brand-100 pl-4">
                <FieldLabel>Коли говорили подати на бронювання</FieldLabel>
                <Controller control={control} name="bookingTiming"
                  render={({ field }) => (
                    <RadioPills value={field.value} onChange={field.onChange}
                      options={[
                        { value: "immediately", label: "Одразу" },
                        { value: "after_probation", label: "Після випробувального" },
                        { value: "after_internship", label: "Після стажування" },
                        { value: "not_specified", label: "Не уточнювали" },
                      ]}
                    />
                  )}
                />
              </div>
            </>
          )}

          {/* Internship */}
          <div className="space-y-1.5">
            <FieldLabel>Було стажування</FieldLabel>
            <Controller control={control} name="hadInternship"
              render={({ field }) => (
                <RadioPills value={field.value} onChange={field.onChange}
                  options={[
                    { value: "yes", label: "Так" },
                    { value: "no", label: "Ні" },
                  ]}
                />
              )}
            />
          </div>

          {/* Internship paid — conditional */}
          {showInternshipPaid && (
            <div className="space-y-1.5 border-l-2 border-brand-100 pl-4">
              <FieldLabel>Стажування оплачували</FieldLabel>
              <Controller control={control} name="internshipPaid"
                render={({ field }) => (
                  <RadioPills value={field.value} onChange={field.onChange}
                    options={[
                      { value: "yes", label: "Так" },
                      { value: "no", label: "Ні" },
                      { value: "partial", label: "Частково" },
                      { value: "no_internship", label: "Не було стажування" },
                    ]}
                  />
                )}
              />
            </div>
          )}
        </Card>
      )}

      {/* ── Step 3: Оцінка і коментар ───────────────────────────────────────── */}
      {step === 3 && (
        <>
          {/* Ratings */}
          <Card className="space-y-4 p-6">
            <h3 className="font-display text-base font-bold text-ink">Оцінки</h3>
            <p className="text-xs text-ink-muted">1 — погано, 5 — добре</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["ratingSalary", "Зарплата"],
                  ["ratingSchedule", "Графік"],
                  ["ratingManagement", "Керівництво"],
                  ["ratingConditions", "Умови"],
                  ["ratingHonesty", "Чесність вакансії"],
                ] as const
              ).map(([name, label]) => (
                <div key={name} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-ink-soft">{label}</span>
                  <Controller
                    control={control}
                    name={name}
                    render={({ field }) => (
                      <StarRating value={field.value} onChange={field.onChange} />
                    )}
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* Comment */}
          <Card className="space-y-4 p-6">
            <h3 className="font-display text-base font-bold text-ink">Коментар</h3>
            <div className="space-y-1.5">
              <FieldLabel hint="Мінімум 30 символів. Не вказуйте імена, телефони, email, Telegram або документи.">
                Ваш досвід
              </FieldLabel>
              <textarea
                {...register("text")}
                rows={6}
                placeholder="Опишіть свій досвід без імен, телефонів, Telegram, email або документів."
                className="w-full rounded-xl border border-ink/12 bg-white px-3.5 py-3 text-sm focus-ring"
              />
              <div className="flex items-start justify-between gap-2">
                <ErrorText msg={errors.text?.message} />
                <span className={cn(
                  "ml-auto shrink-0 text-xs tabular-nums",
                  text.length === 0 ? "text-ink-muted" :
                  text.length < 30 ? "text-amber-600" : "text-brand-700"
                )}>
                  {text.length} / мінімум 30 символів
                </span>
              </div>
              {hasContacts && (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Не вказуйте персональні контакти у відкритому тексті. Видаліть телефон,
                    email або месенджер.
                  </span>
                </div>
              )}
              {!hasContacts && isLowQuality && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Напишіть змістовний відгук про досвід роботи або співбесіди.</span>
                </div>
              )}
            </div>
          </Card>

          {/* Safety */}
          <Card className="space-y-4 p-6">
            <h3 className="font-display text-base font-bold text-ink">Безпека</h3>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-soft">
              <input
                type="checkbox"
                {...register("noPersonalData")}
                className="mt-0.5 h-4 w-4 rounded border-ink/30 text-brand-600 focus-ring"
              />
              <span>
                Я не вказую персональні дані, імена, телефони, Telegram, email або документи
                у відкритому тексті.
              </span>
            </label>
            <ErrorText msg={errors.noPersonalData?.message} />
            <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-soft">
              <input
                type="checkbox"
                {...register("willConfirmLater")}
                className="mt-0.5 h-4 w-4 rounded border-ink/30 text-brand-600 focus-ring"
              />
              <span>Я готовий / готова підтвердити досвід пізніше, якщо це буде потрібно.</span>
            </label>
          </Card>
        </>
      )}

      {/* ── Navigation ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {step > 1 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStep((s) => s - 1)}
            >
              <ChevronLeft className="h-4 w-4" /> Назад
            </Button>
          )}

          {step < TOTAL_STEPS && (
            <Button type="button" onClick={() => void goNext()}>
              Далі <ChevronRight className="h-4 w-4" />
            </Button>
          )}

          {step === TOTAL_STEPS && (
            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting || hasContacts || isLowQuality}
            >
              {isSubmitting ? "Збереження…" : "Надіслати на модерацію"}
            </Button>
          )}
        </div>

        {step === TOTAL_STEPS && hasContacts && (
          <p className="text-xs text-red-600">
            Видаліть персональні контакти з коментаря, щоб надіслати відгук.
          </p>
        )}
        {submitError && (
          <p className="text-xs text-red-600">{submitError}</p>
        )}
        {step === TOTAL_STEPS && (
          <p className="text-xs text-ink-muted">
            Відгуки публікуються анонімно після модерації.
          </p>
        )}
      </div>
    </form>
  );
}
