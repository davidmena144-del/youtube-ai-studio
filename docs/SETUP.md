# التفعيل — الخطوات المتبقية عليك (مرة واحدة فقط)

كل شيء هنا مجاني. لا تُدخل بطاقة دفع في أي خدمة. إن طلبت منك خدمة بطاقة فتوقف، فهذا خارج الخطة.
لا ترسل أي رمز أو كلمة مرور في المحادثة؛ كل قيمة سرية تُلصق مباشرة في أسرار GitHub فقط.

**المدة الإجمالية:** حوالي 30 دقيقة من المتصفح، ثم انتظار نحو 20 دقيقة لاختبار الرفع.

## 0. الحالة الحالية (لا تفعل شيئًا هنا)

- **قاعدة البيانات:** مشروع Supabase المجاني "davidmena144-del's Project" (المعرّف `tzmvrhixsymehvoffzvl`، المنطقة eu-north-1).
  - مثبّتة فيه كل الجداول والدوال (migrations من 0000 إلى 0009).
  - سُحبت الصلاحيات العامة، ولكل جدول سياسة أمان على مستوى الصفوف (RLS).
- **سجل القناة موجود.** سياسة النشر الحالية `private_only`:
  - كل فيديو يُرفع **خاصًا** ولا يُنشر للعامة أبدًا، حتى تقرر أنت غير ذلك (الخطوة 8).
  - لا Short أكثر من مرة كل 12 ساعة، وحتى 3 أسبوعيًا، وفيديو طويل واحد أسبوعيًا.
- **الصوت:** SILMA (ترخيص Apache-2.0)، ومُختبر داخل خط الإنتاج الحقيقي. التفاصيل في `docs/PHASE2-TTS-RESULTS.md`.

## 1. Google Cloud — مشروع وتفعيل الـ APIs (حوالي 10 دقائق)

1. افتح **console.cloud.google.com** بحساب Google الذي يملك القناة.
2. أنشئ المشروع:
   - من القائمة العلوية بجانب شعار Google Cloud اضغط محدد المشاريع، ثم **New project**؛
   - الاسم: `youtube-ai-studio`، ثم **Create**؛
   - تأكد أن المشروع الجديد هو المختار في القائمة العلوية.
3. فعّل الـ APIs من **APIs & Services → Library**. ابحث عن كل واحدة واضغط **Enable**:
   - `YouTube Data API v3`
   - `YouTube Analytics API`
4. اضبط شاشة الموافقة من **APIs & Services → OAuth consent screen**. في الواجهة الجديدة اسمها **Google Auth Platform**؛ اضغط **Get started**:
   - **App name:** أي اسم، مثل `YouTube AI Studio`؛ **User support email:** بريدك.
   - **Audience:** اختر **External**.
   - **Contact information:** بريدك، ثم وافق على الشروط، ثم **Create**.
5. انشر التطبيق من قسم **Audience**: اضغط **Publish app** ثم **Confirm**، حتى تصبح الحالة **In production**.
   - **لماذا:** في حالة "Testing" ينتهي الربط تلقائيًا بعد 7 أيام.
   - لا تحتاج طلب "Verification"؛ سيظهر لك وحدك تحذير "Google hasn't verified this app" عند الموافقة، وهذا طبيعي للاستخدام الشخصي.
6. أنشئ بيانات العميل من **Clients** (أو **Credentials → Create credentials → OAuth client ID**):
   - **Application type:** `Web application`؛ **Name:** `youtube-ai-studio`.
   - **Authorized redirect URIs → Add URI:**
     ```
     https://developers.google.com/oauthplayground
     ```
   - اضغط **Create**، وانسخ **Client ID** و**Client secret** إلى مكان مؤقت آمن (مثل ملاحظة لا تُزامَن). ستلصقهما في GitHub في الخطوة 4.

## 2. رمز التجديد (Refresh token) من OAuth Playground (حوالي 3 دقائق)

1. افتح `https://developers.google.com/oauthplayground`.
2. اضغط ⚙️ أعلى اليمين:
   - فعّل **Use your own OAuth credentials**؛
   - الصق **OAuth Client ID** و**OAuth Client secret**، ثم أغلق النافذة.
3. على اليسار، في خانة **Input your own scopes** أسفل القائمة، الصق السطر التالي كما هو، ثم اضغط **Authorize APIs**:
   ```
   https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/yt-analytics.readonly
   ```
