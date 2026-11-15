import type { Metadata } from "next";
import { updateSettingsAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Field, input, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { getSettingsForAdmin, providerStatus, type ProviderState } from "@/server/queries";
import { CLAUDE_MODELS, EFFORT_LEVELS } from "@/server/settings";

export const metadata: Metadata = { title: "الإعدادات" };

const STATE: Record<ProviderState, { label: string; tone: "green" | "amber" | "gray" | "blue" | "red" }> = {
  active: { label: "يعمل", tone: "green" },
  tested: { label: "مُختبر ويعمل", tone: "green" },
  configured_untested: { label: "مُعدّ — لم يُختبر بعد", tone: "amber" },
  missing: { label: "غير مُعدّ", tone: "gray" },
  not_built: { label: "لم يُبنَ بعد", tone: "gray" },
};

const TIME_ZONES = ["UTC", "Asia/Riyadh", "Asia/Dubai", "Africa/Cairo", "Asia/Amman", "Asia/Baghdad", "Africa/Casablanca", "Africa/Algiers", "Europe/Istanbul", "Europe/London", "America/New_York"];

function Row({ name, state, note }: { name: string; state: ProviderState; note?: string }) {
  const s = STATE[state];
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div>
        <p className="font-medium">{name}</p>
        {note ? <p className="text-xs text-muted">{note}</p> : null}
      </div>
      <Badge tone={s.tone}>{s.label}</Badge>
    </div>
  );
}

export default async function SettingsPage() {
  const [s, ps] = await Promise.all([getSettingsForAdmin(), providerStatus()]);
  const tzs = TIME_ZONES.includes(s.timeZone) ? TIME_ZONES : [s.timeZone, ...TIME_ZONES];
  return (
    <>
      <PageHeader title="الإعدادات" />

      <h2 className="mb-2 font-semibold">حالة المزودين والتكاملات</h2>
      <Card className="mb-6 divide-y divide-line py-1 text-sm">
        <Row name="قاعدة البيانات (PostgreSQL)" state="active" />
        <Row
          name="LLM — وضع تجريبي (mock)"
          state={ps.llm.active === "mock" ? "active" : "missing"}
          note="مجاني، بلا شبكة. ينتج محتوى قالبيًا معلّمًا بوضوح — للاختبار فقط"
        />
        <Row
          name="LLM — Claude API"
          state={ps.llm.anthropic}
          note={
            ps.llm.lastAnthropicSuccess
              ? `آخر نجاح ${formatDateTime(ps.llm.lastAnthropicSuccess, s.timeZone)} (${ps.llm.lastAnthropicModel})`
              : "يُفعّل بوضع ANTHROPIC_API_KEY في متغيرات البيئة لدى المستضيف"
          }
        />
        <Row name="النشر التجريبي (dry-run)" state="active" note="يتحقق من بيانات الرفع دون أي اتصال بـ YouTube" />
        <Row name="YouTube Data API" state={ps.publishing.youtube} note="المرحلة 3" />
        <Row name="الصوت (TTS) · الترجمة · الفيديو · الصورة المصغرة" state="not_built" note="المرحلة 2" />
        <Row name="تشفير الأسرار المخزنة (ENCRYPTION_KEY)" state={ps.encryptionKey ? "active" : "missing"} note="مطلوب من المرحلة 3 لحفظ رمز YouTube" />
        <Row name="مشغّل خارجي للـ Worker (CRON_SECRET)" state={ps.cronSecret ? "active" : "missing"} note="اختياري — لاستدعاء /api/worker/tick" />
        <Row name="كلمة المرور مخزنة كـ hash" state={ps.passwordHashed ? "active" : "missing"} note="يُنصح باستخدام ADMIN_PASSWORD_HASH بدل ADMIN_PASSWORD" />
      </Card>

      <ActionForm action={updateSettingsAction} className="space-y-6">
        <section className="space-y-3">
          <h2 className="font-semibold">القناة</h2>
          <Field label="اسم القناة">
            <input name="channelName" defaultValue={s.channelName} maxLength={100} className={input} />
          </Field>
          <Field label="وصف القناة وأسلوبها" hint="يساعد الوكلاء على الحفاظ على هوية ثابتة (المرحلة 2 تستخدمه في المصغرات أيضًا)">
            <textarea name="channelDescription" defaultValue={s.channelDescription} rows={3} maxLength={1000} className={input} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="اللغة الافتراضية">
              <select name="defaultLanguage" defaultValue={s.defaultLanguage} className={input}>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field label="المنطقة الزمنية">
              <select name="timeZone" defaultValue={s.timeZone} className={input}>
                {tzs.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="الأسلوب الافتراضي">
            <input name="defaultTone" defaultValue={s.defaultTone} maxLength={200} className={input} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="مدة الفيديو الطويل (ث)">
              <input name="longTargetSec" type="number" inputMode="numeric" min={120} max={3600} defaultValue={s.longTargetSec} className={input} />
            </Field>
            <Field label="مدة الـ Short (ث)">
              <input name="shortTargetSec" type="number" inputMode="numeric" min={15} max={180} defaultValue={s.shortTargetSec} className={input} />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">الذكاء الاصطناعي</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="نموذج Claude" hint="Opus أعلى جودة؛ Haiku الأرخص">
              <select name="llmModel" defaultValue={s.llmModel} className={input} dir="ltr">
                {CLAUDE_MODELS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="مستوى الجهد (effort)" hint="أعلى = أدق وأغلى">
              <select name="llmEffort" defaultValue={s.llmEffort} className={input} dir="ltr">
                {EFFORT_LEVELS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">الجودة والنشر</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الحد الأدنى لدرجة الجودة">
              <input name="qaMinScore" type="number" inputMode="numeric" min={0} max={100} defaultValue={s.qaMinScore} className={input} />
            </Field>
            <Field label="إعادات الكتابة التلقائية">
              <input name="qaMaxAutoRevisions" type="number" inputMode="numeric" min={0} max={3} defaultValue={s.qaMaxAutoRevisions} className={input} />
            </Field>
          </div>
          <Field label="الخصوصية الافتراضية عند الرفع" hint="يُنصح بـ «خاص» حتى تتأكد من النتيجة">
            <select name="defaultPrivacy" defaultValue={s.defaultPrivacy} className={input}>
              <option value="private">خاص</option>
              <option value="unlisted">غير مدرج</option>
              <option value="public">عام</option>
            </select>
          </Field>
        </section>

        <SubmitButton className="w-full">حفظ الإعدادات</SubmitButton>
      </ActionForm>

      <p className="mt-6 text-xs text-muted">
        مفاتيح API لا تُدخل من هنا ولا تُخزن في قاعدة البيانات: تُضاف كمتغيرات بيئة لدى مزود الاستضافة فقط، ولا تصل إلى المتصفح أبدًا.
      </p>
    </>
  );
}
