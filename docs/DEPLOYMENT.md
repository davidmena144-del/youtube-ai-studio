# النشر السحابي (من الموبايل، بدون كمبيوتر)

> لم يُنشأ أي حساب أو مورد سحابي حتى الآن. الخطوات أدناه تُنفذ بموافقتك، وكلها ضمن طبقات مجانية.
> ما اختُبر فعليًا وما لم يُختبر: راجع [`REVIEW-PHASE1.md`](REVIEW-PHASE1.md).

## ما تحتاجه (كله مجاني)

| # | الخدمة | الغرض | ما يُنسخ منها |
|---|---|---|---|
| 1 | GitHub (موجود) | الكود + CI + الـ Worker | — |
| 2 | Neon **أو** Supabase | PostgreSQL | `DATABASE_URL` (رابط الـ pooler) + `MIGRATION_DATABASE_URL` (الرابط المباشر) |
| 3 | Vercel (Hobby) | الواجهة | رابط التطبيق |
| 4 | Anthropic Console (اختياري، مدفوع حسب الاستخدام) | محتوى حقيقي | `ANTHROPIC_API_KEY` |

## 0. شرط مسبق: دمج الفرع في `main`

GitHub لا يشغّل workflow الـ Worker (المجدول أو اليدوي) إلا من الفرع الافتراضي. ادمج هذا الفرع في `main` بعد مراجعتك (Pull Request من تطبيق GitHub على الموبايل).

## 1. قاعدة البيانات

انسخ رابطين من لوحة المزوّد:

| المزوّد | `DATABASE_URL` (للتطبيق والـ Worker) | `MIGRATION_DATABASE_URL` (للـ migrations فقط) |
|---|---|---|
| **Neon** | *Pooled connection string* (يحتوي `-pooler`) | الرابط نفسه **بدون** `-pooler` (Direct) |
| **Supabase** | *Transaction pooler* (المنفذ 6543) | *Direct connection* أو *Session pooler* (المنفذ 5432) |

لماذا رابطان؟ قفل الـ migrations لا يعمل بشكل موثوق عبر pooler بنمط المعاملات. لذلك يرفض أمر `db:migrate` العمل برابط pooled، ويطلب `MIGRATION_DATABASE_URL` برسالة واضحة.
مشاريع Supabase المجانية تتوقف بعد أسبوع بلا نشاط، وتُعاد من اللوحة.

## 2. الأسرار

اطلب من Claude Code: «ولّد الأسرار». سيشغّل `npm run gen-secrets` و `npm run hash-password -- "<كلمة مرور طويلة تختارها>"`.
احفظ القيم في مدير كلمات مرور. **في الإنتاج يجب استخدام `ADMIN_PASSWORD_HASH`؛ التطبيق يرفض كلمة المرور النصية.**

## 3. الواجهة على Vercel

1. vercel.com → Add New Project → استورد المستودع.
2. Environment Variables (Production):
   - `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_PASSWORD_HASH` — إلزامية
   - `LLM_PROVIDER` = `mock` أو `anthropic` — **إلزامية في الإنتاج**: التطبيق يرفض العمل بدونها بدل أن يستخدم mock بصمت. استخدم القيمة نفسها في GitHub
   - `ANTHROPIC_API_KEY` — فقط إن كان `LLM_PROVIDER=anthropic`
   - `CRON_SECRET`, `ENCRYPTION_KEY` — اختيارية الآن
   - `TRUSTED_IP_HEADER` — غير مطلوبة على Vercel (يُكتشف تلقائيًا). على Fly اضبطها `fly-client-ip`، وخلف Cloudflare `cf-connecting-ip`. إن لم تُضبط على مستضيف آخر يُستخدم آخر عنوان في `X-Forwarded-For`
3. Deploy. ثم على Android: افتح الرابط في Chrome → ⋮ → «إضافة إلى الشاشة الرئيسية».

## 4. الـ Worker على GitHub Actions

Settings → Secrets and variables → Actions:
- **Secrets**:
  - `DATABASE_URL` — إلزامي.
  - `MIGRATION_DATABASE_URL` — إلزامي إذا كان `DATABASE_URL` رابط pooler.
  - `ANTHROPIC_API_KEY` — إن استخدمت Claude.
  - لا يحتاج الـ Worker إلى `SESSION_SECRET` ولا كلمة المرور.
- **Variables**:
  - `WORKER_ENABLED=true`
  - `LLM_PROVIDER=mock|anthropic` — إلزامي؛ الـ Worker يفشل برسالة واضحة إن غاب.

ثم Actions → Worker → Run workflow. يطبّق الـ migrations ثم يعالج الطابور، ويعمل تلقائيًا كل ساعتين.

**حدود الوقت (مضبوطة مسبقًا في `worker.yml`):**
- **ميزانية الـ Worker:** 25 دقيقة داخل مهلة job قدرها 30 دقيقة.
- **مهلة كل استدعاء Claude:** 10 دقائق، وتشمل قراءة الرد المتدفق كاملًا.
- **بدء المهام:** لا تبدأ مهمة جديدة إن بقي أقل من 12 دقيقة، فلا يُقطع استدعاء مدفوع في منتصفه.

**بدائل أسرع:**
- حاوية دائمة بالـ `Dockerfile` (Render/Fly/Railway، ~5–7$ شهريًا — لن أنشئها دون موافقتك): `npm run worker`.
- `GET /api/worker/tick` مع `Authorization: Bearer <CRON_SECRET>` من مُجدول مجاني. **يعمل مع `LLM_PROVIDER=mock` فقط.** مع `anthropic` يرفض بدء أي عمل (رد 409)، لأن مرحلة Claude قد تتجاوز حد 60 ثانية للدالة فتُدفع ثم تضيع.

## 5. التحقق بعد النشر

1. `https://<app>/api/health` يجب أن يعيد `{"ok":true,"db":true}`.
2. سجّل الدخول، أنشئ Short، شغّل Worker يدويًا، وتأكد أن المشروع يصل إلى «بانتظار مراجعتك».
3. صفحة الإعدادات: Claude يظهر «مُعدّ — لم يُختبر» حتى تنجح أول مرحلة فعلًا، ثم «مُختبر ويعمل».