4. اختر **حساب القناة**. إن كان للحساب أكثر من قناة فاختر القناة الصحيحة.
5. عند التحذير اضغط **Advanced** ثم **Go to … (unsafe)**، ثم **Continue** ووافق على الصلاحيتين:
   - إدارة فيديوهاتك؛
   - قراءة التحليلات.
6. في الخطوة 2 من الصفحة اضغط **Exchange authorization code for tokens**، وانسخ قيمة **Refresh token** (تبدأ عادة بـ `1//`).

> **لماذا Playground؟** وثائق Google تنص على أن YouTube Analytics API لا يعمل بطريقة "رمز الجهاز"، والنظام يحتاج التحليلات لتحسين الاستراتيجية.
>
> **الصلاحيات المطلوبة هي الحد الأدنى:** رفع فيديوهاتك وإدارتها، وقراءة التحليلات. لا صلاحية على Gmail أو Drive أو غيرهما.

## 3. روابط قاعدة البيانات من Supabase (حوالي 3 دقائق)

1. افتح **supabase.com/dashboard**، ثم المشروع **davidmena144-del's Project**، ثم زر **Connect** أعلى الصفحة.
2. **Transaction pooler** (المنفذ **6543**): انسخ الرابط. هذا هو `DATABASE_URL`.
3. **Session pooler** (المنفذ **5432**): انسخ الرابط. هذا هو `MIGRATION_DATABASE_URL`.
4. استبدل `[YOUR-PASSWORD]` في الرابطين بكلمة مرور قاعدة البيانات.
   - إن نسيتها: **Project Settings → Database → Reset database password**.
   - **تحذير:** إعادة التعيين تغيّر كلمة المرور لكل من يستخدمها، ولا يستخدمها حاليًا غير هذا النظام.

شكل الرابطين، والمضيف الصحيح يظهر لك في نافذة Connect:
```
postgresql://postgres.tzmvrhixsymehvoffzvl:<PASSWORD>@<pooler-host>:6543/postgres
postgresql://postgres.tzmvrhixsymehvoffzvl:<PASSWORD>@<pooler-host>:5432/postgres
```

## 4. أسرار GitHub ومتغيراته

افتح: `github.com/davidmena144-del/youtube-ai-studio` ← **Settings** ← **Secrets and variables** ← **Actions**.

**تبويب Secrets ← New repository secret** (الاسم حرفيًا كما هو، بأحرف كبيرة):

| الاسم | القيمة |
|---|---|
| `DATABASE_URL` | رابط Transaction pooler (6543) من الخطوة 3 |
| `MIGRATION_DATABASE_URL` | رابط Session pooler (5432) من الخطوة 3 |
| `ENCRYPTION_KEY` | 32 بايت عشوائية بصيغة base64 (انظر تحت الجدول) |
| `YT_CLIENT_ID` | Client ID من الخطوة 1 |
| `YT_CLIENT_SECRET` | Client secret من الخطوة 1 |
| `YT_REFRESH_TOKEN` | Refresh token من الخطوة 2 |

**إنشاء `ENCRYPTION_KEY`:**
- من أي طرفية: `openssl rand -base64 32`.
- أو في متصفح على حاسوب: افتح Console (F12) واكتب `btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))`.
- احتفظ بنسخة منه في مكان آمن.

**تبويب Variables ← New repository variable:**

| الاسم | القيمة | الأثر |
|---|---|---|
| `WORKER_ENABLED` | `true` | يشغّل عامل الإنتاج والرفع (كل 6 ساعات وعند الطلب). أضِفه **بعد** نجاح الخطوتين 5 و6 |

اترك `TTS_ENGINE` غير مضبوط؛ القيمة الافتراضية `silma`.

> لا تضع أي مفتاح API لخدمة ذكاء اصطناعي مدفوعة. العامل يرفض العمل إن وجد واحدًا.

## 5. التحقق من الربط (دقيقة واحدة)

1. افتح **Actions ← YouTube connect ← Run workflow ← Run workflow** (الفرع `main`).
2. بعد نحو دقيقة افتح التشغيل ← **connect** ← خطوة **Device authorisation**. يجب أن ترى:
   ```
   Connected: "<اسم قناتك>" (UC…). Data API OK; Analytics API OK (N video rows).
   ```

