// ==UserScript==
// @name         TRAE 论坛增强助手
// @namespace    https://github.com/Wayhhow
// @version      0.6.10-exp
// @description  一键暗黑模式 + 图片亮度自动调节 + 列表页数据增强 + 帖子温度计 + 随机漫游 + 一键回到顶部 + 【实验】情绪标记（😄😠😢😅🆘）与今日情绪面板 | © 2026 Wayhhow · MIT License
// @author       Wayhhow
// @homepage     https://github.com/Wayhhow
// @source       https://github.com/Wayhhow
// @match        https://forum.trae.cn/*
// @run-at       document-start
// @noframes
// @grant        none
// @license      MIT
// ==/UserScript==
/*
 * Copyright (c) 2026 Wayhhow <https://github.com/Wayhhow>
 * Released under the MIT License.
 */

(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */

  const DARK_KEY = 'traeExtDarkMode';
  const ROW_MARK = 'trae-ext-done';
  const HOT_TEMPERATURE = 70;
  const LIST_URL_PATTERN = /\/(latest|new|unread|top|c\/|tag\/|tags\/|filter|search|bookmarks|u\/)/;

  const TEMP_CAPS = { likes: 30, replies: 20, views: 1000 };
  const TEMP_WEIGHTS = { likes: 0.4, replies: 0.35, views: 0.25 };
  const TEMP_HALF_LIFE_DAYS = 7;

  const MOON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  const SUN_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  const DICE_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.5" fill="currentColor" stroke="none"/></svg>';
  const UP_ARROW_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';

  const topicCache = new Map();

  const SORT_STATE_KEY = 'traeExtSortHeat';
  let heatSortState = null;

  /* ---------------- 工具函数 ---------------- */

  function formatCount(n) {
    return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
  }

  function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function daysAgo(isoDate) {
    const ts = Date.parse(isoDate);
    if (!ts) return 0;
    return Math.max(0, (Date.now() - ts) / 86400000);
  }

  /* ---------------- 数据采集 ---------------- */

  function collectTopics(topics) {
    if (!Array.isArray(topics)) return;
    for (const topic of topics) {
      if (!topic || topic.id == null) continue;
      topicCache.set(String(topic.id), {
        likes: topic.like_count || 0,
        views: topic.views || 0,
        replies: Math.max(0, (topic.posts_count || 1) - 1),
        bumpedAt: topic.bumped_at || topic.last_posted_at || topic.created_at || '',
        solved: Boolean(topic.has_accepted_answer),
      });
    }
    enhanceVisibleRows();
  }

  function collectFromJson(data) {
    if (!data || typeof data !== 'object') return;
    collectTopics((data.topic_list && data.topic_list.topics) || data.topics);
  }

  function matchesList(url) {
    return typeof url === 'string' && LIST_URL_PATTERN.test(url);
  }

  function hookFetch() {
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const result = originalFetch.apply(this, args);
      try {
        const source = args[0];
        const url = typeof source === 'string' ? source : (source && source.url) || '';
        if (matchesList(url)) {
          result
            .then((res) => res.clone().json().then(collectFromJson).catch(() => {}))
            .catch(() => {});
        }
      } catch (err) {
        /* 钩子不能影响原站逻辑 */
      }
      return result;
    };
  }

  // 论坛“加载更多”走的是 XMLHttpRequest，fetch 钩子看不到，需单独拦截。
  function hookXhr() {
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__traeUrl = url;
      if (!this.__traeHooked) {
        this.__traeHooked = true;
        const self = this;
        this.addEventListener('load', () => {
          if (!matchesList(self.__traeUrl) || !self.responseText) return;
          try {
            collectFromJson(JSON.parse(self.responseText));
          } catch (err) {
            /* 单条响应损坏时跳过 */
          }
        });
      }
      return originalOpen.call(this, method, url, ...rest);
    };
  }

  function scanObject(str, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < str.length; i++) {
      const ch = str[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) return str.slice(start, i + 1);
      }
    }
    return null;
  }

  function parsePreloaded() {
    const script = document.querySelector('script.preloaded');
    const raw = script && script.getAttribute('data-preloaded');
    if (!raw) return;
    let pos = 0;
    while (true) {
      const keyIndex = raw.indexOf('topic_list', pos);
      if (keyIndex === -1) break;
      pos = keyIndex + 'topic_list'.length;
      if (keyIndex > 0 && raw[keyIndex - 1] !== ',') continue;
      const colon = raw.indexOf(':', keyIndex);
      if (colon === -1) continue;
      const brace = raw.indexOf('{', colon);
      if (brace === -1 || raw.slice(colon + 1, brace).trim() !== '') continue;
      const jsonText = scanObject(raw, brace);
      if (!jsonText) continue;
      try {
        collectFromJson(JSON.parse(jsonText));
      } catch (err) {
        /* 单条预载数据损坏时跳过 */
      }
    }
  }

  function fallbackFetchListJson() {
    setTimeout(() => {
      if (topicCache.size > 0) return;
      if (!document.querySelector('.topic-list-item')) return;
      const path = location.pathname.replace(/\/$/, '') || '/latest';
      const url = (path === '/' ? '/latest' : path) + '.json' + location.search;
      fetch(url, { headers: { Accept: 'application/json' } })
        .then((res) => res.json())
        .then(collectFromJson)
        .catch(() => {});
    }, 1200);
  }

  /* ---------------- 帖子温度计 ---------------- */

  function computeTemperature(topic) {
    const parts =
      TEMP_WEIGHTS.likes * Math.min(topic.likes / TEMP_CAPS.likes, 1) +
      TEMP_WEIGHTS.replies * Math.min(topic.replies / TEMP_CAPS.replies, 1) +
      TEMP_WEIGHTS.views * Math.min(topic.views / TEMP_CAPS.views, 1);
    const decay = 1 / (1 + daysAgo(topic.bumpedAt) / TEMP_HALF_LIFE_DAYS);
    return Math.round(parts * decay * 100);
  }

  function tempColor(temp) {
    return `hsl(${120 - temp * 1.2}, 80%, 55%)`;
  }

  function addTemperature(row, topic) {
    const temp = computeTemperature(topic);
    const viewsCell = row.querySelector('td.num.views');
    if (!viewsCell) return;
    let bar = viewsCell.querySelector('.trae-ext-temp');
    if (temp <= 0) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('span');
      bar.className = 'trae-ext-temp';
      viewsCell.appendChild(bar);
    }
    bar.title = `热度 ${temp} · ${topic.likes} 赞 · ${topic.replies} 回复 · ${formatCount(topic.views)} 浏览`;
    let fill = bar.querySelector('.trae-ext-temp-fill');
    if (!fill) {
      fill = document.createElement('span');
      fill.className = 'trae-ext-temp-fill';
      bar.appendChild(fill);
    }
    const width = temp + '%';
    if (fill.style.width !== width) fill.style.width = width;
    const color = tempColor(temp);
    if (fill.style.background !== color) fill.style.background = color;
  }

  /* ---------------- 列表页数据增强 ---------------- */

  function addLikesBadge(row, topic, temp) {
    const viewsCell = row.querySelector('td.num.views');
    if (!viewsCell) return;
    let badge = viewsCell.querySelector('.trae-ext-likes');
    if (!topic.likes) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'trae-ext-likes';
      viewsCell.appendChild(badge);
    }
    badge.title = '点赞数 ' + topic.likes;
    const text = (temp >= HOT_TEMPERATURE ? '🔥 ' : '') + '❤ ' + topic.likes;
    if (badge.textContent !== text) badge.textContent = text;
  }

  function addSolvedBadge(row, topic) {
    const titleLine = row.querySelector('.link-top-line');
    if (!titleLine) return;
    const badge = titleLine.querySelector('.trae-ext-solved');
    if (!topic.solved) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      const newBadge = document.createElement('span');
      newBadge.className = 'trae-ext-solved';
      newBadge.textContent = '✓ 已解决';
      titleLine.appendChild(newBadge);
    }
  }

  function enhanceRow(row) {
    const topic = topicCache.get(row.dataset.topicId);
    if (!topic) return;
    row.classList.add(ROW_MARK);
    const temp = computeTemperature(topic);
    addLikesBadge(row, topic, temp);
    addTemperature(row, topic);
    addSolvedBadge(row, topic);
  }

  function enhanceVisibleRows() {
    document.querySelectorAll('.topic-list-item[data-topic-id]').forEach(enhanceRow);
    Emotion.enhanceRows();
    Emotion.ensurePanel();
    rememberRowOrder();
    injectHeatSortHeader();
    injectHeatSortToolbar();
  }

  function watchRows() {
    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(enhanceVisibleRows, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ---------------- 随机漫游 ---------------- */

  function extractUrls(xml, filter) {
    const urls = [];
    const pattern = /<loc>([^<]+)<\/loc>/g;
    let match;
    while ((match = pattern.exec(xml)) !== null) {
      if (filter(match[1])) urls.push(match[1]);
    }
    return urls;
  }

  function pickRandomFromSitemap() {
    const isTopicUrl = (u) => /\/t\//.test(u);
    const isChildSitemap = (u) => /sitemap_\d+\.xml$/.test(u);
    return fetch('/sitemap.xml')
      .then((res) => res.text())
      .then((indexXml) => {
        const topics = extractUrls(indexXml, isTopicUrl);
        if (topics.length) return pickRandom(topics);
        const children = extractUrls(indexXml, isChildSitemap);
        if (!children.length) return null;
        return fetch(pickRandom(children))
          .then((res) => res.text())
          .then((childXml) => pickRandom(extractUrls(childXml, isTopicUrl)) || null);
      });
  }

  function pickRandomFromLatest() {
    return fetch('/latest.json', { headers: { Accept: 'application/json' } })
      .then((res) => res.json())
      .then((data) => {
        const topics = (data.topic_list && data.topic_list.topics) || [];
        const topic = pickRandom(topics);
        return topic ? `/t/topic/${topic.id}` : null;
      });
  }

  function randomWander() {
    return pickRandomFromSitemap()
      .catch(() => null)
      .then((url) => url || pickRandomFromLatest().catch(() => null))
      .then((url) => {
        if (url) location.href = url;
      });
  }

  /* ---------------- 热度排序 ---------------- */

  function getStoredHeatSort() {
    try {
      const v = localStorage.getItem(SORT_STATE_KEY);
      if (v === 'asc' || v === 'desc') return v;
    } catch (err) {
      /* ignore */
    }
    return null;
  }

  function setStoredHeatSort(dir) {
    try {
      if (dir) localStorage.setItem(SORT_STATE_KEY, dir);
      else localStorage.removeItem(SORT_STATE_KEY);
    } catch (err) {
      /* ignore */
    }
  }

  function sortTopicRows(dir) {
    const table = document.querySelector('.topic-list');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll(':scope > tr.topic-list-item'));
    if (rows.length < 2) return;

    const scored = rows.map((row) => {
      const id = row.dataset.topicId;
      const topic = topicCache.get(id);
      const temp = topic ? computeTemperature(topic) : 0;
      return { row, temp };
    });

    const mult = dir === 'asc' ? 1 : -1;
    scored.sort((a, b) => (a.temp - b.temp) * mult);

    const frag = document.createDocumentFragment();
    for (const s of scored) frag.appendChild(s.row);
    tbody.appendChild(frag);
  }

  function toggleHeatSort() {
    const next = heatSortState === 'desc' ? 'asc' : 'desc';
    heatSortState = next;
    setStoredHeatSort(next);
    sortTopicRows(next);
    updateHeatSortUI();
  }

  function clearHeatSort() {
    heatSortState = null;
    setStoredHeatSort(null);
    const table = document.querySelector('.topic-list');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll(':scope > tr.topic-list-item'));
    rows.sort((a, b) => {
      const ai = a.dataset.topicIndex || 0;
      const bi = b.dataset.topicIndex || 0;
      return ai - bi;
    });
    const frag = document.createDocumentFragment();
    for (const r of rows) frag.appendChild(r);
    tbody.appendChild(frag);
    updateHeatSortUI();
  }

  function buildHeatTh() {
    const th = document.createElement('th');
    th.setAttribute('data-sort-order', 'heat');
    th.setAttribute('scope', 'col');
    th.className = 'topic-list-data heat sortable num trae-ext-heat-th';
    th.innerHTML = '<button>🌡热度</button>';
    th.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleHeatSort();
    });
    return th;
  }

  function injectHeatSortHeader() {
    if (!matchesList(location.href)) return;
    const thead = document.querySelector('.topic-list thead tr');
    if (!thead) return;
    if (thead.querySelector('.trae-ext-heat-th')) return;

    const lastTh = thead.querySelector('th.topic-list-data.sortable:last-of-type');
    if (lastTh) lastTh.after(buildHeatTh());
    else thead.appendChild(buildHeatTh());
  }

  function buildHeatToolbarButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-icon-text d-combo-button-button trae-ext-heat-btn';
    btn.setAttribute('aria-label', '按热度排序');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="1em" height="1em"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>' +
      '<span class="d-button-label">热度</span>';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleHeatSort();
    });
    return btn;
  }

  function injectHeatSortToolbar() {
    if (!matchesList(location.href)) return;
    const createCombo = document.querySelector('.topic-create-button__combo');
    if (!createCombo) return;
    if (createCombo.previousElementSibling?.classList?.contains('trae-ext-heat-btn')) return;

    const btn = buildHeatToolbarButton();
    createCombo.parentElement.insertBefore(btn, createCombo);
  }

  function updateHeatSortUI() {
    const th = document.querySelector('.trae-ext-heat-th');
    const tbBtn = document.querySelector('.trae-ext-heat-btn');

    if (heatSortState) {
      if (th) {
        th.classList.add('is-active');
        th.classList.toggle('is-asc', heatSortState === 'asc');
        th.classList.toggle('is-desc', heatSortState === 'desc');
        th.querySelector('button').textContent = heatSortState === 'desc' ? '🌡热度 ↓' : '🌡热度 ↑';
      }
      if (tbBtn) {
        tbBtn.classList.add('trae-ext-heat-active');
        const label = tbBtn.querySelector('.d-button-label');
        if (label) label.textContent = heatSortState === 'desc' ? '热度 ↓' : '热度 ↑';
      }
    } else {
      if (th) {
        th.classList.remove('is-active', 'is-asc', 'is-desc');
        th.querySelector('button').textContent = '🌡热度';
      }
      if (tbBtn) {
        tbBtn.classList.remove('trae-ext-heat-active');
        const label = tbBtn.querySelector('.d-button-label');
        if (label) label.textContent = '热度';
      }
    }
  }

  function rememberRowOrder() {
    document.querySelectorAll('.topic-list-item[data-topic-id]').forEach((row, i) => {
      row.dataset.topicIndex = String(i);
    });
  }

  function initHeatSort() {
    heatSortState = getStoredHeatSort();
    rememberRowOrder();
    injectHeatSortHeader();
    injectHeatSortToolbar();
    if (heatSortState) {
      setTimeout(() => {
        sortTopicRows(heatSortState);
        updateHeatSortUI();
      }, 150);
    }
    updateHeatSortUI();

    let lastUrl = location.pathname + location.search;
    setInterval(() => {
      const cur = location.pathname + location.search;
      if (cur !== lastUrl) {
        lastUrl = cur;
        if (heatSortState) {
          const urlOrder = new URLSearchParams(location.search).get('order');
          if (urlOrder && urlOrder !== 'heat') {
            heatSortState = null;
            setStoredHeatSort(null);
          }
        }
        rememberRowOrder();
        injectHeatSortHeader();
        injectHeatSortToolbar();
        if (heatSortState) {
          setTimeout(() => {
            sortTopicRows(heatSortState);
            updateHeatSortUI();
          }, 200);
        } else {
          updateHeatSortUI();
        }
      }
    }, 500);
  }

  /* ---------------- 顶栏按钮 ---------------- */

  function createHeaderButton(svg, label, onClick) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon btn-flat trae-ext-btn';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = svg;
    button.addEventListener('click', onClick);
    item.appendChild(button);
    return item;
  }

  function injectHeaderButtons() {
    const icons = document.querySelector('.d-header-icons');
    if (!icons || icons.querySelector('.trae-ext-btn')) return;

    icons.appendChild(
      createHeaderButton(DICE_SVG, '随机漫游：随机打开一个帖子', () => {
        const button = icons.querySelector('.trae-ext-btn');
        if (button && !button.classList.contains('trae-ext-spinning')) {
          button.classList.add('trae-ext-spinning');
          setTimeout(() => button.classList.remove('trae-ext-spinning'), 2000);
          randomWander();
        }
      })
    );

    const darkButton = document.createElement('button');
    darkButton.type = 'button';
    darkButton.className = 'icon btn-flat trae-ext-btn trae-ext-dark-toggle';
    darkButton.addEventListener('click', () => setDark(!isDark()));
    const darkItem = document.createElement('li');
    darkItem.appendChild(darkButton);
    icons.appendChild(darkItem);
    icons.appendChild(Emotion.buildToggleBtn());
    Emotion.updateToggleBtn();
    updateToggleButton();
  }

  /* ---------------- 暗黑模式 ---------------- */

  function isDark() {
    return document.documentElement.classList.contains('trae-dark');
  }

  function setDark(on) {
    document.documentElement.classList.toggle('trae-dark', on);
    try {
      localStorage.setItem(DARK_KEY, on ? '1' : '0');
    } catch (err) {
      /* 隐私模式下忽略存储失败 */
    }
    updateToggleButton();
  }

  function updateToggleButton() {
    const button = document.querySelector('.trae-ext-dark-toggle');
    if (!button) return;
    const dark = isDark();
    button.setAttribute('aria-label', dark ? '切换到明亮模式' : '切换到暗黑模式');
    button.title = button.getAttribute('aria-label');
    button.innerHTML = dark ? SUN_SVG : MOON_SVG;
  }

  /* ---------------- 回到顶部 ---------------- */

  const BACKTOP_SHOW_AT = 400;

  function injectBackToTop() {
    if (document.querySelector('.trae-ext-backtop')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'trae-ext-backtop';
    btn.setAttribute('aria-label', '回到顶部');
    btn.title = '回到顶部';
    btn.innerHTML = UP_ARROW_SVG;
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.body.appendChild(btn);

    const onScroll = () => {
      btn.classList.toggle('is-visible', window.scrollY > BACKTOP_SHOW_AT);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------------- 样式 ---------------- */

  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'trae-ext-style';
    style.textContent =
      '.trae-ext-likes{margin-left:.6em;font-size:.85em;color:var(--love,#fa6c8d);white-space:nowrap;}' +
      '.trae-ext-solved{display:inline-block;margin-left:.5em;padding:1px 8px;font-size:.72em;line-height:1.6;color:var(--success,#34c77b);border:1px solid currentColor;border-radius:10px;vertical-align:2px;white-space:nowrap;}' +
      '.trae-ext-temp{display:inline-block;width:34px;height:6px;margin-left:.6em;border-radius:3px;background:var(--primary-low,#e9e9e9);vertical-align:1px;overflow:hidden;}' +
      '.trae-ext-temp-fill{display:block;height:100%;border-radius:3px;}' +
      '.trae-ext-spinning svg{animation:trae-ext-spin .6s ease;}' +
      '@keyframes trae-ext-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}' +
      '.trae-ext-heat-th{position:relative;}' +
      '.trae-ext-heat-th.is-active{color:var(--tertiary,#3f8fd6);font-weight:600;}' +
      '.trae-ext-heat-th.is-active::after{content:"";position:absolute;bottom:2px;left:50%;transform:translateX(-50%);width:6px;height:6px;border-radius:50%;background:var(--tertiary,#3f8fd6);}' +
      '.trae-ext-heat-btn{margin-right:8px;}' +
      '.trae-ext-heat-btn.trae-ext-heat-active{background:var(--tertiary-low-mid,#20507e);color:#fff;border-color:var(--tertiary,#3f8fd6);}' +
      '.trae-ext-backtop{position:fixed;right:96px;bottom:28px;z-index:1200;width:40px;height:40px;display:flex;align-items:center;justify-content:center;padding:0;border:1px solid var(--primary-low-mid,#dadada);border-radius:50%;background:var(--secondary,#fff);color:var(--primary,#222);cursor:pointer;opacity:0;visibility:hidden;transform:translateY(8px);box-shadow:0 2px 8px rgba(0,0,0,.18);transition:opacity .2s ease,visibility .2s ease,transform .2s ease,background .15s ease,color .15s ease,border-color .15s ease;}' +
      '.trae-ext-backtop.is-visible{opacity:1;visibility:visible;transform:translateY(0);}' +
      '.trae-ext-backtop:hover{background:var(--tertiary-low-mid,#20507e);border-color:var(--tertiary,#3f8fd6);color:#fff;}' +
      '.trae-ext-backtop svg{width:20px;height:20px;pointer-events:none;}' +
      '.trae-ext-emotion-toggle{font-size:16px;color:var(--header_primary,#333);}' +
      '.trae-ext-emotion-toggle.is-off{filter:grayscale(1);opacity:.45;}' +
      '.trae-ext-emotion{display:inline-block;width:1.35em;text-align:center;font-size:14px;line-height:1;margin-right:3px;vertical-align:0.1em;font-family:"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif;}' +
      '#trae-ext-emotion-panel{position:fixed;left:16px;bottom:28px;z-index:1200;max-width:min(430px,92vw);font-size:13px;color:var(--primary,#222);}' +
      '#trae-ext-emotion-panel .eep-bar{padding:7px 12px;border:1px solid var(--primary-low-mid,#dadada);border-radius:16px;background:var(--secondary,#fff);color:var(--primary,#222);cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.15);font-size:12.5px;}' +
      '#trae-ext-emotion-panel.is-open{display:flex;flex-direction:column-reverse;background:var(--secondary,#fff);border:1px solid var(--primary-low-mid,#dadada);border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.2);}' +
      '#trae-ext-emotion-panel.is-open .eep-body{max-height:46vh;}' +
      '#trae-ext-emotion-panel .eep-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--primary-low,#e9e9e9);font-weight:600;}' +
      '#trae-ext-emotion-panel .eep-title{flex:1;font-size:12.5px;}' +
      '#trae-ext-emotion-panel .eep-refresh,#trae-ext-emotion-panel .eep-fold{border:none;background:none;cursor:pointer;font-size:14px;color:var(--primary-medium,#666);padding:2px 6px;}' +
      '#trae-ext-emotion-panel .eep-body{padding:8px 12px;max-height:46vh;overflow:auto;}' +
      '#trae-ext-emotion-panel .eep-counts{display:flex;flex-wrap:wrap;gap:6px 12px;margin-bottom:6px;}' +
      '#trae-ext-emotion-panel .eep-item.is-zero{opacity:.55;}' +
      '#trae-ext-emotion-panel .eep-group{margin-top:6px;}' +
      '#trae-ext-emotion-panel .eep-gt{font-weight:600;margin-bottom:2px;}' +
      '#trae-ext-emotion-panel .eep-group ul{margin:0;padding-left:18px;}' +
      '#trae-ext-emotion-panel .eep-group li{margin:1px 0;}' +
      '#trae-ext-emotion-panel .eep-group a{color:var(--tertiary,#3f8fd6);text-decoration:none;}' +
      '#trae-ext-emotion-panel .eep-empty{color:var(--primary-medium,#666);}' +
      '#trae-ext-emotion-panel .eep-scope{font-size:11.5px;color:var(--primary-medium,#666);margin-bottom:6px;}' +
      '@media (max-width:700px){#trae-ext-emotion-panel{left:8px;bottom:16px;max-width:92vw;}#trae-ext-emotion-panel .eep-body{max-height:40vh;}}' +
      DARK_OVERRIDES;
    (document.head || document.documentElement).appendChild(style);
  }

  const DARK_OVERRIDES = `
html.trae-dark{
  color-scheme:dark;
  --primary:#e8e8e6;
  --secondary:#18191c;
  --tertiary:#6cb2ff;
  --quaternary:#b3d4ff;
  --header_background:#121316;
  --header_primary:#e8e8e6;
  --danger:#e45735;
  --success:#34c77b;
  --love:#fa6c8d;
  --highlight:#3d3717;
  --highlight-low:#332e14;
  --highlight-medium:#57501f;
  --highlight-high:#8a7f31;
  --primary-very-low:#232428;
  --primary-low:#2c2d32;
  --primary-low-mid:#4a4b52;
  --primary-medium:#8b8d94;
  --primary-high:#c9cacd;
  --primary-50:#232428;
  --primary-100:#28292e;
  --primary-200:#303136;
  --primary-300:#3a3b41;
  --primary-400:#4a4b52;
  --primary-500:#62636b;
  --primary-600:#8b8d94;
  --primary-700:#b0b2b8;
  --primary-800:#d0d2d6;
  --primary-900:#e8e8e6;
  --secondary-very-low:#1c1d20;
  --secondary-low:#222327;
  --secondary-medium:#2c2d32;
  --secondary-high:#3a3b41;
  --secondary-very-high:#4a4b52;
  --secondary-50:#1c1d20;
  --secondary-100:#202124;
  --secondary-200:#26272b;
  --secondary-300:#2c2d32;
  --secondary-400:#34353b;
  --secondary-500:#404148;
  --secondary-600:#54555d;
  --secondary-700:#73747c;
  --secondary-800:#9b9ca3;
  --secondary-900:#c9cacd;
  --tertiary-very-low:#152736;
  --tertiary-low:#1d3a56;
  --tertiary-low-mid:#20507e;
  --tertiary-medium:#3f8fd6;
  --tertiary-high:#6cb2ff;
  --tertiary-hover:#94c9ff;
  --tertiary-25:rgba(108,178,255,.08);
  --tertiary-50:rgba(108,178,255,.12);
  --tertiary-100:rgba(108,178,255,.2);
  --tertiary-200:#1d3a56;
  --tertiary-300:#20507e;
  --tertiary-400:#2a68a5;
  --tertiary-500:#3f8fd6;
  --tertiary-600:#57a2ec;
  --tertiary-700:#6cb2ff;
  --tertiary-800:#94c9ff;
  --tertiary-900:#c2e0ff;
  --blend-primary-secondary-5:#212226;
  --d-hover:#26272b;
  --primary-rgb:232,232,230;
  --secondary-rgb:24,25,28;
  --tertiary-rgb:108,178,255;
  --primary-low-mid-rgb:74,75,82;
  --secondary-very-high-rgb:74,75,82;
  --d-hover-rgb:38,39,43;
  --header_primary-rgb:232,232,230;
  /* 行内代码 / 代码块背景（浅色块 bug 主因） */
  --inline-code-bg:#2c2d32;
  --hljs-bg:#232428;
  /* success 衍生（"已解决"等绿色徽章背景） */
  --success-rgb:52,199,123;
  --success-low:#1a3a2a;
  --success-medium:#235c3e;
  --success-hover:#2ea86e;
  /* highlight 衍生（行内高亮/搜索高亮背景） */
  --highlight-rgb:212,158,60;
  --highlight-bg:#3d3717;
  --highlight-low-or-medium:#3d3717;
  /* danger 衍生 */
  --danger-low:#3a2320;
  --danger-low-mid:rgba(228,87,53,.35);
  --danger-medium:#a5402c;
  --danger-hover:#c94e37;
  /* love 衍生 */
  --love-low:#3a2438;
  /* 选中 / hover 背景 */
  --d-selected:#2c2d32;
  --d-selected-hover:#34353b;
  --d-selected-text-color:#e8e8e6;
  /* 供 rgba() 使用的 rgb 通道 */
  --primary-low-rgb:44,45,50;
  --primary-very-low-rgb:35,36,40;
  /* 强调文字色（亮色主题下为深色，暗黑下需提亮） */
  --primary-very-high:#dedfe2;
  /* -or- 合成变量：亮色主题下解析为浅色，暗黑下改指向对应深色变量 */
  --primary-or-primary-low-mid:var(--primary);
  --secondary-or-primary:var(--secondary);
  --tertiary-or-tertiary-low:var(--tertiary);
  --tertiary-med-or-tertiary:var(--tertiary);
  --tertiary-or-white:var(--tertiary);
  --tertiary-low-or-tertiary-high:var(--tertiary-high);
  --primary-med-or-secondary-med:var(--primary-medium);
  --primary-med-or-secondary-high:var(--primary-medium);
  --primary-high-or-secondary-low:var(--primary-high);
  --primary-low-mid-or-secondary-high:var(--primary-low-mid);
  --primary-low-mid-or-secondary-low:var(--primary-low-mid);
}
html.trae-dark body{background:var(--secondary);}
/* 图片亮度自动调节：暗黑下调暗白底截图/照片，头像、emoji 不受影响，悬停还原原色 */
html.trae-dark .cooked img:not(.emoji):not(.avatar),
html.trae-dark .lightbox-wrapper img:not(.emoji):not(.avatar),
html.trae-dark .d-editor-preview img{
  filter:brightness(.85) saturate(.95);
  transition:filter .25s ease;
}
html.trae-dark .cooked img:not(.emoji):not(.avatar):hover,
html.trae-dark .lightbox-wrapper img:not(.emoji):not(.avatar):hover,
html.trae-dark .d-editor-preview img:hover{
  filter:none;
}
/* 夜间文字角色修正（机制性）：
   有些组件把“文字色”绑定到背景系/低明度变量，纯变量覆盖天然管不到，定点重绑。
   原则：只调明度/重绑到文字系变量，不碰背景变量；状态色保色相、提明度。 */
html.trae-dark{
  /* 纯文字用途的变量：直接在夜间改值（这些变量只用于 color，不涉及边框/背景） */
  --d-post-control-text-color:var(--primary-medium);   /* 帖子操作区文字：原 #4a4b52 ≈2.03 */
  --d-post-control-icon-color:var(--primary-medium);
  /* hljs 语法高亮：站点只给了亮色 token 色板，暗底下关键字/字符串/标题全糊（实测 2.03~3.18） */
  --hljs-keyword:#8ab4ff;   /* 原 #015692 ≈2.03 */
  --hljs-attr:#7dcfff;      /* 原 #015692 ≈2.3 */
  --hljs-string:#9ece6a;    /* 原 #54790d ≈3.04 */
  --hljs-title:#e0af68;     /* 原 #b75501 ≈3.18 */
  --hljs-name:#e0af68;
  --hljs-punctuation:#a9b2c3; /* 原 #535a60 ≈2.51 */
  --hljs-addition:#9ece6a;
  --hljs-variable:#c0caf5;
  --hljs-symbol:#c0caf5;
}
html.trae-dark .chat-message-info__username__name{ /* 私信发送者用户名：原误用背景系 var(--secondary-low)，夜间 #222327 on #18191c ≈1.06:1 */
  color:var(--primary-high);
}
html.trae-dark .reactions-counter{ /* 表情回应计数：原 var(--primary-low-mid) #4a4b52 ≈2.03:1 */
  color:var(--primary-medium);
}
html.trae-dark .topic-post-visited-message{ /* 「上次访问」分隔线：原 --danger-medium 暗红 ≈2.82:1，保色相提明度 */
  color:#f08a70;
}
/* 误用极浅灰/背景系变量作文字（个人主页元信息标签实测 1.28:1，用户截图那处） */
html.trae-dark .user-main .about .secondary dt,
html.trae-dark .user-main .about dt{
  color:var(--primary-medium);
}
/* chat 同族：线索标题/旗帜/建频道提示（同绑 --secondary-low / --secondary-medium） */
html.trae-dark .chat-thread__heading-title,
html.trae-dark .chat-thread__heading-icon{ color:var(--primary-high); }
html.trae-dark .chat-modal-create-channel__hint,
html.trae-dark .chat-message-info__flag{ color:var(--primary-medium); }
/* danger-medium 系文字（保色相提明度）：「有更新」提示、搜索页警示 */
html.trae-dark #list-area .unseen,
html.trae-dark .search-container .warning{ color:#f08a70; }
`;

  /* ---------------- 情绪标记 + 今日情绪面板（实验） ----------------
   * C1 结构+句式规则（非裸词表）+ 正面弱信号叠加。
   * 拿不准一律「中」不显示。开关：头部 😄 按钮，或 localStorage tfe-emotion-enabled=0。
   * 复用脚本已有的 MutationObserver：enhanceRows 由 enhanceVisibleRows 调用，不另开观察者。
   */

  const Emotion = (function () {
    const POS_STRONG = ['厉害','给力','吹一波','真香','丝滑','惊喜','完美','优秀','赞','牛逼','棒','强得','太强','好用','不错','满意','顺手','清爽','感谢','谢谢','漂亮','根治','起飞'];
    const NEG_STRONG = ['垃圾','恶心','愤怒','气死','离谱','太差','受不了','忍不了','烂','废物'];
    const NEG_SOFT = ['失望','难受','愁','担心','吐槽','后悔','踩坑','劝退','翻车','无语','炸'];
    const ISSUE_WORDS = ['报错','崩溃','卡死','卡顿','白屏','黑屏','闪退','失败','无法','异常','超时','没反应','进不去','连不上','打不开','消失','不提示','不工作','不管用','不好用','没了','降低','吃掉','吃完','拖后腿','卡得要死','卡爆','crash','crashing','error','fail','failed','broken','unusable','slow'];
    const NEGATE_NEAR = ['不','没','无','别','未'];
    const WEAK_POS = ['省事','省心','高效','彩蛋','神器','惊喜','好看','提升','效率','顺滑','方便'];

    const EMOJI = { '喜': '😄', '怒': '😠', '哀': '😢', '反讽': '😅', '求助': '🆘' };
    const TIP = {
      '喜': '情绪：偏正面（结构规则判定，仅供参考）',
      '怒': '情绪：激烈负面（仅供参考）',
      '哀': '情绪：偏负面（仅供参考）',
      '反讽': '疑似反讽/正话反说（仅供参考）',
      '求助': '求助帖',
    };

    function hasAny(t, arr) { return arr.some((w) => t.indexOf(w) !== -1); }
    function nearNegated(t, idx) {
      const pre = t.slice(Math.max(0, idx - 2), idx);
      return NEGATE_NEAR.some((n) => pre.indexOf(n) !== -1);
    }
    function isRequest(t) {
      if (/希望.{0,10}(别|不要|别再|怕)/.test(t)) return false;
      return /^(希望|能不能|可不可以|能否|建议|求|请问|想问|想咨询|小白|请教)/.test(t)
        || /(希望|能不能|可不可以|能否|建议).{0,12}(支持|加|优化|改进|出|做|开放|提供)/.test(t)
        || /(有没有|是否|是不是).{0,16}(吗|？|\?)$/.test(t)
        || (/(怎么办|怎么解|如何|咋)/.test(t) && /(吗|？|\?|求助)/.test(t));
    }
    function isHelpPost(t, cat) {
      return /求助|求问|求指导|怎么办|怎么解|有没有人.{0,6}(知道|遇到|试过|成功|碰到)/.test(t) || /求助/.test(cat);
    }
    function isSarcasm(t) {
      if (/(好|棒|稳定|厉害|优秀|贴心|高效)(到|得)(我|你|它|直接)?/.test(t) && hasAny(t, ISSUE_WORDS.concat(['重启','戒','吃','疯','死']))) return true;
      if (/(感谢|谢谢|成功|好家伙).{0,12}(戒|成功让我|再也不用|逼|劝退)/.test(t)) return true;
      if (/太(好|棒|稳定|厉害)了/.test(t) && /(重启|白屏|崩|卡|失败)/.test(t)) return true;
      if (/(真|太|可)?(厉害|棒|牛|优秀|强大).{0,10}(能|可以)?(把)?.{0,12}(吃完|吃掉|占满|耗光|搞崩|跑满)/.test(t)) return true;
      if (/🙃|😅/.test(t)) return true;
      return false;
    }
    function isQuoting(t) {
      return /(有人说|听说|看到|好多人|大家都说|别人|群里|论坛里).{0,12}(说|讲|提|反馈|吐槽)/.test(t);
    }
    function isRhetorical(t) {
      return /(这也叫|这叫|算什么|什么决策|谁想的|怎么想的|是feature|是特性|就我一个)/.test(t)
        || (/(？|\?)/.test(t) && hasAny(t, ISSUE_WORDS));
    }
    function isDoubleNegation(t) {
      if (!/(不是不|不能说没|并非不|算不上不)/.test(t)) return false;
      if (/(压根|根本|简直)(就)?(没法|不能|不行|用不了)/.test(t)) return false;
      return true;
    }
    // 玩梗/惊叹语境：表情包大赛、脑洞帖里「救命」「离谱」是夸张赞叹，不是愤怒
    function isPlayful(t) {
      const fun = /(救命|笑死|哈哈|😂|🤣|😱|🤯|脑洞|整活|玩梗)/.test(t);
      const intense = /(离谱|绝了|逆天|太绝|笑不活)/.test(t);
      if (fun && intense) return true;
      if (/(表情包|大赛|挑战赛)/.test(t) && fun) return true;
      return false;
    }

    /* 软负面词分层（v0.6.8）
     * 背景：v0.6.7 把 11 个词统一当作「出现即负面」，464754 的「附全部翻车记录」被误判 😢。
     * 结构结论：这些词在标题里的句法角色不同，不能共用一条规则。
     * - NEG_HARD：表达作者自身状态，保留「出现即负面」。
     * - NEG_NARR：在论坛里多为经历叙述（翻车记录 / 从翻车到爆款 / 别人翻车 / 专治翻车），
     *   默认不构成负面证据；只有出现「产品主语」或「后果句」时才判哀。
     */
    const NEG_HARD = ['失望', '难受', '愁', '担心', '吐槽', '后悔', '劝退', '无语', '炸'];
    const NEG_NARR = ['翻车', '踩坑', '踩雷'];
    const NARR_META_AFTER = /^(记录|实录|现场|合集|日记|经历|复盘|全过程|经过|清单|集锦|观测|无数|到|变成|变|逆袭|爆款)/;
    const THIRD_PRE = /(看到|围观|别人|他人|同事|群友|有人|大家|朋友|集体|行业|厂商|制造业).{0,8}$/;
    const SOLVE_PRE = /(专治|避免|防止|告别|远离|拒绝|根治).{0,10}$/;
    const SELF_PRE = /(^|[^A-Za-z])我(们)?(也|又|第一次|差点|直接|居然|竟然|今天|昨晚)?$/;
    const NARR_CONSEQUENCE = /(崩溃|死循环|全废|卡死|失败|报错|白干|窝火|气死|哭|唉|完了|丢|扣|没了)/;
    const PRODUCT_PRE = /(TRAE|Trae|trae|版本|更新|它).{0,8}$/;

    // 元话语：词在说「内容/他人经历」，不在表达作者情绪 → 判中
    function narrMeta(t, w) {
      const i = t.indexOf(w);
      const pre = t.slice(Math.max(0, i - 10), i);
      const post = t.slice(i + w.length, i + w.length + 8);
      if (/[“"「『]$/.test(pre) && /^[”"」』]/.test(post)) return true;  // 引号内=提及而非使用
      if (NARR_META_AFTER.test(post)) return true;                        // 翻车记录 / 从翻车到爆款
      if (THIRD_PRE.test(pre) || SOLVE_PRE.test(pre)) return true;        // 别人翻车 / 专治翻车
      if (SELF_PRE.test(pre) && !PRODUCT_PRE.test(t)) return true;        // 我翻车了（自嘲）
      return false;
    }
    // 叙述词只有在「后果句 / 产品主语」时才算负面
    function narrNegative(t, w) {
      const i = t.indexOf(w);
      const pre = t.slice(Math.max(0, i - 10), i);
      if (nearNegated(t, i) || /零$/.test(t.slice(Math.max(0, i - 2), i))) return false;
      if (narrMeta(t, w)) return false;
      if (NARR_CONSEQUENCE.test(t)) return true;                          // 翻车……死循环/崩溃/唉
      return PRODUCT_PRE.test(pre);                                       // TRAE 又翻车了 / 更新翻车
    }

    // 输入 { title, category, solved }；输出 { label, reason }；label='中' 表示不显示
    function score(input) {
      const t = String(input.title || '').trim();
      const cat = input.category || '';
      if (!t) return { label: '中', reason: '空输入' };
      if (input.solved) return { label: '中', reason: '已有采纳答案，负面压制' };
      if (/求助|求问|求指导|求大佬/.test(t)) return { label: '求助', reason: '显式求助词' };
      if (isRequest(t)) return { label: '中', reason: '请求/建议句式，不算负面情绪' };
      if (isHelpPost(t, cat)) return { label: '求助', reason: '问题求助分类' };
      if (isWorry(t)) return { label: '哀', reason: '担忧/唱衰句式' };
      if (isSarcasm(t)) return { label: '反讽', reason: '正话反说句式' };
      if (isDoubleNegation(t)) return { label: '中', reason: '双重否定，按中性处理' };
      if (isQuoting(t) && hasAny(t, ISSUE_WORDS.concat(NEG_SOFT))) return { label: '中', reason: '转述语境，作者本人非负面' };
      if (isRhetorical(t)) return { label: '哀', reason: '疑问式吐槽' };

      const pivot = t.match(/(但|但是|可是|然而|就是)(.{1,30})$/);
      if (pivot) {
        const tail = pivot[2];
        if (/(卡|慢|难|差|坑|气|烦|bug|BUG|Bug)(得|到)?(要死|要命|爆|吐|疯|炸|多|惨)?/.test(tail) && !/(快|好|爽|稳|顺|支持|棒|喜欢)/.test(tail)) {
          return { label: '哀', reason: '转折后句为吐槽' };
        }
        if (/(支持|喜欢|赞|好用|不错|稳定|快|顺)/.test(tail)) return { label: '喜', reason: '转折后句为肯定' };
      }

      if (/(强|好|快|牛|美|稳)得(离谱|夸张|逆天)/.test(t)) return { label: '喜', reason: '程度副词褒用' };
      if (isPlayful(t)) return { label: '中', reason: '玩梗/惊叹语境，不判负面' };
      const strong = NEG_STRONG.find((w) => t.indexOf(w) !== -1);
      if (strong && !nearNegated(t, t.indexOf(strong))) return { label: '怒', reason: '强烈负面词：' + strong };
      if (/(压根|根本|简直|实在)(就)?(没法|用不了|不能用|不行)/.test(t)) return { label: '哀', reason: '强调式后果：没法用' };
      const hard = NEG_HARD.find((w) => t.indexOf(w) !== -1);
      if (hard) return { label: '哀', reason: '软化负面词：' + hard };
      const narr = NEG_NARR.find((w) => t.indexOf(w) !== -1);
      if (narr) {
        if (narrMeta(t, narr)) return { label: '中', reason: '叙述/复盘口吻（' + narr + '），元话语不构成本帖情绪' };
        if (narrNegative(t, narr)) return { label: '哀', reason: '叙述负面词+后果：' + narr };
      }

      const issue = ISSUE_WORDS.find((w) => t.indexOf(w) !== -1);
      if (issue) {
        const suppressed = nearNegated(t, t.indexOf(issue)) || /(机制|原理|设计|讨论|科普|教程|指南|日志|排查|监控|告警)/.test(t);
        if (!suppressed) {
          if (/[a-zA-Z]/.test(issue)) return { label: '哀', reason: '英文问题词「' + issue + '」' };
          if (/Bug|反馈/.test(cat)) return { label: '哀', reason: '「' + issue + '」+ Bug反馈分类印证' };
          if (/(我|我的|一直|突然|直接|连续|又)/.test(t)) return { label: '哀', reason: '「' + issue + '」+ 第一人称/后果句式' };
        }
      }

      if (/(修得|补得|改得|做得|优化得)(真|好|太)?(狠|漂亮|绝|稳|到位)/.test(t)
        || /(修复|解决|搞定)后.{0,8}(稳定|流畅|正常|好用|丝滑|快)/.test(t)) {
        return { label: '喜', reason: '贬词褒用/根治句式' };
      }
      const pos = POS_STRONG.find((w) => t.indexOf(w) !== -1);
      if (pos && !(pos === '赞' && /\d+\s*(个|多)?\s*赞/.test(t)) && !/^(希望|能不能|建议|求)/.test(t) && !/(吗|？|\?)$/.test(t) && !nearNegated(t, t.indexOf(pos))) {
        return { label: '喜', reason: '夸赞信号：' + pos };
      }

      /* ---- 弱信号层：只处理上面判「中」的 ---- */
      if (/(偷|扣)(了)?(我|我的)/.test(t)) return { label: '哀', reason: '投诉语境：偷/扣+第一人称' };
      if (/太拉了|拉胯|拉了|巨额.{0,4}(消耗|损失|浪费)/.test(t)) return { label: '哀', reason: '负面弱信号' };
      // R11 晒福利/奖励喜悦：福利名词 + 非疑问 + 无负面语境
      if (!/(吗|？|\?)$/.test(t) && !/官方|福利活动/.test(cat)
        && /(快递|奖励|礼物|周边|礼盒|奖品|中奖|抽中)/.test(t)
        && !/(报错|崩溃|失败|无法|问题|没收到|没到|丢失|丢了|少了)/.test(t)) {
        return { label: '喜', reason: '福利/奖励分享语境' };
      }
      if (!/(吗|？|\?)$/.test(t) && !/官方|福利活动/.test(cat)) {
        let wp = 0;
        const hits = [];
        if (/分享(一下|几个|我的|下|经验|这套)/.test(t) && /(系统|技巧|经验|项目|小程序|工具|作品|自动化|玩法|思路)/.test(t)) { wp += 2; hits.push('分享+作品'); }
        else if (/分享(一下|几个|我的|下)/.test(t)) { wp++; hits.push('分享'); }
        if (/^【[^】]*(结营作业|案例|作品|测评|实测|体验|技巧)[^】]*】/.test(t)) { wp++; hits.push('作品/测评标签'); }
        if (/(上线了|发布了|开源了|搞定了|补齐了|完成了|做出来了|跑通了)/.test(t)) { wp++; hits.push('完成态'); }
        const w = WEAK_POS.find((x) => t.indexOf(x) !== -1);
        if (w && !nearNegated(t, t.indexOf(w))) { wp++; hits.push('弱正面:' + w); }
        if (/(欢迎体验|欢迎试用|晒一晒|晒一下|晒晒)/.test(t)) { wp++; hits.push('展示邀请'); }
        if (/案例与作品|技巧分享/.test(cat) && !/(报错|崩溃|失败|无法|问题|bug)/i.test(t)) { wp++; hits.push('作品/技巧分类'); }
        if (wp >= 2) return { label: '喜', reason: '正面弱信号×' + wp + '：' + hits.join('、') };
      }
      return { label: '中', reason: '无置信信号，兜底不显示' };
    }

    function isWorry(t) { return /(别被|怕被|担心|生怕|拖后腿|毁掉|搞砸|黄了|走下坡路)/.test(t); }

    /* ---- 开关状态：统一键 tfe-emotion-enabled（'1'开/'0'关），迁移旧键 tfe-emotion-off ---- */
    const ON_KEY = 'tfe-emotion-enabled';
    const LEGACY_OFF_KEY = 'tfe-emotion-off';
    function migrateKey() {
      try {
        if (localStorage.getItem(ON_KEY) !== null) return;
        const old = localStorage.getItem(LEGACY_OFF_KEY);
        if (old !== null) {
          localStorage.setItem(ON_KEY, old === '1' ? '0' : '1'); // 旧键语义是"关闭"→取反
          localStorage.removeItem(LEGACY_OFF_KEY);
        }
      } catch (e) { /* 隐私模式忽略 */ }
    }
    migrateKey();
    function isOn() {
      try { return localStorage.getItem(ON_KEY) !== '0'; } catch (e) { return true; }
    }
    function setEnabled(on) {
      try { localStorage.setItem(ON_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
      updateToggleBtn();
      if (on) {
        enhanceRows();
        bootPanel(false);
      } else {
        // 立即清除全部标记与面板（不发任何请求）
        document.querySelectorAll('.' + MARK_CLS).forEach((el) => el.remove());
        document.querySelectorAll('.topic-list-item[data-emotion-done]').forEach((el) => delete el.dataset.emotionDone);
        const p = panelEl();
        if (p) p.remove();
      }
    }
    function updateToggleBtn() {
      const btn = document.querySelector('.trae-ext-emotion-toggle');
      if (!btn) return;
      const on = isOn();
      btn.classList.toggle('is-off', !on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = '情绪分析：' + (on ? '开（点击关闭）' : '关（点击开启）');
      btn.setAttribute('aria-label', btn.title);
    }
    function buildToggleBtn() {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon btn-flat trae-ext-btn trae-ext-emotion-toggle';
      btn.textContent = '😄';
      btn.addEventListener('click', () => setEnabled(!isOn()));
      const li = document.createElement('li');
      li.appendChild(btn);
      return li;
    }

    /* ---- 列表行标记 ---- */
    const MARK_CLS = 'trae-ext-emotion';
    function off() { return !isOn(); }
    function rowContext(row) {
      const catEl = row.querySelector('.badge-category__name, .badge-category');
      const statuses = row.querySelector('.topic-statuses');
      const topic = topicCache.get(row.dataset.topicId);
      return {
        category: catEl ? catEl.textContent.trim() : '',
        solved: (topic && topic.solved) || /已解决|solved|✓/.test(statuses ? statuses.innerHTML : ''),
      };
    }
    function markRow(row) {
      if (row.dataset.emotionDone) return;
      row.dataset.emotionDone = '1';
      const title = row.querySelector('a.title');
      if (!title || !title.parentElement) return;
      const ctx = rowContext(row);
      const r = score({ title: title.textContent, category: ctx.category, solved: ctx.solved });
      if (r.label === '中') return;
      const s = document.createElement('span');
      s.className = MARK_CLS;
      s.setAttribute('role', 'img');
      s.setAttribute('aria-label', TIP[r.label]);
      s.title = TIP[r.label] + '｜' + r.reason;
      s.textContent = EMOJI[r.label];
      title.parentElement.insertBefore(s, title);
    }
    function enhanceRows() {
      if (off()) return;
      document.querySelectorAll('.topic-list-item[data-topic-id]').forEach(markRow);
    }

    /* ---- 今日情绪面板 ---- */
    // 面板自己的列表页判定：不复用 LIST_URL_PATTERN（它有 '/top'⊂'/topic' 误匹配，且漏 '/' 与 '/categories'）
    function isListPage() {
      const p = location.pathname;
      return p === '/' || /^\/(latest|new|unread|categories|c\/|tag\/|tags\/)/.test(p) || /^\/top($|[/?])/.test(p);
    }
    const PANEL_KEY = 'tfeEmotionDailyV2'; // V2：全量翻页口径，避免读到 V1（仅 30 帖）的旧缓存
    const PANEL_TTL = 30 * 60 * 1000;
    const COLLAPSE_KEY = 'tfe-emotion-panel-collapsed';
    const LABELS = ['喜', '哀', '怒', '反讽', '求助'];

    function todayStart() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
    function loadCached() {
      try {
        const c = JSON.parse(sessionStorage.getItem(PANEL_KEY) || 'null');
        if (c && Date.now() - c.ts < PANEL_TTL && c.day === new Date().toDateString()) return c;
      } catch (e) { /* ignore */ }
      return null;
    }
    function saveCached(data) {
      try { sessionStorage.setItem(PANEL_KEY, JSON.stringify(Object.assign({ ts: Date.now(), day: new Date().toDateString() }, data))); } catch (e) { /* ignore */ }
    }
    const MAX_PAGES = 5;   // 硬上限：5 页 / 150 帖
    const PAGE_GAP = 350;  // 串行翻页间隔，避免触发限流
    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
    function fetchDaily() {
      const start = todayStart();
      return fetch('/categories.json').then((r) => r.json()).catch(() => null).then((cats) => {
        const catMap = {};
        if (cats && cats.category_list) cats.category_list.categories.forEach((c) => { catMap[c.id] = c.name; });
        const counts = { 中: 0 };
        LABELS.forEach((l) => { counts[l] = 0; });
        const groups = {};
        LABELS.forEach((l) => { groups[l] = []; });
        let total = 0, pages = 0, truncated = false;
        const seenIds = new Set(); // 翻页期间新帖插入会导致行错位，按 id 去重防重复计数
        return (function next(p) {
          return fetch('/latest.json?order=created&no_definitions=true&page=' + p)
            .then((r) => r.json())
            .then((d) => {
              const ts = (d.topic_list && d.topic_list.topics) || [];
              pages++;
              let older = false;
              ts.forEach((t) => {
                if (seenIds.has(t.id)) return;
                seenIds.add(t.id);
                if (Date.parse(t.created_at) >= start) {
                  total++;
                  const r2 = score({ title: t.title, category: catMap[t.category_id] || '', solved: !!t.has_accepted_answer });
                  counts[r2.label]++;
                  if (r2.label !== '中' && groups[r2.label].length < 5) groups[r2.label].push({ id: t.id, title: t.title });
                } else older = true;
              });
              // 出现早于今日 0 点的帖 → 当天已覆盖完整；否则串行翻下一页
              if (!older && ts.length === 30 && pages < MAX_PAGES) return sleep(PAGE_GAP).then(() => next(p + 1));
              truncated = !older && ts.length === 30; // 到上限仍有当天帖 → 截断
              const data = { counts, total, pages, truncated, groups };
              saveCached(data);
              return data;
            });
        })(0);
      });
    }

    function panelEl() { return document.getElementById('trae-ext-emotion-panel'); }
    function renderBar(text, loading) {
      let p = panelEl();
      if (!p) {
        p = document.createElement('div');
        p.id = 'trae-ext-emotion-panel';
        document.body.appendChild(p);
      }
      p.className = 'is-collapsed';
      p.innerHTML = '<button type="button" class="eep-bar" aria-label="今日情绪面板">' + text + '</button>';
      if (!loading) p.querySelector('.eep-bar').addEventListener('click', () => setCollapsed(false));
    }
    function renderPanel(data) {
      let p = panelEl();
      if (!p) {
        p = document.createElement('div');
        p.id = 'trae-ext-emotion-panel';
        document.body.appendChild(p);
      }
      p.className = 'is-open';
      const pct = (n) => (data.total ? Math.round((n / data.total) * 100) : 0);
      let html = '<div class="eep-head"><span class="eep-title">📊 今日情绪（' + data.total + ' 帖 · 标题级粗判）</span>'
        + '<button type="button" class="eep-refresh" title="重新统计">↻</button>'
        + '<button type="button" class="eep-fold" title="收起">▾</button></div><div class="eep-body">'
        + '<div class="eep-scope">' + (data.truncated
          ? '⚠ 仅统计最新 ' + data.total + ' 条（翻 ' + data.pages + ' 页），今日发帖更多，未全覆盖'
          : '✓ 统计今日 00:00 至今全部 ' + data.total + ' 帖（翻 ' + data.pages + ' 页，按 topic id 去重，含当天创建的置顶帖），未遗漏') + '</div>';
      if (!data.total) {
        html += '<div class="eep-empty">今天还没有新帖，晚点再来看看。</div>';
      } else {
        html += '<div class="eep-counts">';
        LABELS.forEach((l) => {
          html += '<span class="eep-item' + (data.counts[l] ? '' : ' is-zero') + '" title="' + (TIP[l] || l) + '">' + EMOJI[l] + ' ' + data.counts[l] + '（' + pct(data.counts[l]) + '%）</span>';
        });
        html += '<span class="eep-item is-zero" title="拿不准的一律不标">· 中性 ' + data.counts['中'] + '（' + pct(data.counts['中']) + '%）</span></div>';
        LABELS.forEach((l) => {
          if (!data.groups[l].length) return;
          html += '<div class="eep-group"><div class="eep-gt">' + EMOJI[l] + ' ' + l + '</div><ul>';
          data.groups[l].forEach((g) => {
            html += '<li><a href="/t/topic/' + g.id + '">' + g.title.replace(/</g, '&lt;').slice(0, 40) + '</a></li>';
          });
          html += '</ul></div>';
        });
      }
      html += '</div>';
      p.innerHTML = html;
      p.querySelector('.eep-fold').addEventListener('click', () => setCollapsed(true));
      p.querySelector('.eep-refresh').addEventListener('click', () => {
        try { sessionStorage.removeItem(PANEL_KEY); } catch (e) { /* ignore */ }
        bootPanel(true);
      });
    }
    function barText(data) {
      return '📊 今日情绪 ' + (data && data.total ? data.total + ' 帖' + (data.truncated ? '（截断）' : '') + ' · 点击查看' : '· 点击查看');
    }
    function setCollapsed(c) {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '1' : '0'); } catch (e) { /* ignore */ }
      const data = loadCached();
      if (c) renderBar(barText(data), false);
      else if (data) renderPanel(data);
      else bootPanel(false);
    }
    function bootPanel(force) {
      if (off()) return; // 关闭时连面板的翻页请求也不发
      if (!isListPage()) return;
      const cached = force ? null : loadCached();
      const collapsed = (() => { try { return localStorage.getItem(COLLAPSE_KEY) !== '0'; } catch (e) { return true; } })();
      if (cached) { collapsed ? renderBar(barText(cached), false) : renderPanel(cached); return; }
      renderBar('📊 今日情绪统计中…', true);
      fetchDaily()
        .then((data) => { collapsed ? renderBar(barText(data), false) : renderPanel(data); })
        .catch(() => {
          const p = panelEl();
          if (p) {
            p.className = 'is-collapsed';
            p.innerHTML = '<button type="button" class="eep-bar">📊 今日情绪加载失败 · 点击重试</button>';
            p.querySelector('.eep-bar').addEventListener('click', () => bootPanel(true));
          }
        });
    }

    // 自愈：路由/DOM 变化后由 enhanceVisibleRows 调用（复用同一 MutationObserver，零新增监听）
    // 列表页且开关开 → 确保面板存在（幂等，有缓存不发请求）；离开列表页或关闭 → 移除
    function ensurePanel() {
      const p = panelEl();
      if (!isListPage() || off()) { if (p) p.remove(); return; }
      if (!p) bootPanel(false);
    }

    return { enhanceRows, score, bootPanel, buildToggleBtn, updateToggleBtn, isOn, ensurePanel };
  })();

  /* ---------------- 启动 ---------------- */

  function init() {
    if (document.body && document.body.classList.contains('crawler')) return;
    parsePreloaded();
    injectHeaderButtons();
    setInterval(() => {
      injectHeaderButtons();
      injectBackToTop();
    }, 1500);
    initHeatSort();
    enhanceVisibleRows();
    watchRows();
    fallbackFetchListJson();
    Emotion.bootPanel(false);
  }

  hookFetch();
  hookXhr();
  injectStyles();
  try {
    if (localStorage.getItem(DARK_KEY) === '1') {
      document.documentElement.classList.add('trae-dark');
    }
  } catch (err) {
    /* 忽略 */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
