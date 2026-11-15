# النشر السحابي (من الموبايل، بدون كمبيوتر)

> لم يُنشأ أي حساب أو مورد سحابي حتى الآن. الخطوات أدناه تُنفذ بموافقتك، وكلها ضمن طبقات مجانية.
> ما اختُبر فعليًا وما لم يُختبر: راجع [`REVIEW-PHASE1.md`](REVIEW-PHASE1.md).

## ما تحتاجه (كله مجاني)

| # | الخدمة | الغرض | ما يُنسخ منها |
|---|---|---|---|
| 1 | GitHub (موجود) | الكود + CI + الـ Worker | — |
| 2 | Neon **أو** Supabase | PostgreSQL | `DATABASE_URL` (رابط الـ pooler) |
| 3 | Vercel (Hobby) | الواجهة | رابط التطبيق |
| 4 | Anthropic Console (اختياري، مدفوع حسب الاستخدام) | محتوى حقيقي | `ANTHROPIC_API_KEY` |

## 0. شرط مسبق: دمج الفرع في `main`

GitHub لا يشغّل workflow الـ Worker (المجدول أو اليدوي) إلا من الفرع الافتراضي. ادمج هذا الفرع في `main` بعد مراجعتك (Pull Request من تطبيق GitHub على الموبايل).

## 1. قاعدة البيانات

- **Neon**: أنشئ مشروعًا → انسخ *Pooled connection string*.
- **Supabase**: Project Settings → Database → Connection string → *Transaction pooler* (المنفذ 6543).
  مشاريع Supabase المجانية تتوقف بعد أسبوع بلا نشاط وتُعاد من اللوحة.

## 2. الأسرار

اطلب من Claude Code: «ولّد الأسرار». سيشغّل `npm run gen-secrets` و `npm run hash-password -- "<كلمة مرور طويلة تختارها>"`.
احفظ القيم في مدير كلمات مرور. **في الإنتاج يجب استخدام `ADMIN_PASSWORD_HASH`؛ التطبيق يرفض كلمة المرور النصية.**

## 3. الواجهة على Vercel

1. vercel.com → Add New Project → استورد المستودع.
2. Environment Variables (Production):
   - `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_PASSWORD_HASH` — إلزامية
   - `LLM_PROVIDER` = `mock` أو `anthropic` (اضبطها صراحةً، وبنفس القيمة في GitHub)
   - `ANTHROPIC_API_KEY` — فقط إن كان `LLM_PROVIDER=anthropic`
   - `CRON_SECRET`, `ENCRYPTION_KEY` — اختيارية الآن
3. Deploy. ثم على Android: افتح الرابط في Chrome → ⋮ → «إضافة إلى الشاشة الرئيسية».

## 4. الـ Worker على GitHub Actions

Settings → Secrets and variables → Actions:
- **Secrets**: `DATABASE_URL` (إلزامي)، `ANTHROPIC_API_KEY` (إن استخدمت Claude). لا يحتاج الـ Worker إلى `SESSION_SECRET` ولا كلمة المرور.
- **Variables**: `WORKER_ENABLED=true`، `LLM_PROVIDER=mock|anthropic`.

ثم Actions → Worker → Run workflow. يطبّق الـ migrations ثم يعالج الطابور، ويعمل تلقائيًا كل ساعتين.

**بدائل أسرع:**
- حاوية دائمة بالـ `Dockerfile` (Render/Fly/Railway، ~5–7$ شهريًا — لن أنشئها دون موافقتك): `npm run worker`.
- `GET /api/worker/tick` مع `Authorization: Bearer <CRON_SECRET>` من مُجدول مجاني. **مناسب لوضع mock فقط**: مرحلة Claude حقيقية قد تتجاوز حد 60 ثانية للدالة.

## 5. التحقق بعد النشر

1. `https://<app>/api/health` يجب أن يعيد `{"ok":true,"db":true}`.
2. سجّل الدخول، أنشئ Short، شغّل Worker يدويًا، وتأكد أن المشروع يصل إلى «بانتظار مراجعتك».
3. صفحة الإعدادات: Claude يظهر «مُعدّ — لم يُختبر» حتى تنجح أول مرحلة فعلًا، ثم «مُختبر ويعمل».
