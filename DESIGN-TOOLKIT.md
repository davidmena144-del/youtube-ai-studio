# 🎨 Design Toolkit — youtube-ai-studio

مجموعة أدوات الـ frontend/design اللي اتحمّلت في المشروع، وكل واحدة ومكانها وطريقة استخدامها.

| # | الأداة | المصدر | المكان في المشروع | الحالة |
|---|--------|--------|-------------------|--------|
| 1 | **frontend-design** (skill) | `anthropics/skills` | `.claude/skills/frontend-design/` | ✅ مفعّلة كـ project skill |
| 2 | **Web Interface Guidelines** | `vercel-labs/web-interface-guidelines` | `AGENTS.md` (جذر المشروع) | ✅ قواعد للـ agent |
| 3 | **Awesome Design MD** | `VoltAgent/awesome-design-md` | `design-references/<brand>/DESIGN.md` | ✅ 14 نظام تصميم |
| 4 | **Stitch Skills** (Image→Code) | `google-labs-code/stitch-skills` | `vendor/stitch-skills/` | ⚠️ نسخة مرجعية (محتاجة Stitch MCP) |
| 5 | **Playwright MCP** | `microsoft/playwright-mcp` | `.mcp.json` | ⚙️ متضبّط — محتاج تفعيل |

---

## 1) frontend-design — skill شغّالة
اتحطّت في `.claude/skills/frontend-design/` فبقت متاحة تلقائيًا في أي سيشن على الريبو ده.
بتدي Claude اتجاه تصميم متميّز (palette, typography, layout) بدل الشكل القالبي.

**الاستخدام:** قول مثلاً — *"صمّم صفحة الـ landing بتاعت الاستوديو باستخدام مهارة frontend-design"*.

## 2) AGENTS.md — قواعد واجهات Vercel
ملف قواعد (MUST / SHOULD / NEVER) للـ accessibility، keyboard، forms، الأنيميشن، الأداء، الـ layout.
أي agent (Claude Code / Cursor / Codex...) بيقرا `AGENTS.md` تلقائيًا ويلتزم بيه وهو بيكتب UI.

## 3) design-references — أنظمة تصميم جاهزة
14 ملف `DESIGN.md` لعلامات مختارة مناسبة لمنتج فيديو/AI:
```
claude  vercel  stripe  notion  figma  supabase  apple
spotify  framer  runwayml  elevenlabs  raycast  warp  tesla
```
كل ملف بيوصف: الثيم، الـ palette بالأدوار، التايبوجرافي، المكوّنات وحالاتها، الـ spacing، الـ do/don't.

**الاستخدام:** قول — *"ابني الـ UI على نمط `design-references/runwayml/DESIGN.md`"*، أو انسخ الملف لجذر المشروع باسم `DESIGN.md` عشان يبقى الافتراضي.
> المكتبة الأصلية فيها ~84 علامة. عايز أنزّل باقيهم؟ قولّي الأسماء أو "نزّل الكل".

## 4) Stitch Skills — Image → Code (مرجعي)
اتحمّلت نسخة من كل الـ `SKILL.md` تحت `vendor/stitch-skills/plugins/...` للاطّلاع. دي skills بتحوّل تصميم/صورة لكود (React, React Native, shadcn) وبتستخرج DESIGN.md.
> ⚠️ عشان **تشتغل فعليًا** محتاجة **Stitch MCP server** متضبّط. التثبيت الكامل:
```bash
npx plugins add google-labs-code/stitch-skills --scope project --target claude-code
```

## 5) Playwright MCP — تحكّم في المتصفّح
اتضاف في `.mcp.json`:
```json
{ "mcpServers": { "playwright": { "command": "npx", "args": ["@playwright/mcp@latest"] } } }
```
بيخلّي Claude يفتح/يتصفّح/يختبر الـ UI (accessibility snapshots). محتاج **Node 18+**.
> **تفعيل:** في Claude Code المحلي، افتح المشروع وفعّل سيرفرات الـ MCP لمّا يتطلب الإذن. (في سيشن الويب ده السيرفر مش بيتشغّل داخل الكونتينر.)

---

### مصادر
- https://github.com/anthropics/skills
- https://github.com/vercel-labs/web-interface-guidelines
- https://github.com/VoltAgent/awesome-design-md
- https://github.com/google-labs-code/stitch-skills
- https://github.com/microsoft/playwright-mcp
