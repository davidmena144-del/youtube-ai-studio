export const PROJECT_STATUS_LABEL: Record<string, string> = {
  draft: "مسودة",
  queued: "في الطابور",
  in_progress: "قيد الإنتاج",
  failed: "فشل",
  awaiting_review: "بانتظار مراجعتك",
  changes_requested: "تعديلات مطلوبة",
  approved: "موافق عليه",
  publishing: "جارٍ النشر",
  published: "منشور",
  cancelled: "ملغى",
};

export const STATUS_TONE: Record<string, "gray" | "blue" | "amber" | "green" | "red" | "violet"> = {
  draft: "gray",
  queued: "blue",
  in_progress: "blue",
  failed: "red",
  awaiting_review: "amber",
  changes_requested: "violet",
  approved: "green",
  publishing: "blue",
  published: "green",
  cancelled: "gray",
  // jobs
  running: "blue",
  succeeded: "green",
  dead: "red",
  // history
  info: "gray",
  warn: "amber",
  error: "red",
  // publications
  pending: "blue",
  uploading: "blue",
};

export const JOB_STATUS_LABEL: Record<string, string> = {
  queued: "في الانتظار",
  running: "قيد التنفيذ",
  succeeded: "نجحت",
  failed: "فشلت",
  dead: "متوقفة",
  cancelled: "ملغاة",
};

export const FORMAT_LABEL = { long: "فيديو طويل", short: "Short" } as const;

export const STAGE_LABEL: Record<string, string> = {
  research: "البحث",
  script: "السيناريو",
  direction: "الإخراج",
  seo: "SEO",
  qa: "مراجعة الجودة",
};

export const SEVERITY_LABEL = { blocker: "حرج", major: "مهم", minor: "ثانوي" } as const;
