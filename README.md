# YouTube AI Studio

نظام سحابي لإدارة وإنتاج ونشر محتوى YouTube (فيديوهات طويلة و Shorts) عبر وكلاء ذكاء اصطناعي يديرهم **Claude Manager**، مع مراجعة وموافقة بشرية قبل أي نشر. الواجهة عربية، تبدأ من الموبايل، وتعمل كتطبيق PWA على Android.

- الخطة المعمارية والمراحل والتكاليف: [`docs/PLAN.md`](docs/PLAN.md)
- خطوات النشر السحابي (بدون كمبيوتر): [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- تقرير المراجعة النهائية للمرحلة 1: [`docs/REVIEW-PHASE1.md`](docs/REVIEW-PHASE1.md)

## الحالة الحالية: المرحلة 1

| المكوّن | الحالة |
|---|---|
| قاعدة البيانات + migrations | ✅ مبني ومختبر (Postgres 16 و PGlite) |
| طابور المهام: إعادة المحاولة، backoff، استرجاع المهام العالقة، idempotency | ✅ مبني ومختبر |
| Claude Manager + 5 وكلاء (بحث، كتابة، إخراج، SEO، جودة) | ✅ مبني ومختبر بمزود mock |
| مزود Claude API الحقيقي | ⚠️ مختبر عبر الـ SDK الرسمي مقابل خادم محاكٍ؛ **لم يُختبر مع خوادم Anthropic** (لا يوجد مفتاح) |
| المراجعة والموافقة / طلب التعديل / إعادة الكتابة التلقائية عند فشل QA | ✅ مبني ومختبر |
| النشر التجريبي (dry-run) ومنع تكرار النشر | ✅ مبني ومختبر — **لا يوجد نشر حقيقي** |
| الواجهة: الدخول، لوحة التحكم، المشاريع، التقويم، السجل، المهام، الإعدادات | ✅ مختبرة في متصفح بمقاس Pixel 7 |
| المصادقة، حد المحاولات، تشفير AES-GCM، ترويسات الأمان | ✅ مبني ومختبر |
| Dockerfile | ✅ بُني وشُغّل فعليًا (عدا تثبيت ffmpeg — حجب شبكة بيئة الاختبار) |
| workflow الـ worker على GitHub Actions / النشر على Vercel | ⚠️ مراجَع ومصحح، لم يُشغَّل بعد (يتطلب الدمج في main وحسابات) |
| الصوت، الترجمة، الفيديو، الصورة المصغرة | ⏳ المرحلة 2 |
| رفع وجدولة YouTube الحقيقية | ⏳ المرحلة 3 |

## كيف يعمل

```
موضوعك ─▶ Claude Manager ─▶ البحث ─▶ السيناريو ─▶ الإخراج ─▶ SEO ─▶ مراجعة الجودة
                                         ▲                                   │
                                         └──── إعادة كتابة تلقائية إن فشل ◀──┘
                                                                             ▼
                                   مراجعتك: موافقة ─▶ نشر (تجريبي حاليًا) │ طلب تعديل ─▶ يعاد من المرحلة التي تختارها
```

كل مرحلة مهمة مستقلة في طابور Postgres، تُحفظ مخرجاتها بإصدارات، وتُسجل كل عملية في History.

## البنية

```
src/
  app/                 واجهة Next.js (صفحات + Server Actions + API)
  components/          مكونات الواجهة
  proxy.ts             حماية الصفحات (إعادة توجيه لصفحة الدخول)
  server/
    agents/            الوكلاء: research · script · director · seo · qa
    manager/           Claude Manager وتعريف خط الإنتاج
    providers/llm/     mock · anthropic   (قابلة للاستبدال)
    providers/publisher/ dry-run           (YouTube الحقيقي في المرحلة 3)
    queue/             الطابور والأخطاء
    security/          كلمات المرور، الجلسات، التشفير
    worker/            معالج المهام
    db/                مخطط Drizzle
scripts/               worker · migrate · hash-password · gen-secrets
drizzle/               ملفات SQL للـ migrations
tests/                 اختبارات Vitest على Postgres حقيقي داخل الذاكرة
```

## الأوامر

| الأمر | الوظيفة |
|---|---|
| `npm run dev` / `build` / `start` | الواجهة |
| `npm run worker` | Worker مستمر (للحاويات) |
| `npm run worker:once` | يفرغ الطابور ثم يخرج (GitHub Actions / cron) |
| `npm run db:migrate` | تطبيق الـ migrations |
| `npm run db:generate` | توليد migration بعد تعديل المخطط |
| `npm test` · `npm run lint` · `npm run typecheck` | الفحوص |
| `npm run gen-secrets` | توليد SESSION_SECRET و ENCRYPTION_KEY و CRON_SECRET |
| `npm run hash-password -- "..."` | توليد ADMIN_PASSWORD_HASH |

متغيرات البيئة موثقة في [`.env.example`](.env.example).

## مبادئ الأمان

- المفاتيح في متغيرات البيئة لدى المستضيف فقط؛ لا تُخزن في القاعدة كنص ولا تصل إلى المتصفح.
- الأسرار التي يجب حفظها (رمز YouTube لاحقًا) تُشفر بـ AES-256-GCM.
- كل Server Action يتحقق من الجلسة بنفسه؛ السجل يحجب أي حقل يشبه سرًا.
- لا نشر حقيقي إلا بعد بناء المرحلة 3 واختبارها معك وتفعيلها صراحة.
