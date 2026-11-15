# الإعداد المجاني (بدون بطاقة، بدون اشتراكات إضافية)

> كل ما هنا مجاني. لا تضف وسيلة دفع لأي خدمة. إن طلبت خدمة بطاقة فتوقف وأخبرني، فهذا يعني أن الخطوة خرجت عن الخطة.

## 1. Neon (قاعدة البيانات والذاكرة)

1. أنشئ مشروعًا مجانيًا على Neon، ثم فرعًا اسمه `test` (للتجارب) إلى جانب `main`.
2. من صفحة الاتصال انسخ رابطين:
   - **Direct** (غير pooled): يُستخدم للـ migrations فقط (`MIGRATION_DATABASE_URL`)؛
   - **Pooled**: يُستخدم لـ `DATABASE_URL` عند الحاجة.
3. طبّق الـ migrations مرة واحدة برابط المالك:
   ```
   MIGRATION_DATABASE_URL=<direct owner url> DATABASE_URL=<same> npm run db:migrate
   ```
   هذا ينشئ الجداول والدوال والدورين `app_manager` و`app_worker`، وهما بلا صلاحية دخول.
4. أنشئ دوري دخول بكلمتي مرور قويتين، من SQL Editor في Neon:
   ```sql
   CREATE ROLE manager_login LOGIN PASSWORD '<قوية وطويلة>' IN ROLE app_manager;
   CREATE ROLE worker_login  LOGIN PASSWORD '<قوية وطويلة>' IN ROLE app_worker;
   ```
   - `manager_login`: رابطه هو `DATABASE_URL` لجلسات Claude. لا يستطيع قراءة جدول الأسرار.
   - `worker_login`: رابطه هو `DATABASE_URL` في أسرار GitHub Actions.

> ⚠️ لم يُختبر هذا على Neon نفسه بعد. اختُبر على Postgres 16 بمالك ليس superuser ويملك `CREATEROLE`، وهو ما يقول توثيق Neon إن دور المالك يملكه.

## 2. أول تشغيل

```
DATABASE_URL=<manager url> npm run studio -- channel init --title "اسم القناة" --tz Asia/Riyadh
DATABASE_URL=<manager url> npm run studio -- status
DATABASE_URL=<manager url> npm run studio -- policy show
```

## 3. GitHub Actions (العامل) — بعد الدمج في الفرع الافتراضي فقط

- **Secrets:** `DATABASE_URL` (رابط `worker_login`) و`MIGRATION_DATABASE_URL` (رابط المالك المباشر).
- **Variable:** `WORKER_ENABLED=true`. بدونها لا يعمل الـ workflow.
- **الفوترة:** لا وسيلة دفع، أو ميزانية $0 مع Stop usage.

## الإيقاف

| الإجراء | الأمر أو المكان | الأثر |
|---|---|---|
| إيقاف فوري | `npm run studio -- pause` | زر الإيقاف: يمنع جلسات المدير الجديدة وسحب المهام والنشر |
| الاستئناف | `npm run studio -- resume` | يعيد التشغيل |
| إيقاف العامل | احذف المتغير `WORKER_ENABLED`، أو عطّل الـ workflow من GitHub | يتوقف العامل |
