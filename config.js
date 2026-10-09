/**
 * ============================================================
 * config.js — الإعدادات الوحيدة التي قد تحتاج تعديلها
 * ============================================================
 * API_URL: رابط نشر Apps Script (ينتهي بـ /exec).
 * لا يتغير الرابط عند تحديث Code.gs بإصدار جديد (New version)،
 * ويتغير فقط إذا أنشأت "نشراً جديداً" (New deployment) من الصفر.
 */
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzLr3MdLybswV7dWAWnfWYNtvAtBA_rjUHgEg_iAyhiAwHhEpEMKAwH3kHNemqZFg-d/exec',

  // مفتاح تخزين نسخة البيانات الأخيرة (مندوبون/مناطق/ولايات/زبائن) لفتح التطبيق فوراً
  DATA_CACHE_KEY: 'dailyReportInitialData',

  // أقصى مدة انتظار لرد الخادم (بالمللي ثانية) قبل اعتبار الطلب فاشلاً
  REQUEST_TIMEOUT_MS: 60000
};
