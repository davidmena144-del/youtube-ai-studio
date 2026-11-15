# التفعيل — الخطوات المتبقية عليك (مرة واحدة فقط)

كل شيء هنا مجاني. لا تُدخل بطاقة دفع في أي خدمة. إن طلبت خدمة بطاقة فتوقف، فهذا خارج الخطة.

## ما تم بالفعل (لا تفعل شيئًا هنا)

- **قاعدة البيانات:** مشروع Supabase المجاني "davidmena144-del's Project".
  - ثُبّتت فيه كل الجداول والدوال (migrations من 0000 إلى 0006) بموافقتك.
  - اختُبرت هناك فعليًا.
  - سُحبت كل صلاحيات الوصول العام (anon) من الجداول والدوال.
- **سجل القناة:** أُنشئ بالسياسة المستقلة الافتراضية:
  - نشر تلقائي؛
  - Short واحد كحد أقصى كل 12 ساعة، 3 أسبوعيًا؛
  - فيديو طويل واحد أسبوعيًا.

## 1. Google Cloud (لربط YouTube) — حوالي 10 دقائق من المتصفح

1. افتح console.cloud.google.com وأنشئ مشروعًا جديدًا (مجاني).
2. من **APIs & Services → Library** فعّل:
   - **YouTube Data API v3**
   - **YouTube Analytics API**
3. من **OAuth consent screen**:
   - النوع **External**؛
   - اسم التطبيق: أي اسم؛
   - أضف بريدك.
   - ثم اضغط **Publish app** لتصبح الحالة **In production**. بدون ذلك ينتهي الربط بعد 7 أيام.
   - سيظهر لك وحدك تحذير "unverified app" عند الموافقة، وهذا طبيعي للاستخدام الشخصي.
4. من **Credentials → Create credentials → OAuth client ID**:
   - النوع: **Web application**؛
   - في **Authorized redirect URIs** أضف: `https://developers.google.com/oauthplayground`؛
   - انسخ **Client ID** و**Client secret**.
5. **الحصول على رمز التجديد (Refresh token)** من OAuth Playground، من متصفح الهاتف:
   1. افتح `https://developers.google.com/oauthplayground`.
   2. اضغط ⚙️ (الإعدادات)، فعّل **Use your own OAuth credentials**، والصق Client ID وClient secret.
   3. في خانة **Input your own scopes** اكتب السطر التالي ثم **Authorize APIs**:
      `https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/yt-analytics.readonly`
   4. سجّل الدخول **بحساب القناة**، ووافق (يظهر تحذير "unverified app" لك وحدك).
   5. اضغط **Exchange authorization code for tokens**، وانسخ **Refresh token**.
   6. ضعه مباشرة في سر GitHub `YT_REFRESH_TOKEN` (الخطوة 2). لا ترسله في المحادثة.

> لماذا Playground وليس رمز الجهاز؟ وثائق Google تنص على أن YouTube Analytics API لا يدعم طريقة رمز الجهاز، والنظام يحتاج التحليلات لتحسين الاستراتيجية.

## 2. GitHub — الأسرار والمتغيرات (Settings → Secrets and variables → Actions)

**Secrets:**

| الاسم | القيمة |
|---|---|
| `DATABASE_URL` | من Supabase: **Connect → Transaction pooler** (منفذ 6543)، مع كلمة مرور قاعدة البيانات (من Database settings إن نسيتها) |
| `MIGRATION_DATABASE_URL` | من Supabase: **Connect → Session pooler** أو **Direct** (منفذ 5432) |
| `ENCRYPTION_KEY` | أي 32 بايت عشوائية بصيغة base64. مثلًا من أي جهاز: `openssl rand -base64 32`. احتفظ بها، فبدونها لا يمكن فك رمز YouTube المخزّن |
| `YT_CLIENT_ID` و`YT_CLIENT_SECRET` | من الخطوة 1 |
| `YT_REFRESH_TOKEN` | من الخطوة 1.5 (OAuth Playground) |

**Variables:**

| الاسم | القيمة | الأثر |
|---|---|---|
| `WORKER_ENABLED` | `true` | يشغّل عامل الإنتاج والنشر |
| `TTS_ENGINE` | (اختياري) | المحرك الصوتي المعتمد في تقرير المرحلة 2. القيمة الافتراضية `silma` |

> لا تضع أي مفتاح API لخدمة ذكاء اصطناعي. النظام يرفض العمل إن وُجد واحد.

## 3. التحقق من الربط — دقيقة واحدة

Actions → **YouTube connect** → Run workflow.

يتحقق من أن الرمز يعمل لرفع الفيديوهات وللتحليلات معًا، ويسجّل معرّف القناة واسمها في قاعدة البيانات. يجب أن ينتهي بسطر:
`Connected: "<اسم قناتك>" … Data API OK; Analytics API OK`

## 4. اختبار رفع خاص — اختياري لكن موصى به

Actions → **YouTube private test upload** → Run workflow.

يرفع فيديو اختبار **خاصًا** فقط ثم يتحقق منه، ويطبع رابطه. يمكنك حذفه من YouTube Studio بعدها.

## 5. التشغيل

بعد ذلك يعمل المدير وحده:
- يحلل ويخطط ويكتب وينتج وينشر ويحلل النتائج؛
- يرسل لك ملخصًا يوميًا.

## الإيقاف والاستئناف

| الأمر | المكان | الأثر |
|---|---|---|
| **إيقاف فوري** | اطلب مني "/pause" في المحادثة، أو نفّذ `npm run studio -- pause` | يتوقف المدير والعامل والنشر خلال دورة واحدة |
| **استئناف** | "/resume" أو `npm run studio -- resume` | يعود العمل |
| **إيقاف العامل وحده** | احذف المتغير `WORKER_ENABLED` | يتوقف الإنتاج والنشر |
