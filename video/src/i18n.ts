export type Lang = 'en' | 'ar';

export type Strings = {
  dir: 'ltr' | 'rtl';
  // brand lockup
  brand: string[]; // words; the one equal to `brandAccent` is highlighted
  brandAccent: string;
  brandLine2?: string; // optional accented second line (Arabic lockup)
  // promise
  promiseEyebrow: string;
  promiseHeadline: string;
  promiseAccent: string;
  promiseSub: string;
  // tools
  howItWorks: string;
  tools: {title: string; desc: string; tag: string}[];
  // stats
  builtForSpeed: string;
  stats: {display: string; suffix: string; label: string}[];
  // outro
  steps: string[];
  createEditPublish: string;
  cta: string;
  repo: string;
  // mini-visual labels
  mvWriting: string;
  mvTokens: string;
  mvRendering: string;
  mvRenderDone: string;
  mvChecks: string[];
  mvRunning: string;
  mvPassed: string;
};

export const STRINGS: Record<Lang, Strings> = {
  en: {
    dir: 'ltr',
    brand: ['YouTube', 'AI', 'Studio'],
    brandAccent: 'AI',
    promiseEyebrow: 'One idea → One studio',
    promiseHeadline: 'From idea to a published video — in minutes.',
    promiseAccent: 'minutes',
    promiseSub: 'Script, design, build, render — in one AI-native pipeline.',
    howItWorks: 'How it works',
    tools: [
      {title: 'Script & Ideas', desc: 'Describe a concept. The AI drafts a tight, scroll-stopping script.', tag: 'script.md'},
      {title: 'Design System', desc: 'A living DESIGN.md keeps every frame perfectly on brand.', tag: 'DESIGN.md'},
      {title: 'Image → Code', desc: 'Turn any screenshot or sketch into production-ready UI code.', tag: 'Stitch'},
      {title: 'Motion & Render', desc: 'Motion, titles and transitions — rendered to MP4 in one click.', tag: 'Remotion'},
      {title: 'Auto QA', desc: 'Automated browser checks catch every glitch before you ship.', tag: 'Playwright'},
    ],
    builtForSpeed: 'Built for speed',
    stats: [
      {display: '10', suffix: '×', label: 'faster to publish'},
      {display: '60', suffix: 's', label: 'idea → rendered video'},
      {display: '100', suffix: '%', label: 'on-brand frames'},
      {display: '1', suffix: '-click', label: 'export to MP4'},
    ],
    steps: ['Script.', 'Design.', 'Build.', 'Render.', 'Ship.'],
    createEditPublish: 'Create · Edit · Publish',
    cta: 'Start building today →',
    repo: 'github.com / youtube-ai-studio',
    mvWriting: '// ai is writing…',
    mvTokens: 'tokens · on-brand',
    mvRendering: 'rendering…',
    mvRenderDone: 'render complete',
    mvChecks: ['Accessibility · AA', 'Keyboard & focus', 'No layout shift', 'Links & forms OK'],
    mvRunning: '→ running…',
    mvPassed: '→ all checks passed',
  },
  ar: {
    dir: 'rtl',
    brand: ['استوديو', 'يوتيوب'],
    brandAccent: '',
    brandLine2: 'للذكاء الاصطناعي',
    promiseEyebrow: 'فكرة واحدة · استوديو واحد',
    promiseHeadline: 'من فكرة إلى فيديو منشور — في دقائق.',
    promiseAccent: 'دقائق',
    promiseSub: 'سكربت، تصميم، تنفيذ، ورندر — في مسار واحد مدعوم بالذكاء الاصطناعي.',
    howItWorks: 'خطوات العمل',
    tools: [
      {title: 'السكربت والأفكار', desc: 'اوصف فكرتك، والذكاء الاصطناعي يكتب لك سكربت قوي وجذّاب.', tag: 'script.md'},
      {title: 'نظام التصميم', desc: 'ملف DESIGN.md حيّ يخلّي كل إطار متوافق مع هويتك تماماً.', tag: 'DESIGN.md'},
      {title: 'صورة إلى كود', desc: 'حوّل أي لقطة شاشة أو اسكتش إلى كود واجهة جاهز للإنتاج.', tag: 'Stitch'},
      {title: 'موشن ورندر', desc: 'موشن، عناوين، وانتقالات — تترندر إلى MP4 بنقرة واحدة.', tag: 'Remotion'},
      {title: 'فحص تلقائي', desc: 'فحوصات متصفّح تلقائية تمسك أي خلل قبل النشر.', tag: 'Playwright'},
    ],
    builtForSpeed: 'مبني للسرعة',
    stats: [
      {display: '10', suffix: '×', label: 'أسرع في النشر'},
      {display: '60', suffix: 'ث', label: 'من الفكرة إلى الفيديو'},
      {display: '100', suffix: '%', label: 'إطارات متوافقة مع الهوية'},
      {display: '1', suffix: ' نقرة', label: 'للتصدير إلى MP4'},
    ],
    steps: ['سكربت.', 'تصميم.', 'تنفيذ.', 'رندر.', 'نشر.'],
    createEditPublish: 'أنشئ · عدّل · انشر',
    cta: '→ ابدأ الإنشاء الآن',
    repo: 'github.com / youtube-ai-studio',
    mvWriting: 'يكتب السكربت…',
    mvTokens: 'ألوان · متوافقة',
    mvRendering: 'جاري الرندر…',
    mvRenderDone: 'اكتمل الرندر',
    mvChecks: ['الوصولية · AA', 'لوحة المفاتيح والتركيز', 'ثبات التخطيط', 'الروابط والنماذج سليمة'],
    mvRunning: 'جاري الفحص…',
    mvPassed: 'تم اجتياز كل الفحوصات',
  },
};