إن ظهر خطأ، انسخ **سطر الخطأ فقط** إلى المحادثة، فهو لا يحتوي أسرارًا.

| الخطأ | السبب والحل |
|---|---|
| `invalid_grant` | الرمز أُلغي أو انتهى (التطبيق ما زال "Testing"؟). انشر التطبيق (الخطوة 1.5)، ثم كرر الخطوة 2 |
| `redirect_uri_mismatch` | رابط Playground غير مضاف في Authorized redirect URIs |
| `accessNotConfigured` / `SERVICE_DISABLED` | أحد الـ APIs غير مفعّل (الخطوة 1.3) |
| `password authentication failed` | كلمة مرور قاعدة البيانات في الرابط خاطئة |

## 6. اختبار رفع خاص (حوالي 20 دقيقة انتظار)

1. افتح **Actions ← YouTube private test upload ← Run workflow**.
2. الاختبار:
   - يصنع فيديو Short قصيرًا بصوت SILMA (نحو 13 دقيقة على الخادم المجاني)؛
   - يرفعه **خاصًا** فقط، مع الصورة المصغّرة والترجمة العربية؛
   - يتحقق منه، ثم يطبع رابطه في آخر السجل.
3. افتح **YouTube Studio ← Content** وتأكد من وجود الفيديو بحالة **Private**.
4. **افحص القفل.** افتح الفيديو في Studio وابحث عن عبارة **"Locked as private"** أو "مقفل كخاص":
   - **لا يوجد قفل:** ممتاز، لا شيء آخر مطلوب هنا.
   - **يوجد قفل:** هذه سياسة Google لمشاريع API غير المدققة المنشأة بعد 28 يوليو 2020. قدّم طلب التدقيق المجاني من نموذج **YouTube API Services – Audit and Quota Extension Form** (ابحث عنه بالاسم في Google). اذكر أنه تطبيق شخصي لرفع فيديوهات قناتك فقط. الرد يستغرق أيامًا إلى أسابيع.
5. احذف فيديو الاختبار من Studio إن أردت.

بعد نجاح هذه الخطوة أضف المتغير `WORKER_ENABLED=true` (الخطوة 4).

## 7. المدير المجدول (Routine) من claude.ai (حوالي 3 دقائق)

المنصة لا تسمح لي بإرفاق موصل Supabase بمهمة مجدولة أنشئها بنفسي، فأنشئها أنت مرة واحدة:

1. افتح **claude.ai/code** ← **Routines** ← **New routine**.
2. **Repository:** `davidmena144-del/youtube-ai-studio`، الفرع `main`.
3. **Environment:** `youtube-ai-studio`.
4. **Connectors:** فعّل **Supabase**. فعّل GitHub أيضًا إن ظهر، ليشغّل المدير العامل فور تجهيز فيديو.
5. **Schedule:** كل 3 ساعات: `17 */3 * * *` (بتوقيت UTC).
6. **Prompt:** انسخ كل النص الموجود في `docs/MANAGER-ROUTINE.md` من سطر "You are the autonomous manager…" حتى آخره.
7. احفظ، ثم اضغط **Run now** مرة واحدة للتجربة. يجب أن تنتهي الجلسة بملخص عربي قصير.
   - إن قال "المدير لا يملك وصولًا لقاعدة البيانات"، فموصل Supabase غير مفعّل في الـ Routine.

المدير لا يحتاج أي أسرار؛ وصوله لقاعدة البيانات عبر الموصل وبصلاحيات `app_manager` المحدودة فقط.

## 8. النشر العام — لاحقًا فقط، وبقرارك

حتى الآن يُرفع كل فيديو **خاصًا**. عندما تراجع عدة فيديوهات وتطمئن للجودة، ويكون تدقيق Google قد قُبل إن كان القفل ظاهرًا، يمكنك التحويل إلى النشر التلقائي المجدول بإحدى طريقتين:

- **الأسهل:** اكتب لي في المحادثة: "فعّل النشر العام".
- **أو بنفسك:** في **Supabase ← SQL Editor** نفّذ:
  ```sql
  INSERT INTO channel_policies (channel_id, version, policy, created_by)
  SELECT channel_id, version + 1, jsonb_set(policy, '{publish_mode}', '"auto"'), 'owner'
  FROM channel_policies WHERE channel_id = 'b954ab8c-2666-451e-867c-e9144c34cb18'
  ORDER BY version DESC LIMIT 1;
  ```
  وللرجوع إلى الخاص، استبدل `"auto"` بـ `"private_only"`.

