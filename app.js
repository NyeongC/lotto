(function () {
  'use strict';

  /* =========================================================
   * 순수 함수 (DOM 없음)
   * ========================================================= */

  var CHO_STROKES = [1, 2, 1, 2, 4, 3, 3, 4, 8, 2, 4, 1, 2, 4, 3, 2, 3, 4, 3];
  var JUNG_STROKES = [2, 3, 3, 4, 2, 3, 3, 4, 2, 4, 5, 3, 3, 2, 4, 5, 3, 3, 1, 2, 1];
  var JONG_STROKES = [0, 1, 2, 3, 1, 3, 4, 2, 3, 4, 6, 7, 5, 6, 7, 6, 3, 4, 6, 2, 4, 1, 2, 3, 2, 3, 4, 3];

  function normalizeSentence(text) {
    return String(text).trim().replace(/\s+/g, ' ');
  }

  function countStrokes(text) {
    var total = 0;
    // for...of 로 서로게이트 쌍(이모지)을 한 글자로 센다
    for (var ch of String(text)) {
      var code = ch.charCodeAt(0) - 0xAC00;
      if (ch.length === 1 && code >= 0 && code <= 11171) {
        total += CHO_STROKES[Math.floor(code / 588)]
          + JUNG_STROKES[Math.floor((code % 588) / 28)]
          + JONG_STROKES[code % 28];
      } else if (!/\s/.test(ch)) {
        total += 1;
      }
    }
    return total;
  }

  // cyrb128: 문자열 → 32bit 정수 4개 (128bit 시드)
  function hashSeed(str) {
    var h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (var i = 0, k; i < str.length; i++) {
      k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  }

  // sfc32: uint32 (0 ≤ x < 2^32) 를 돌려주는 PRNG
  function sfc32(a, b, c, d) {
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      var t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return t >>> 0;
    };
  }

  // 0 ≤ x < n, 거절 샘플링으로 완전 균등
  function randInt(next, n) {
    var limit = Math.floor(4294967296 / n) * n, x;
    do { x = next(); } while (x >= limit);
    return x % n;
  }

  // next: uint32 를 돌려주는 함수. 7칸만 Fisher–Yates
  function drawNumbers(next) {
    var pool = [];
    for (var n = 1; n <= 45; n++) pool.push(n);
    for (var i = 0; i < 7; i++) {
      var j = i + randInt(next, 45 - i);
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    return {
      main: pool.slice(0, 6).sort(function (a, b) { return a - b; }),
      bonus: pool[6]
    };
  }

  function cryptoUint32() {
    var buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  }

  function dateParts(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return { int: Number(y + m + day), label: y + '.' + m + '.' + day };
  }

  var SEED_PREFIX = 'clover-v2';

  function sentenceNumbers(text, now) {
    var sentence = normalizeSentence(text);
    var strokes = countStrokes(sentence);
    var date = dateParts(now);
    var s = hashSeed(SEED_PREFIX + '|' + sentence + '|' + strokes + '|' + date.int);
    var next = sfc32(s[0], s[1], s[2], s[3]);
    // 획수만큼 굴리기
    for (var r = 12 + (strokes % 32); r > 0; r--) next();
    var result = drawNumbers(next);
    return { main: result.main, bonus: result.bonus, sentence: sentence, strokes: strokes, date: date.label };
  }

  function formatLine(item) {
    return item.main.join(' ') + ' + ' + item.bonus;
  }

  // draws 행: [회차, "YYYY.MM.DD", n1..n6, 보너스, 1등 1인당, 2등 1인당, 3등 1인당]
  // main(본번호 6개)만 비교. 3등 이상 중 가장 높은 등수, 같으면 가장 최근 회차.
  function findBestDraw(main, draws) {
    if (!Array.isArray(main) || !Array.isArray(draws)) return null;
    var mine = {};
    main.forEach(function (n) { mine[n] = true; });
    var best = null;
    for (var i = 0; i < draws.length; i++) {
      var d = draws[i];
      if (!Array.isArray(d) || d.length < 12) continue;
      var hit = 0;
      for (var k = 2; k <= 7; k++) if (mine[d[k]]) hit++;
      var rank = hit === 6 ? 1 : hit === 5 ? (mine[d[8]] ? 2 : 3) : 0;
      if (!rank) continue;
      if (!best || rank < best.rank || (rank === best.rank && d[0] > best.round)) {
        best = { round: d[0], date: d[1], rank: rank, prize: d[8 + rank] };
      }
    }
    return best;
  }

  function formatWin(win) {
    var text = '🎯 ' + win.round + '회(' + win.date + ')였다면 ' + win.rank + '등';
    if (typeof win.prize === 'number' && win.prize > 0) {
      text += ' · ' + win.prize.toLocaleString('ko-KR') + '원';
    }
    return text;
  }

  // 콘솔/테스트용으로 노출
  window.Lotto = {
    normalizeSentence: normalizeSentence,
    countStrokes: countStrokes,
    hashSeed: hashSeed,
    sfc32: sfc32,
    randInt: randInt,
    drawNumbers: drawNumbers,
    sentenceNumbers: sentenceNumbers,
    findBestDraw: findBestDraw
  };

  /* =========================================================
   * 저장
   * ========================================================= */

  var MAX_ROWS = 50;
  var KEY_TAB = 'lotto.v1.tab';
  var TABS = ['basic', 'sentence'];

  function historyKey(tab) { return 'lotto.v1.history.' + tab; }

  function isValidItem(it) {
    return it && Array.isArray(it.main) && it.main.length === 6 && typeof it.bonus === 'number';
  }

  function loadHistory(tab) {
    try {
      var data = JSON.parse(localStorage.getItem(historyKey(tab)));
      return Array.isArray(data) ? data.filter(isValidItem).slice(-MAX_ROWS) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(tab, list) {
    try { localStorage.setItem(historyKey(tab), JSON.stringify(list)); } catch (e) { /* 무시 */ }
  }

  function loadTab() {
    try {
      var t = localStorage.getItem(KEY_TAB);
      return TABS.indexOf(t) >= 0 ? t : 'basic';
    } catch (e) {
      return 'basic';
    }
  }

  function saveTab(tab) {
    try { localStorage.setItem(KEY_TAB, tab); } catch (e) { /* 무시 */ }
  }

  /* =========================================================
   * UI
   * ========================================================= */

  var state = { tab: 'basic', history: { basic: loadHistory('basic'), sentence: loadHistory('sentence') } };
  var busy = false;

  var tabButtons = {
    basic: document.getElementById('tab-basic'),
    sentence: document.getElementById('tab-sentence')
  };
  var panels = {
    basic: document.getElementById('panel-basic'),
    sentence: document.getElementById('panel-sentence')
  };
  var lists = {
    basic: document.getElementById('list-basic'),
    sentence: document.getElementById('list-sentence')
  };
  var addBtn = document.getElementById('add-btn');
  var form = document.getElementById('sentence-form');
  var input = document.getElementById('sentence-input');
  var status = document.getElementById('sentence-status');

  var COPY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

  function ballRange(n) {
    if (n <= 10) return 'r1';
    if (n <= 20) return 'r2';
    if (n <= 30) return 'r3';
    if (n <= 40) return 'r4';
    return 'r5';
  }

  function makeBall(n, extraClass, index, animate) {
    var b = document.createElement('span');
    b.className = 'ball ' + ballRange(n) + (extraClass ? ' ' + extraClass : '');
    b.textContent = n;
    if (animate) {
      b.classList.add('drop');
      b.style.animationDelay = (index * 80) + 'ms';
    }
    return b;
  }

  function createRow(item, number, animate) {
    var li = document.createElement('li');
    li.className = 'row';

    var top = document.createElement('div');
    top.className = 'row-main';

    var no = document.createElement('span');
    no.className = 'row-no';
    no.textContent = '#' + number;

    var line = document.createElement('div');
    line.className = 'line';
    line.setAttribute('role', 'group');
    line.setAttribute('aria-label', item.main.join(', ') + ', 보너스 ' + item.bonus);
    item.main.forEach(function (n, i) { line.appendChild(makeBall(n, '', i, animate)); });
    var plus = document.createElement('span');
    plus.className = 'plus';
    plus.setAttribute('aria-hidden', 'true');
    plus.textContent = '+';
    line.appendChild(plus);
    line.appendChild(makeBall(item.bonus, 'bonus', 6, animate));

    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'copy-btn';
    copy.setAttribute('aria-label', '번호 복사');
    copy.innerHTML = COPY_ICON + '<span class="copied" aria-hidden="true">복사됨</span>';
    copy.addEventListener('click', function () { copyLine(copy, formatLine(item)); });

    top.appendChild(no);
    top.appendChild(line);
    top.appendChild(copy);
    li.appendChild(top);

    if (item.sentence) {
      var meta = document.createElement('p');
      meta.className = 'meta';
      meta.textContent = '"' + item.sentence + '" · 획수 ' + item.strokes + ' · ' + item.date;
      li.appendChild(meta);
    }

    var win = findBestDraw(item.main, window.LOTTO_DRAWS);
    if (win) {
      var winLine = document.createElement('p');
      winLine.className = 'meta win' + (win.rank === 1 ? ' top' : '');
      winLine.textContent = formatWin(win);
      li.appendChild(winLine);
    }
    return li;
  }

  function renderList(tab) {
    var list = lists[tab];
    var items = state.history[tab];
    list.textContent = '';
    for (var i = items.length - 1; i >= 0; i--) {
      list.appendChild(createRow(items[i], i + 1, false));
    }
    updateClearButton(tab);
  }

  function updateClearButton(tab) {
    panels[tab].querySelector('.clear-btn').hidden = state.history[tab].length === 0;
  }

  function addItem(tab, item) {
    var items = state.history[tab];
    items.push(item);
    var dropped = false;
    while (items.length > MAX_ROWS) { items.shift(); dropped = true; }
    saveHistory(tab, items);

    if (dropped) {
      // 줄 번호가 밀리므로 다시 그린 뒤 맨 위 줄만 애니메이션
      renderList(tab);
      lists[tab].replaceChild(createRow(item, items.length, true), lists[tab].firstChild);
    } else {
      lists[tab].insertBefore(createRow(item, items.length, true), lists[tab].firstChild);
    }
    updateClearButton(tab);
  }

  function generateBasic() {
    var r = drawNumbers(cryptoUint32);
    addItem('basic', { main: r.main, bonus: r.bonus, createdAt: Date.now() });
  }

  function shake(el) {
    el.classList.remove('shake');
    void el.offsetWidth; // 애니메이션 재시작
    el.classList.add('shake');
  }

  function generateSentence() {
    if (busy) return;
    var text = normalizeSentence(input.value);
    if (!text) {
      input.value = '';
      shake(input);
      return;
    }
    busy = true;
    input.readOnly = true;
    status.textContent = '분석 중…';
    setTimeout(function () {
      var r = sentenceNumbers(text, new Date());
      addItem('sentence', {
        main: r.main, bonus: r.bonus, createdAt: Date.now(),
        sentence: r.sentence, strokes: r.strokes, date: r.date
      });
      status.textContent = '';
      input.value = '';
      input.readOnly = false;
      busy = false;
    }, 600);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  function copyLine(btn, text) {
    copyText(text).then(function () {
      btn.classList.add('is-copied');
      clearTimeout(btn._copiedTimer);
      btn._copiedTimer = setTimeout(function () { btn.classList.remove('is-copied'); }, 1200);
    }, function () { /* 복사 실패는 조용히 무시 */ });
  }

  function selectTab(tab, focus) {
    state.tab = tab;
    TABS.forEach(function (t) {
      var active = t === tab;
      tabButtons[t].setAttribute('aria-selected', String(active));
      tabButtons[t].tabIndex = active ? 0 : -1;
      panels[t].hidden = !active;
    });
    if (focus) tabButtons[tab].focus();
    saveTab(tab);
  }

  /* ---------- 이벤트 ---------- */

  TABS.forEach(function (t) {
    tabButtons[t].addEventListener('click', function () { selectTab(t, false); });
  });

  document.querySelector('.tabs').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    var next = TABS[(TABS.indexOf(state.tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    selectTab(next, true);
  });

  addBtn.addEventListener('click', generateBasic);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.repeat || e.isComposing) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (state.tab !== 'basic') return;
    // 입력창이나 버튼에 포커스가 있으면 기본 동작에 맡긴다
    var t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, button, a, [contenteditable]')) return;
    e.preventDefault();
    generateBasic();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    generateSentence();
  });

  input.addEventListener('animationend', function () { input.classList.remove('shake'); });

  Array.prototype.forEach.call(document.querySelectorAll('.clear-btn'), function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.getAttribute('data-tab');
      if (!state.history[tab].length) return;
      if (!confirm('이 탭의 기록을 모두 지울까요?')) return;
      state.history[tab] = [];
      saveHistory(tab, []);
      renderList(tab);
    });
  });

  /* ---------- 초기화 ---------- */

  renderList('basic');
  renderList('sentence');
  selectTab(loadTab(), false);
})();
