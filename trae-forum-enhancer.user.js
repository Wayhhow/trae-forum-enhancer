// ==UserScript==
// @name         TRAE 论坛增强助手
// @namespace    https://github.com/Wayhhow
// @version      0.3.0
// @description  一键暗黑模式 + 列表页数据增强 + 帖子温度计 + 随机漫游 | © 2026 Wayhhow · MIT License
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
`;

  /* ---------------- 启动 ---------------- */

  function init() {
    if (document.body && document.body.classList.contains('crawler')) return;
    parsePreloaded();
    injectHeaderButtons();
    setInterval(injectHeaderButtons, 1500);
    initHeatSort();
    enhanceVisibleRows();
    watchRows();
    fallbackFetchListJson();
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
