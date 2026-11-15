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
      `https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/yt-analytics.readonly`
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

> **مهم قبل النشر العام: تدقيق YouTube API (مجاني).** سياسة Google: الفيديوهات المرفوعة عبر API من مشروع Google Cloud لم يجتز تدقيق التوافق، والمنشأ بعد 28 يوليو 2020، **تُقفل على "خاص"**. يظل الفيديو خاصًا ولا ينشر نفسه في موعده.
> - افتح فيديو الاختبار في YouTube Studio. إن ظهر **"Locked as private"** أو "مقفل كخاص"، فقدّم طلب التدقيق من نموذج **YouTube API Services – Audit and Quota Extension Form**.
> - الطلب مجاني، والرد يستغرق عادة أيامًا إلى أسابيع.
> - إلى أن يُقبل، يرفع النظام ويجدول بشكل صحيح، لكن الفيديوهات تبقى خاصة. يمكنك نشرها يدويًا من Studio.

## 5. تشغيل المدير (Routine) — خطوة واحدة من claude.ai

المنصة لا تسمح لي بإرفاق موصل Supabase بمهمة مجدولة أنشئها بنفسي، فأنشئها أنت مرة واحدة:

1. افتح claude.ai/code ← **Routines** ← **New routine**.
2. **Repository:** `davidmena144-del/youtube-ai-studio` (الفرع `main`).
3. **Environment:** `youtube-ai-studio`.
4. **Connectors:** فعّل **Supabase** (وGitHub إن ظهر).
5. **Schedule:** كل 3 ساعات، مثلًا `17 */3 * * *`.
6. **Prompt:** انسخ النص الموجود في الملف `docs/MANAGER-ROUTINE.md` كما هو.

يعمل المدير بعدها كل 3 ساعات: يخطط ويكتب ويجهّز الإنتاج ويرسل لك ملخصًا. لا يحتاج أي أسرار؛ وصوله لقاعدة البيانات عبر الموصل وبصلاحيات `app_manager` المحدودة فقط.

## 5ب. التشغيل

بعد ذلك يعمل المدير وحده:
- يحلل ويخطط ويكتب وينتج وينشر ويحلل النتائج؛
- يرسل لك ملخصًا يوميًا.

## 6. Trend Intelligence — اختياري، منصة منصة

موظف Trend Intelligence يجمع البيانات يوميًا من الـ APIs الرسمية فقط. أي منصة لم تُضبط تُسجَّل "skipped" مع السبب ولا يتوقف الباقي.

| المنصة | ما يُجمع | ما يحتاجه منك | القيد الرسمي |
|---|---|---|---|
| **YouTube** | الرائج في مصر والسعودية والإمارات، والأكثر مشاهدة في مجال القناة خلال 7 أيام، والقنوات المنافسة وآخر فيديوهاتها | **لا شيء إضافي:** يستخدم رمز YouTube الموجود. اختياري للأفضلية: مفتاح API عام. | البحث مكلف في حصة YouTube، فله سقف يومي خاص (1200 وحدة) لا يمس حصة الرفع |
| **Wikipedia** | اهتمام الجمهور بموضوعات القناة: مشاهدات 7 أيام مقابل السابقة | لا شيء (بيانات عامة مفتوحة) | — |
| **TikTok** | حسابك أنت فقط: المتابعون وأرقام فيديوهاتك | تطبيق مطوّر TikTok + موافقة OAuth (انظر أدناه) | **الترندات وحسابات الآخرين غير متاحة رسميًا للاستخدام التجاري.** Research API للباحثين الأكاديميين وغير الربحيين فقط، ولن أتحايل عليه |
| **Facebook** | صفحتك أنت: المتابعون، ومنشوراتك وتفاعلها | رمز صفحة من Graph API Explorer (انظر أدناه) | **صفحات المنافسين تحتاج ميزة "Page Public Content Access"** بمراجعة Meta وتوثيق نشاط تجاري. CrowdTangle أُغلق، وMeta Content Library للباحثين فقط |

**YouTube (مفتاح عام، اختياري):** Google Cloud → Credentials → Create credentials → **API key**. قيّده بـ YouTube Data API v3 فقط، ثم أضفه كسر `YT_API_KEY`.

**Facebook (صفحتك فقط):**
1. افتح developers.facebook.com وأنشئ تطبيقًا من نوع **Business** (مجاني).
2. افتح **Graph API Explorer**، واختر تطبيقك، وأضف الصلاحيتين `pages_show_list` و`pages_read_engagement` فقط، ثم **Generate Access Token**.
3. حوّله لرمز طويل الأمد من **Access Token Debugger** (زر Extend)، ثم من `me/accounts` في Explorer انسخ `access_token` و`id` لصفحتك.
4. أضف السرّين `FB_PAGE_TOKEN` و`FB_PAGE_ID`.
5. المنافسون: اتركهم مسجلين؛ لن تُقرأ صفحاتهم إلا إذا وافقت Meta على PPCA وضبطتَ المتغير `FB_PPCA_APPROVED=true`.

**TikTok (حسابك فقط):** يحتاج تطبيقًا في developers.tiktok.com بمنتج **Login Kit**، بالصلاحيات `user.info.basic` و`user.info.stats` و`video.list` (بلا صلاحية نشر)، ثم مراجعة TikTok للتطبيق. بعد الموافقة أجهّز لك صفحة استقبال الموافقة لتحصل على الرمز، ثم تضيف الأسرار `TIKTOK_CLIENT_KEY` و`TIKTOK_CLIENT_SECRET` و`TIKTOK_REFRESH_TOKEN`.

> لا يُطلب منك أي كلمة مرور لأي منصة، ولا تُخزَّن. الرموز في أسرار GitHub فقط. رمز TikTok المتجدد يُحفظ مشفّرًا في قاعدة البيانات.

## الإيقاف والاستئناف

| الأمر | المكان | الأثر |
|---|---|---|
| **إيقاف فوري** | اطلب مني "/pause" في المحادثة، أو نفّذ `npm run studio -- pause` | يتوقف المدير والعامل والنشر خلال دورة واحدة |
| **استئناف** | "/resume" أو `npm run studio -- resume` | يعود العمل |
| **إيقاف العامل وحده** | احذف المتغير `WORKER_ENABLED` | يتوقف الإنتاج والنشر |
