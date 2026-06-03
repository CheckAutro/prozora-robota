import { z } from "zod";

export const reviewSchema = z.object({
  // Section 1 — experience
  company: z.string().min(2, "Вкажіть назву компанії").max(120, "Назва компанії завелика"),
  city: z.string().min(2, "Вкажіть місто").max(80, "Назва міста завелика"),
  roleCategory: z.string().min(2, "Вкажіть сферу або посаду").max(120, "Посада завелика"),
  type: z.enum(["employee", "interview", "internship", "applicant"], {
    errorMap: () => ({ message: "Оберіть тип досвіду" }),
  }),
  year: z
    .number({ invalid_type_error: "Вкажіть рік" })
    .int()
    .min(2015, "Рік замалий")
    .max(new Date().getFullYear(), "Рік не може бути у майбутньому"),

  // Section 2 — salary & employment
  salaryMatch: z.enum(["yes", "no", "partial", "unknown"]),
  officialEmployment: z.enum([
    "official_day_one",
    "after_internship",
    "unofficial",
    "unknown",
  ]),
  paymentDelay: z.enum(["yes", "no", "unknown"]),

  // Section 3 — booking
  bookingPromised: z.enum(["yes", "no", "not_applicable"]),
  bookingReceived: z.enum(["yes", "no", "promised_later", "unknown", "not_applicable"]),
  bookingTiming: z.enum([
    "immediately",
    "after_probation",
    "after_internship",
    "not_specified",
  ]),

  // Section 4 — internship
  hadInternship: z.enum(["yes", "no"]),
  internshipPaid: z.enum(["yes", "no", "partial", "no_internship"]),

  // Section 5 — ratings 1..5
  ratingSalary: z.number().min(1).max(5),
  ratingSchedule: z.number().min(1).max(5),
  ratingManagement: z.number().min(1).max(5),
  ratingConditions: z.number().min(1).max(5),
  ratingHonesty: z.number().min(1).max(5),

  // Section 6 — comment
  text: z.string().min(30, "Опишіть досвід детальніше (мінімум 30 символів)").max(3000, "Коментар занадто довгий (максимум 3000 символів)"),

  // Section 7 — safety
  noPersonalData: z.literal(true, {
    errorMap: () => ({ message: "Підтвердьте, що не вказуєте персональні дані" }),
  }),
  willConfirmLater: z.boolean().optional(),
});

export type ReviewFormValues = z.infer<typeof reviewSchema>;

export const defaultReviewValues: Partial<ReviewFormValues> = {
  company: "",
  city: "",
  roleCategory: "",
  year: new Date().getFullYear(),
  salaryMatch: "unknown",
  officialEmployment: "unknown",
  paymentDelay: "unknown",
  bookingPromised: "not_applicable",
  bookingReceived: "not_applicable",
  bookingTiming: "not_specified",
  hadInternship: "no",
  internshipPaid: "no_internship",
  ratingSalary: 3,
  ratingSchedule: 3,
  ratingManagement: 3,
  ratingConditions: 3,
  ratingHonesty: 3,
  willConfirmLater: false,
};
