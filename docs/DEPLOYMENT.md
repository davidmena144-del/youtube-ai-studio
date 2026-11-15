# النشر السحابي (من الموبايل، بدون كمبيوتر)

> لم يُنشأ أي حساب أو مورد سحابي حتى الآن. الخطوات أدناه تُنفذ بموافقتك، وكلها ضمن طبقات مجانية.
> يمكنك أيضًا أن تطلب من Claude Code تنفيذ الخطوات التي تدعمها أدواته (مثل Vercel و Supabase) بعد موافقتك.

## 1. قاعدة البيانات (اختر واحدة)

- **Neon** (neon.tech): أنشئ مشروعًا → انسخ "Pooled connection string".
- **Supabase** (supabase.com): أنشئ مشروعًا → Project Settings → Database → Connection string (Transaction pooler، المنفذ 6543).
  ملاحظة: مشاريع Supabase المجانية تتوقف بعد أسبوع بلا نشاط ويمكن إعادة تشغيلها من اللوحة.

هذا هو `DATABASE_URL`.

## 2. الأسرار

من جلسة Claude Code اطلب: "ولّد الأسرار" (يشغّل `npm run gen-secrets` و `npm run hash-password`).
احتفظ بالقيم في مدير كلمات مرور. لا تلصقها في أي ملف داخل المستودع.

## 3. الواجهة على Vercel (Hobby — مجاني للاستخدام الشخصي)

1. vercel.com → Add New Project → استورد هذا المستودع من GitHub.
2. Environment Variables: `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_PASSWORD_HASH`، واختياريًا `ANTHROPIC_API_KEY`, `CRON_SECRET`, `ENCRYPTION_KEY`.
3. Deploy. ثم افتح الرابط على Android → قائمة المتصفح → "إضافة إلى الشاشة الرئيسية".

الـ migrations تُطبق عبر GitHub Actions (الخطوة 4) أو بتشغيل `npm run db:migrate` من جلسة Claude Code مع `DATABASE_URL`.

## 4. الـ Worker على GitHub Actions (مجاني)

1. GitHub → Settings → Secrets and variables → Actions:
   - Secrets: `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_PASSWORD_HASH`، واختياريًا `ANTHROPIC_API_KEY`, `ENCRYPTION_KEY`.
   - Variables: `WORKER_ENABLED` = `true`.
2. Actions → Worker → Run workflow (للتشغيل الفوري)، ويعمل تلقائيًا كل ساعتين.

**بدائل** للمعالجة الأسرع:
- استدعاء `GET /api/worker/tick` مع ترويسة `Authorization: Bearer <CRON_SECRET>` من مُجدول مجاني مثل cron-job.org (كل 5 دقائق). كل استدعاء يعالج حتى ~45 ثانية من المهام.
- حاوية دائمة (Render / Fly / Railway، ~5–7$ شهريًا) بالـ `Dockerfile` الموجود: `npm run worker`.

## 5. تفعيل Claude (اختياري — مدفوع حسب الاستخدام)

أضف `ANTHROPIC_API_KEY` في Vercel وفي GitHub Secrets. لوحة الإعدادات ستعرض "مُعدّ — لم يُختبر" حتى تنجح أول مرحلة فعليًا، ثم "مُختبر ويعمل". ابدأ بمشروع Short قصير لاختبار التكلفة، ويمكنك اختيار Haiku من الإعدادات لأقل تكلفة.
