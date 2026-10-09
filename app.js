/** ---------------- الحالة العامة للتطبيق ---------------- */
  const appState = {
    reps: [],
    regions: [],
    states: [],
    customers: [],
    currentView: 'selection',
    selection: {
      repId: '', repName: '',
      regionId: '', regionName: '',
      stateIds: [], stateNames: []
    },
    income: [],
    expenses: {
      fuel: '', food: '', accommodation: '', parking: '',
      otherAmount: '', otherDescription: ''
    }
  };

  let incomeIdCounter = 0;
  appState.lastReportImage = null;


  /** ---------------- طبقة الاتصال بالـ API (بديل google.script.run) ---------------- */

  /**
   * طلب مع مهلة زمنية. يعيد محتوى data عند النجاح، ويرمي خطأ عند أي فشل
   * (انقطاع الاتصال، انتهاء المهلة، أو success:false من الخادم).
   */
  function apiFetch(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, CONFIG.REQUEST_TIMEOUT_MS);

    return fetch(url, Object.assign({}, options, { signal: controller.signal }))
      .then(function (response) { return response.json(); })
      .then(function (json) {
        if (!json.success) {
          throw new Error(json.error || 'خطأ غير معروف من الخادم');
        }
        return json.data;
      })
      .finally(function () { clearTimeout(timer); });
  }

  function apiGetInitialData() {
    return apiFetch(CONFIG.API_URL + '?action=getInitialData', { method: 'GET' });
  }

  /**
   * الإرسال بصيغة text/plain عمدًا: هذه الصيغة تُعتبر "طلبًا بسيطًا" في المتصفح،
   * فلا يرسل طلب فحص مسبق (preflight) الذي لا يدعمه Apps Script.
   */
  function apiSubmitReport(payload) {
    return apiFetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'submitReport', payload: payload })
    });
  }


  /** ---------------- تخزين نسخة البيانات الأخيرة محليًا ---------------- */
  function loadCachedData() {
    try {
      const raw = localStorage.getItem(CONFIG.DATA_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveCachedData(data) {
    try {
      localStorage.setItem(CONFIG.DATA_CACHE_KEY, JSON.stringify(data));
    } catch (e) { /* امتلاء التخزين: نتجاهل، التطبيق يعمل بدونه */ }
  }


  /**
   * ---------------- تحميل البيانات الأولية ----------------
   * الأسلوب: "اعرض القديم فوراً ثم حدّث في الخلفية"
   *  - توجد نسخة محفوظة: يفتح التطبيق فوراً بها، ثم تُجلب النسخة الحديثة بصمت.
   *  - لا توجد نسخة (أول استخدام): ننتظر الخادم مرة واحدة فقط.
   */
  function init() {
    const cached = loadCachedData();

    if (cached) {
      onInitialDataLoaded(cached);
      refreshDataInBackground();
    } else {
      loadDataFirstTime();
    }
  }

  function loadDataFirstTime() {
    document.getElementById('loading').style.display = 'block';

    apiGetInitialData()
      .then(function (data) {
        saveCachedData(data);
        onInitialDataLoaded(data);
      })
      .catch(onLoadError);
  }

  function refreshDataInBackground() {
    apiGetInitialData()
      .then(function (data) {
        if (JSON.stringify(data) === JSON.stringify(loadCachedData())) return;
        saveCachedData(data);
        applyFreshData(data);
      })
      .catch(function () { /* لا إنترنت: نبقى على النسخة المحفوظة دون إزعاج المندوب */ });
  }

  /** تطبيق بيانات محدّثة على التطبيق المفتوح دون فقدان اختيارات المندوب الحالية */
  function applyFreshData(data) {
    appState.reps = data.reps;
    appState.regions = data.regions;
    appState.states = data.states;
    appState.customers = data.customers;

    renderRepOptions();
    renderRegionOptions();

    document.getElementById('rep-select').value = appState.selection.repId;
    document.getElementById('region-select').value = appState.selection.regionId;

    if (appState.selection.regionId) {
      renderStatesForRegion(appState.selection.regionId);
    }
  }

  function onInitialDataLoaded(data) {
    appState.reps = data.reps;
    appState.regions = data.regions;
    appState.states = data.states;
    appState.customers = data.customers;

    renderRepOptions();
    renderRegionOptions();

    document.getElementById('loading').style.display = 'none';

    const draft = loadDraft();
    if (draft) {
      restoreDraft(draft);
    } else {
      showView('selection');
    }
  }

  function onLoadError(error) {
    document.getElementById('loading').innerHTML =
      '<p class="card-text">تعذر تحميل البيانات، تحقق من الاتصال بالإنترنت وأعد المحاولة.</p>' +
      '<button type="button" id="btn-retry-load" class="btn btn-primary">إعادة المحاولة</button>';

    document.getElementById('btn-retry-load').addEventListener('click', function () {
      document.getElementById('loading').innerHTML =
        '<p class="card-text">جارٍ تحميل البيانات...</p>';
      loadDataFirstTime();
    });
  }


  /** ---------------- التنقل بين الشاشات (نقطة واحدة موحّدة) ---------------- */
  const VIEW_NAMES = ['selection', 'income', 'expenses', 'review', 'success'];

  function showView(viewName) {
    VIEW_NAMES.forEach(name => {
      document.getElementById('view-' + name).style.display =
        (name === viewName) ? 'block' : 'none';
    });
    appState.currentView = viewName;

    // شاشة النجاح ليست جزءًا من "عمل قيد التنفيذ"، فلا داعي لحفظها كمسودة
    if (viewName !== 'success') {
      saveDraft();
    }
  }


  /** ---------------- الحفظ التلقائي للمسودة (localStorage) ---------------- */
  const DRAFT_KEY = 'dailyReportDraft';

  function saveDraft() {
    const draftData = {
      currentView: appState.currentView,
      selection: appState.selection,
      income: appState.income,
      expenses: appState.expenses
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draftData));
  }

  function loadDraft() {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
  }


  /** ---------------- استعادة المسودة المحفوظة ---------------- */
  function restoreDraft(draft) {
    appState.selection = draft.selection;
    appState.income = draft.income;
    appState.expenses = draft.expenses;

    // استعادة شاشة الاختيار
    document.getElementById('rep-select').value = appState.selection.repId;
    document.getElementById('region-select').value = appState.selection.regionId;
    if (appState.selection.regionId) {
      renderStatesForRegion(appState.selection.regionId);
    }
    validateSelectionStep();

    // استعادة المداخيل
    incomeIdCounter = appState.income.reduce((max, row) => Math.max(max, row.id), 0);
    renderIncomeRows();
    calculateIncomeTotal();

    // استعادة المصاريف
    document.getElementById('expense-fuel').value = appState.expenses.fuel;
    document.getElementById('expense-food').value = appState.expenses.food;
    document.getElementById('expense-accommodation').value = appState.expenses.accommodation;
    document.getElementById('expense-parking').value = appState.expenses.parking;
    document.getElementById('expense-other-amount').value = appState.expenses.otherAmount;
    document.getElementById('expense-other-desc').value = appState.expenses.otherDescription;
    calculateExpensesTotal();

    showView(draft.currentView || 'selection');
  }


  /** ---------------- تعبئة قائمة المندوبين ---------------- */
  function renderRepOptions() {
    const select = document.getElementById('rep-select');
    // نُبقي الخيار الأول فقط ("-- اختر اسمك --") ثم نعيد البناء، لأن الدالة قد تُستدعى مرتين
    select.length = 1;
    appState.reps.forEach(rep => {
      const option = document.createElement('option');
      option.value = rep.id;
      option.textContent = rep.name;
      select.appendChild(option);
    });
  }


  /** ---------------- تعبئة قائمة المناطق ---------------- */
  function renderRegionOptions() {
    const select = document.getElementById('region-select');
    select.length = 1;
    appState.regions.forEach(region => {
      const option = document.createElement('option');
      option.value = region.id;
      option.textContent = region.name;
      select.appendChild(option);
    });
  }


  /** ---------------- عرض ولايات المنطقة المختارة ---------------- */
  function renderStatesForRegion(regionId) {
    const list = document.getElementById('states-list');
    list.innerHTML = '';

    const filtered = appState.states.filter(s => String(s.regionId) === String(regionId));

    if (filtered.length === 0) {
      document.getElementById('states-wrapper').style.display = 'none';
      return;
    }

    filtered.forEach(state => {
      const chip = document.createElement('div');
      chip.className = 'state-chip';
      chip.textContent = state.name;

      if (appState.selection.stateIds.includes(state.id)) {
        chip.classList.add('selected');
      }

      chip.addEventListener('click', () => {
        toggleState(state, chip);
      });
      list.appendChild(chip);
    });

    document.getElementById('states-wrapper').style.display = 'block';
  }


  /** ---------------- تبديل اختيار ولاية (إضافة/إزالة) ---------------- */
  function toggleState(state, chipEl) {
    const idx = appState.selection.stateIds.indexOf(state.id);

    if (idx === -1) {
      appState.selection.stateIds.push(state.id);
      appState.selection.stateNames.push(state.name);
    } else {
      appState.selection.stateIds.splice(idx, 1);
      appState.selection.stateNames.splice(idx, 1);
    }

    chipEl.classList.toggle('selected');
    validateSelectionStep();
    saveDraft();
  }


  /** ---------------- التحقق من اكتمال الخطوة الأولى ---------------- */
  function validateSelectionStep() {
    const s = appState.selection;
    const isValid = Boolean(s.repId) && Boolean(s.regionId) && s.stateIds.length > 0;
    document.getElementById('btn-next').disabled = !isValid;
  }


  /** ---------------- أحداث شاشة الاختيار ---------------- */
  document.getElementById('rep-select').addEventListener('change', function (e) {
    appState.selection.repId = e.target.value;
    appState.selection.repName = e.target.options[e.target.selectedIndex].text;
    validateSelectionStep();
    saveDraft();
  });

  document.getElementById('region-select').addEventListener('change', function (e) {
    appState.selection.regionId = e.target.value;
    appState.selection.regionName = e.target.options[e.target.selectedIndex].text;
    appState.selection.stateIds = [];
    appState.selection.stateNames = [];
    renderStatesForRegion(appState.selection.regionId);
    validateSelectionStep();

    // تغيّرت المنطقة، إذن قائمة الزبائن المتاحة تغيّرت أيضًا.
    // نصفّر صفوف المداخيل المدخلة سابقًا لتفادي زبون من منطقة أخرى.
    appState.income = [];
    incomeIdCounter = 0;

    saveDraft();
  });

  document.getElementById('btn-next').addEventListener('click', function () {
    if (appState.income.length === 0) {
      addIncomeRow();
    }
    showView('income');
  });


  /** ---------------- إرجاع زبائن المنطقة المختارة حاليًا ---------------- */
  function getRegionCustomers() {
    const regionId = appState.selection.regionId;
    return appState.customers.filter(c => String(c.regionId) === String(regionId));
  }


  /** ---------------- إرجاع معرّفات الزبائن المستخدَمين في صفوف أخرى (لمنع التكرار) ---------------- */
  function getUsedCustomerIds(excludeRowId) {
    return appState.income
      .filter(row => row.id !== excludeRowId && row.customerId && row.customerId !== 'OTHER')
      .map(row => String(row.customerId));
  }


  /** ---------------- نافذة البحث عن زبون: الحالة والفتح/الإغلاق ---------------- */
  let activePickerRowId = null;

  function openCustomerPicker(rowId) {
    activePickerRowId = rowId;
    const searchInput = document.getElementById('customer-picker-search');
    searchInput.value = '';
    renderCustomerPickerList('');
    document.getElementById('customer-picker-overlay').classList.add('open');
    searchInput.focus();
  }

  function closeCustomerPicker() {
    document.getElementById('customer-picker-overlay').classList.remove('open');
    activePickerRowId = null;
  }

  /** ---------------- رسم قائمة الزبائن داخل النافذة (مرتبة أبجديًا، مع فلترة البحث) ---------------- */
  function renderCustomerPickerList(searchTerm) {
    const regionCustomers = getRegionCustomers();
    const usedIds = getUsedCustomerIds(activePickerRowId);

    // نستبعد الزبائن المختارين في صفوف أخرى فقط
    const available = regionCustomers.filter(c => !usedIds.includes(String(c.id)));

    const term = (searchTerm || '').trim().toLowerCase();
    const filtered = term
      ? available.filter(c => c.name.toLowerCase().includes(term))
      : available;

    // ترتيب بالأولوية: من يبدأ فعلاً بالنص المكتوب أولاً (أبجديًا فيما بينهم)،
    // ثم من يحتوي على النص في مكان آخر من الاسم (أبجديًا فيما بينهم أيضًا)
    const sorted = filtered.slice().sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(term);
      const bStarts = b.name.toLowerCase().startsWith(term);

      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      return a.name.localeCompare(b.name, 'ar');
    });

    const itemsHtml = sorted.map(c =>
      `<div class="customer-picker-item" data-customer-id="${c.id}">${c.name}</div>`
    ).join('');

    const emptyHtml = sorted.length === 0
      ? '<p class="customer-picker-empty">لا توجد نتائج مطابقة</p>'
      : '';

    const otherItemHtml =
      '<div class="customer-picker-item customer-picker-item-other" data-customer-id="OTHER">+ زبون آخر (اسم غير موجود بالقائمة)</div>';

    document.getElementById('customer-picker-list').innerHTML = itemsHtml + emptyHtml + otherItemHtml;
  }

  /** ---------------- أحداث نافذة البحث ---------------- */
  document.getElementById('customer-picker-search').addEventListener('input', function (e) {
    renderCustomerPickerList(e.target.value);
  });

  // إغلاق اللوحة عند الضغط على الخلفية المعتمة خارجها (وليس داخل اللوحة نفسها)
  document.getElementById('customer-picker-overlay').addEventListener('click', function (e) {
    if (e.target === this) {
      closeCustomerPicker();
    }
  });

  document.getElementById('customer-picker-list').addEventListener('click', function (e) {
    const item = e.target.closest('.customer-picker-item');
    if (!item || activePickerRowId === null) return;

    const customerId = item.dataset.customerId;
    const row = appState.income.find(r => r.id === activePickerRowId);

    row.customerId = customerId;

    if (customerId === 'OTHER') {
      row.name = '';
    } else {
      const customer = appState.customers.find(c => String(c.id) === String(customerId));
      row.name = customer ? customer.name : '';
    }

    closeCustomerPicker();
    renderIncomeRows();
    calculateIncomeTotal();
    saveDraft();
  });


  /** ---------------- إضافة صف زبون جديد ---------------- */
  function addIncomeRow() {
    incomeIdCounter++;
    appState.income.push({ id: incomeIdCounter, customerId: '', name: '', amount: '' });
    renderIncomeRows();
    saveDraft();
  }


  /** ---------------- حذف صف زبون ---------------- */
  function removeIncomeRow(rowId) {
    appState.income = appState.income.filter(row => row.id !== rowId);

    if (appState.income.length === 0) {
      addIncomeRow();
      return;
    }

    renderIncomeRows();
    calculateIncomeTotal();
    saveDraft();
  }


  /** ---------------- رسم صفوف المداخيل (زر يفتح نافذة اختيار الزبون + خيار "زبون آخر") ---------------- */
  function renderIncomeRows() {
    const container = document.getElementById('income-rows');

    container.innerHTML = appState.income.map(row => {
      const isOther = row.customerId === 'OTHER';
      const hasSelection = Boolean(row.customerId);

      let buttonText = 'اختر الزبون';
      let buttonClass = 'income-customer-btn income-name income-customer-btn-empty';

      if (isOther) {
        buttonText = 'زبون آخر...';
        buttonClass = 'income-customer-btn income-name';
      } else if (hasSelection) {
        buttonText = row.name || 'اختر الزبون';
        buttonClass = 'income-customer-btn income-name';
      }

      return `
        <div class="income-entry" data-row-id="${row.id}">
          <div class="income-row">
            <button type="button" class="${buttonClass}">${buttonText}</button>
            <input type="number" class="income-amount" placeholder="المبلغ" value="${row.amount}">
            <button type="button" class="row-delete">×</button>
          </div>
          ${isOther ? `<input type="text" class="income-other-name" placeholder="اكتب اسم الزبون" value="${row.name}">` : ''}
        </div>
      `;
    }).join('');
  }


  /** ---------------- حساب إجمالي المداخيل ---------------- */
  function calculateIncomeTotal() {
    const total = appState.income.reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0);
    document.getElementById('income-total').textContent = total.toLocaleString('ar-u-nu-latn');
  }


  /** ---------------- أحداث شاشة المداخيل (بأسلوب تفويض الأحداث) ---------------- */
  document.getElementById('btn-add-customer').addEventListener('click', addIncomeRow);

  // فتح نافذة اختيار الزبون عند الضغط على زر "اختر الزبون"
  document.getElementById('income-rows').addEventListener('click', function (e) {
    if (e.target.classList.contains('income-customer-btn')) {
      const rowEl = e.target.closest('.income-entry');
      const rowId = Number(rowEl.dataset.rowId);
      openCustomerPicker(rowId);
    }
  });

  // كتابة المبلغ أو اسم الزبون اليدوي
  document.getElementById('income-rows').addEventListener('input', function (e) {
    const rowEl = e.target.closest('.income-entry');
    if (!rowEl) return;

    const rowId = Number(rowEl.dataset.rowId);
    const row = appState.income.find(r => r.id === rowId);

    if (e.target.classList.contains('income-other-name')) {
      row.name = e.target.value;
    } else if (e.target.classList.contains('income-amount')) {
      row.amount = e.target.value;
      calculateIncomeTotal();
    }
    saveDraft();
  });

  document.getElementById('income-rows').addEventListener('click', function (e) {
    if (e.target.classList.contains('row-delete')) {
      const rowId = Number(e.target.closest('.income-entry').dataset.rowId);
      removeIncomeRow(rowId);
    }
  });

  document.getElementById('btn-income-back').addEventListener('click', function () {
    showView('selection');
  });

  document.getElementById('btn-income-next').addEventListener('click', function () {
    showView('expenses');
  });


  /** ---------------- حساب إجمالي المصاريف ---------------- */
  function calculateExpensesTotal() {
    const e = appState.expenses;
    const total = (parseFloat(e.fuel) || 0)
      + (parseFloat(e.food) || 0)
      + (parseFloat(e.accommodation) || 0)
      + (parseFloat(e.parking) || 0)
      + (parseFloat(e.otherAmount) || 0);

    document.getElementById('expenses-total').textContent = total.toLocaleString('ar-u-nu-latn');
  }


  /** ---------------- ربط حقول المصاريف بالحالة (تفويض الأحداث) ---------------- */
  const expensesFieldMap = {
    'expense-fuel': 'fuel',
    'expense-food': 'food',
    'expense-accommodation': 'accommodation',
    'expense-parking': 'parking',
    'expense-other-amount': 'otherAmount',
    'expense-other-desc': 'otherDescription'
  };

  document.getElementById('view-expenses').addEventListener('input', function (e) {
    const stateKey = expensesFieldMap[e.target.id];
    if (!stateKey) return;

    appState.expenses[stateKey] = e.target.value;

    if (stateKey !== 'otherDescription') {
      calculateExpensesTotal();
    }
    saveDraft();
  });

  document.getElementById('btn-expenses-back').addEventListener('click', function () {
    showView('income');
  });

  document.getElementById('btn-expenses-next').addEventListener('click', function () {
    renderReviewPage();
    showView('review');
  });


  /** ---------------- تنسيق الأرقام لعرضها ---------------- */
  function formatMoney(value) {
    return (parseFloat(value) || 0).toLocaleString('ar-u-nu-latn');
  }


  /** ---------------- أسماء الأشهر الجزائرية (تُستخدم بدل الأسماء الفصحى الافتراضية) ---------------- */
  const ALGERIAN_MONTHS = [
    'جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان',
    'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];

  function formatReviewDate(date) {
    const day = date.getDate();
    const month = ALGERIAN_MONTHS[date.getMonth()];
    const year = date.getFullYear();
    return day + ' ' + month + ' ' + year;
  }


  /** ---------------- رسم صفحة المراجعة ---------------- */
  function renderReviewPage() {
    document.getElementById('review-rep-name').textContent = appState.selection.repName;
    document.getElementById('review-date').textContent = formatReviewDate(new Date());

    // المداخيل
    const validRows = appState.income.filter(row => row.name);

    document.getElementById('review-income-list').innerHTML = validRows.map(row => `
      <div class="review-line">
        <span>${row.name}</span>
        <span>${formatMoney(row.amount)}</span>
      </div>
    `).join('');

    document.getElementById('review-income-count').textContent = validRows.length;
    document.getElementById('review-income-total').textContent =
      document.getElementById('income-total').textContent;

    // المصاريف
    const e = appState.expenses;
    document.getElementById('review-fuel').textContent = formatMoney(e.fuel);
    document.getElementById('review-food').textContent = formatMoney(e.food);
    document.getElementById('review-accommodation').textContent = formatMoney(e.accommodation);
    document.getElementById('review-parking').textContent = formatMoney(e.parking);
    document.getElementById('review-other-amount').textContent = formatMoney(e.otherAmount);
    document.getElementById('review-expenses-total').textContent =
      document.getElementById('expenses-total').textContent;

    const descRow = document.getElementById('review-other-desc-row');
    if (e.otherDescription) {
      document.getElementById('review-other-desc').textContent = e.otherDescription;
      descRow.style.display = 'flex';
    } else {
      descRow.style.display = 'none';
    }
  }


  /** ---------------- أحداث شاشة المراجعة ---------------- */
  document.getElementById('btn-edit-report').addEventListener('click', function () {
    showView('selection');
  });

  document.getElementById('btn-submit-report').addEventListener('click', function () {
    submitReportToServer(this);
  });


  /** ---------------- إرسال التقرير فعليًا إلى الخادم ---------------- */
  function submitReportToServer(button) {
    button.disabled = true;
    button.textContent = 'جارٍ الإرسال...';

    const payload = {
      selection: appState.selection,
      income: appState.income,
      expenses: appState.expenses
    };

    apiSubmitReport(payload)
      .then(onSubmitSuccess)
      .catch(function (error) { onSubmitError(error, button); });
  }

  /**
   * بعد نجاح تسجيل التقرير في الشيت (وليس قبل ذلك أبدًا):
   * 1) نلتقط صورة التقرير.
   * 2) ننزّلها كنسخة احتياطية في جهاز المندوب.
   * 3) نفتح نافذة المشاركة تلقائيًا (بدون حاجة لزر إضافي).
   * فشل الالتقاط أو المشاركة لا يجب أن يوقف تأكيد نجاح الإرسال، فالبيانات وصلت فعلاً للشيت.
   */
  function onSubmitSuccess(result) {
    document.getElementById('review-report-number').textContent = result.reportNumber;
    document.getElementById('review-report-number-row').style.display = 'flex';

    captureReviewAsImage()
      .then(function (dataUrl) {
        appState.lastReportImage = dataUrl;
        downloadImage(dataUrl, 'تقرير-' + result.reportNumber + '.png');
        return shareReportImage();
      })
      .catch(function () {
        appState.lastReportImage = null;
      })
      .finally(function () {
        finishSubmissionFlow(result.reportNumber);
      });
  }

  function captureReviewAsImage() {
    const element = document.querySelector('#view-review .review-card');
    return html2canvas(element, { useCORS: true, backgroundColor: '#ffffff', scale: 2 })
      .then(function (canvas) {
        return canvas.toDataURL('image/png');
      });
  }

  function downloadImage(dataUrl, filename) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function finishSubmissionFlow(reportNumber) {
    document.getElementById('success-report-number').textContent = reportNumber;
    showView('success');
    resetAppForNewReport();
    clearDraft();
  }


  /** ---------------- مشاركة صورة التقرير (تُستدعى تلقائيًا بعد نجاح الإرسال فقط) ---------------- */
  function shareReportImage() {
    if (!appState.lastReportImage) {
      return Promise.resolve();
    }

    return fetch(appState.lastReportImage)
      .then(res => res.blob())
      .then(blob => {
        const file = new File([blob], 'تقرير.png', { type: 'image/png' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          return navigator.share({
            files: [file],
            title: 'تقرير يومي',
            text: 'تقرير المندوب اليومي'
          }).catch(function () {
            // ألغى المستخدم المشاركة، أو رفضها المتصفح — لا حاجة لأي إجراء، الصورة محفوظة أصلاً
          });
        }
        // الجهاز لا يدعم المشاركة المباشرة؛ الصورة محفوظة أصلاً في مجلد التنزيلات
      });
  }

  function onSubmitError(error, button) {
    button.disabled = false;
    button.textContent = 'إرسال ومشاركة التقرير';
    alert('تعذر إرسال التقرير، تحقق من اتصالك بالإنترنت وحاول مجددًا. بياناتك محفوظة ولن تُفقد.');
  }


  /** ---------------- تصفير النموذج لبدء تقرير جديد ---------------- */
  function resetAppForNewReport() {
    document.getElementById('review-report-number-row').style.display = 'none';

    appState.selection = {
      repId: '', repName: '', regionId: '', regionName: '', stateIds: [], stateNames: []
    };
    appState.expenses = {
      fuel: '', food: '', accommodation: '', parking: '', otherAmount: '', otherDescription: ''
    };
    appState.income = [];
    incomeIdCounter = 0;

    document.getElementById('rep-select').value = '';
    document.getElementById('region-select').value = '';
    document.getElementById('states-list').innerHTML = '';
    document.getElementById('states-wrapper').style.display = 'none';
    validateSelectionStep();

    addIncomeRow();
    calculateIncomeTotal();

    ['expense-fuel', 'expense-food', 'expense-accommodation', 'expense-parking',
      'expense-other-amount', 'expense-other-desc'].forEach(id => {
        document.getElementById(id).value = '';
      });
    calculateExpensesTotal();

    const submitBtn = document.getElementById('btn-submit-report');
    submitBtn.disabled = false;
    submitBtn.textContent = 'إرسال ومشاركة التقرير';
  }

  document.getElementById('btn-new-report').addEventListener('click', function () {
    showView('selection');
  });


  /** ---------------- بدء التطبيق ---------------- */
  window.addEventListener('DOMContentLoaded', init);


  /** ---------------- PWA: تسجيل service worker (العمل دون إنترنت لواجهة التطبيق) ---------------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').catch(function () {
        /* فشل التسجيل لا يعطّل التطبيق، فقط لن يُحفظ للعمل دون إنترنت */
      });
    });
  }
