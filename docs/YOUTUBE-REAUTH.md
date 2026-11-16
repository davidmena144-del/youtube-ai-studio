# تجديد ربط YouTube (كل أقل من 7 أيام، حوالي 5 دقائق من الهاتف)

تطبيق Google OAuth الخاص بك في وضع **Testing** بقرارك، لذلك تنتهي صلاحية رمز التجديد (Refresh token) بعد 7 أيام من موافقتك.

**متى يذكّرك النظام:**
- workflow ‏**YouTube token check** يعمل يوميًا، ويفشل عمدًا قبل الانتهاء بيومين، فيرسل لك GitHub إشعار فشل على البريد.
- تقرير المدير اليومي يبدأ أيضًا بسطر تنبيه.

**ما الذي لا يتغير:** لا تحتاج تغيير أي إعداد في Google Cloud، ولا أي سر آخر غير `YT_REFRESH_TOKEN`.

## الخطوات

1. افتح `https://developers.google.com/oauthplayground`.
2. اضغط ⚙️، وتأكد أن **Use your own OAuth credentials** مفعّل، وأن Client ID هو الذي ينتهي بـ `…2100` مع الـ Client secret الخاص به. ثم اضغط **Close**.
3. في خانة **Input your own scopes** الصق السطر التالي كما هو، ثم اضغط **Authorize APIs**:
   ```
   https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/yt-analytics.readonly
   ```
4. اختر حساب القناة. يجب أن تعرض شاشة Google **اسم تطبيقك**، لا "Google OAuth 2.0 Playground". عند التحذير اضغط **Advanced** ← **Go to …**، ثم وافق على الصلاحيتين.
5. اضغط **Exchange authorization code for tokens**، وانسخ **Refresh token** (يبدأ بـ `1//`).
6. افتح:
   `https://github.com/davidmena144-del/youtube-ai-studio/settings/secrets/actions/YT_REFRESH_TOKEN`
   ثم اضغط **Update** والصق الرمز الجديد. لا ترسله في المحادثة.
7. شغّل **Actions ← YouTube connect ← Run workflow**، أو اطلب مني تشغيله. سيتحقق من الربط ويبدأ عدّ الأيام السبعة من جديد تلقائيًا.

## إن ظهر خطأ

- **`unauthorized_client`:** الخطوة 2 لم تُطبَّق قبل Authorize، فصدر الرمز لعميل Playground. أعد الخطوات من 2.
- **`invalid_grant`:** الرمز انتهى أو أُلغي. أعد الخطوات من 1.

## لماذا لا يتم هذا تلقائيًا؟

تسجيل الدخول والموافقة في Google خطوة تفاعلية لصاحب الحساب فقط. النظام لا يؤتمتها ولا يطلب كلمة مرورك.
