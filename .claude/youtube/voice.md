# voice.md — قناة «تكّة | Takka» (@takka.a)

Read by the yt-* skills (copy to `~/.claude/youtube/voice.md` in a new session if a skill looks there).

## Who I am talking to

شاب أو بنت مصري/عربي من 16 لـ 30 سنة، بيستخدم الموبايل طول الوقت، سمع عن Claude والذكاء الاصطناعي
بس مش عارف يستفيد منه فعليًا في المذاكرة أو الشغل أو مشروعه الصغير. بيقلّب الشورتس بسرعة، ولو أول
ثانيتين ما شدّوهوش بيعدّي.

## How I actually talk

- **فيديوهات Claude والذكاء الاصطناعي:** عامية مصرية خفيفة وجمل قصيرة جدًا (2–5 كلمات في الكابشن).
  مثال: «صاحب [محل]؟» / «Claude يشتغل معاك» / «في [3 حاجات]» / «اكتبله [اسم المحل]».
- **فيديوهات العلوم («بالأرقام» / «في 24 ساعة»):** عربية فصحى بسيطة وحماسية.
  مثال: «في يومٍ واحد فقط…» / «دماغك» / «لا يتوقّف لحظة» / «وكل هذا… داخل رأسك!».
- مفيش صوت راوي. الكلام مكتوب على الشاشة، ومعاه موسيقى ومؤثرات.

## Words I never use

- «اشترك ولايك وفعّل الجرس» في الأول (طلب واحد بس في الآخر).
- «هيغيّر حياتك»، «سر لا يعرفه أحد»، «مجاني 100%» من غير ما يكون مضمون.
- كلمة «ذكاء اصطناعي» أو رمز AI في اللوجو.

## Words I do use

«تكّة»، «كل حاجة ليها تكّة»، «جرّبها النهارده»، «احفظ الفيديو»، «تابع تكّة»، «حوالي» قبل أي رقم تقريبي.

## Owner rules for new videos (19 Nov)

- كل الفيديوهات بالعامية المصرية. مفيش فيديوهات إنجليزي.
- Higgsfield متوصل، بس على الخطة المجانية: موديل `z_image` بس اللي بيشتغل (0.15 كريدت للصورة)، وتنزيل الصور محتاج فتح عنوان التخزين في شبكة البيئة (اترفض مرة، متطلبوش تاني إلا لو صاحب القناة قال).
- شيل أي صفحة من `media/motion/queue.json` بعد ما تتنشر.

## What I will not claim

- أي رقم من غير مصدر موثوق (NASA، NOAA، دراسة منشورة، إعلان رسمي من الشركة)، والمصادر تتكتب في الوصف.
- أسعار أو مميزات لـ Claude مش متأكدين منها. أي مثال (سعر، اسم محل) يتقال إنه مثال.
- إن Claude معصوم: دايمًا «راجع المعلومة المهمة».
- صور أشخاص حقيقيين، أو لوجو Claude/Anthropic في البراندنج.

## My format

- شورتس عمودي 9:16، من 30 لـ 45 ثانية، موشن جرافيك بكود (مفيش كاميرا)، وبيترفع بجودة 1440×2560.
- أول ثانيتين: هوك بجملة على الشاشة من أول فريم، ورقم أو كلمة صادمة.
- شكلين أساسيين:
  1. **«بالأرقام»:** رقم كبير بيعدّ في كل مشهد، والمشاهد بتتحوّل لبعض.
  2. **«3 حاجات»:** كلام فوق بيظهر كلمة كلمة، والكلمة المهمة في مربع بلون الفيديو، وكارت في النص، ورقم 01/02/03 تحت.
- الألوان: **على حسب موضوع الفيديو، مش أحمر وأسود ثابت** (طلب صاحب القناة 19 نوفمبر). كل فيديو ليه لوحة وخلفية من موضوعه: أوامر = أخضر ترمنال، حاجات مستخبية = بنفسجي ودهبي بنجوم، تحذير = أزرق ليلي وأصفر شريط تحذير، نوم = نيلي، وهكذا. ألوان البراند (أسود #0B0B10، أصفر #FFD23F، أحمر #E62E3A) للّوجو والبانر بس.
- الخط: Kufam (تقيل للكلمة الرئيسية)، والكابشن كلمة كلمة بمربع على الكلمة المهمة.
- آخر الفيديو: طلب واحد بس (احفظ الفيديو، أو تابع تكّة).

## Narration (owner decision, 22 Nov)

- Narrator: Speko connector, provider `inworld`, voice `Omar`, `intent.language: ar-EG`. Free credit only: never top up, never enable auto top-up, never use the ElevenLabs voices there (they need a paid top-up).
- Pace: normal speed (no slow-down). The owner preferred the faster take over the slowed one. The 2-second hook line is recorded at speed 1.3 so it ends with the hook.
- The voice says the caption words exactly, and the voice sets the clock (`explainers/narr.py`, `<name>.say.json`).
- Length: write enough content that the narrated video still runs about 34 seconds (the first narrated test came out at 27 s, so add roughly a quarter more facts).
- Applies from the next new videos; already published videos stay as they are.