المدير نفسه لا يستطيع تغيير هذه السياسة؛ فهي للمالك فقط.

## 9. Trend Intelligence — اختياري، منصة منصة

موظف Trend Intelligence يجمع البيانات يوميًا من الـ APIs الرسمية فقط. أي منصة لم تُضبط تُسجَّل "skipped" مع السبب، ولا يتوقف الباقي.

| المنصة | ما يُجمع | ما يحتاجه منك | القيد الرسمي |
|---|---|---|---|
| **YouTube** | الرائج في مصر والسعودية والإمارات؛ والأكثر مشاهدة في مجال القناة خلال 7 أيام؛ والقنوات المنافسة وآخر فيديوهاتها | **لا شيء إضافي:** يستخدم رمز YouTube الموجود. مفتاح API العام اختياري | البحث مكلف في حصة YouTube، فله سقف يومي خاص (1200 وحدة) لا يمس حصة الرفع |
| **Wikipedia** | اهتمام الجمهور بموضوعات القناة: مشاهدات 7 أيام مقابل السابقة | لا شيء (بيانات عامة مفتوحة) | — |
| **TikTok** | حسابك أنت فقط: المتابعون وأرقام فيديوهاتك | تطبيق مطوّر TikTok + موافقة OAuth (انظر أدناه) | **الترندات وحسابات الآخرين غير متاحة رسميًا للاستخدام التجاري.** Research API للباحثين الأكاديميين وغير الربحيين فقط |
| **Facebook** | صفحتك أنت: المتابعون، ومنشوراتك وتفاعلها | رمز صفحة من Graph API Explorer (انظر أدناه) | **صفحات المنافسين تحتاج ميزة "Page Public Content Access"** بمراجعة Meta |

**YouTube (مفتاح عام، اختياري):**
- Google Cloud ← Credentials ← Create credentials ← **API key**.
- قيّده بـ YouTube Data API v3 فقط، ثم أضفه كسر `YT_API_KEY`.

**Facebook (صفحتك فقط):**
1. افتح developers.facebook.com وأنشئ تطبيقًا من نوع **Business** (مجاني).
2. في **Graph API Explorer**:
   - اختر تطبيقك؛
   - أضف الصلاحيتين `pages_show_list` و`pages_read_engagement` فقط؛
   - اضغط **Generate Access Token**.
3. حوّله لرمز طويل الأمد من **Access Token Debugger** (زر Extend).
4. من `me/accounts` في Explorer انسخ `access_token` و`id` لصفحتك.
5. أضف السرّين `FB_PAGE_TOKEN` و`FB_PAGE_ID`.

**TikTok (حسابك فقط):**
- يحتاج تطبيقًا في developers.tiktok.com بمنتج **Login Kit**، بالصلاحيات `user.info.basic` و`user.info.stats` و`video.list` (بلا صلاحية نشر)، ثم مراجعة TikTok للتطبيق.
- بعد الموافقة أجهّز لك صفحة استقبال الموافقة لتحصل على الرمز.
- ثم تضيف الأسرار `TIKTOK_CLIENT_KEY` و`TIKTOK_CLIENT_SECRET` و`TIKTOK_REFRESH_TOKEN`.

> لا يُطلب منك أي كلمة مرور لأي منصة، ولا تُخزَّن.
> - الرموز في أسرار GitHub فقط.
> - رمز TikTok المتجدد يُحفظ مشفّرًا في قاعدة البيانات.

## الإيقاف والاستئناف

| الأمر | المكان | الأثر |
|---|---|---|
| **إيقاف فوري** | اطلب مني "/pause" في المحادثة | يتوقف المدير والعامل والرفع خلال دورة واحدة |
| **استئناف** | "/resume" | يعود العمل |
| **إيقاف العامل وحده** | احذف المتغير `WORKER_ENABLED` | يتوقف الإنتاج والرفع |
| **إلغاء ربط YouTube نهائيًا** | myaccount.google.com ← Security ← Third-party connections ← احذف التطبيق | يتوقف الرفع فورًا |
