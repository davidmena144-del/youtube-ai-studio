"use client";

import { useState } from "react";
import { createProjectAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, input } from "@/components/ui";

type Defaults = { language: "ar" | "en"; tone: string; longSec: number; shortSec: number };

export function NewProjectForm({ defaults }: { defaults: Defaults }) {
  const [format, setFormat] = useState<"long" | "short">("long");
  const [duration, setDuration] = useState(defaults.longSec);

  const pick = (f: "long" | "short") => {
    setFormat(f);
    setDuration(f === "long" ? defaults.longSec : defaults.shortSec);
  };

  return (
    <ActionForm action={createProjectAction} className="space-y-4">
      <Field label="موضوع المحتوى" hint="أنت من يحدد الموضوع. كن محددًا قدر الإمكان.">
        <textarea name="topic" required minLength={3} maxLength={500} rows={3} className={input} placeholder="مثال: كيف تبني عادة القراءة اليومية في 30 يومًا" />
      </Field>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">النوع</legend>
        <input type="hidden" name="format" value={format} />
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["long", "فيديو طويل", "16:9 · فصول · وصف مفصل"],
              ["short", "YouTube Short", "9:16 · حتى 3 دقائق"],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              onClick={() => pick(value)}
              aria-pressed={format === value}
              className={`rounded-xl border p-3 text-start ${format === value ? "border-accent bg-accent/5 ring-2 ring-accent/20" : "border-line bg-surface"}`}
            >
              <span className="block font-semibold">{label}</span>
              <span className="block text-xs text-muted">{hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <Field label="المدة المستهدفة (ثانية)" hint={`≈ ${Math.round(duration / 6) / 10} دقيقة`}>
          <input
            name="targetDurationSec"
            type="number"
            inputMode="numeric"
            required
            min={15}
            max={format === "short" ? 180 : 3600}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className={input}
          />
        </Field>
        <Field label="اللغة">
          <select name="language" defaultValue={defaults.language} className={input}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </Field>
      </div>

      <details className="rounded-xl border border-line bg-surface p-3">
        <summary className="text-sm font-medium">خيارات إضافية</summary>
        <div className="mt-3 space-y-3">
          <Field label="الأسلوب">
            <input name="tone" defaultValue={defaults.tone} maxLength={200} className={input} />
          </Field>
          <Field label="الجمهور المستهدف">
            <input name="audience" maxLength={300} className={input} placeholder="مثال: طلاب الجامعة المبتدئون" />
          </Field>
          <Field label="ملاحظات للوكلاء">
            <textarea name="notes" rows={3} maxLength={2000} className={input} placeholder="نقاط يجب ذكرها، أشياء يجب تجنبها…" />
          </Field>
          <Field label="موعد النشر المقترح (اختياري)" hint="بتوقيت المنطقة الزمنية في الإعدادات">
            <input name="scheduledPublishAt" type="datetime-local" className={input} />
          </Field>
        </div>
      </details>

      <SubmitButton className="w-full">ابدأ الإنتاج</SubmitButton>
      <p className="text-center text-xs text-muted">لن يُنشر أي شيء قبل مراجعتك وموافقتك.</p>
    </ActionForm>
  );
}
