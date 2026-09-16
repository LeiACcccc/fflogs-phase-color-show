// ==UserScript==
// @name         FFLogs 添加精确百分位显示
// @namespace    http://tampermonkey.net/
// @version      0.19
// @description  在FFLogs带phase参数的页面添加对应阶段的真实百分位列
// @author       The.D
// @match        https://cn.fflogs.com/reports/*
// @match        https://www.fflogs.com/reports/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      fflogs.com
// @connect      cn.fflogs.com
// @connect      www.fflogs.com
// @connect      raw.githubusercontent.com
// @connect      cdn.jsdelivr.net
// @license      MIT
// @homepage     https://github.com/The-D66/fflogs-phase-color-show
// @supportURL   https://github.com/The-D66/fflogs-phase-color-show/issues
// @updateURL    https://greasyfork.org/scripts/fflogs-phase-color-show/versions/latest
// @downloadURL  https://greasyfork.org/scripts/fflogs-phase-color-show/download
// ==/UserScript==

(function () {
  'use strict';

  // 添加样式
  GM_addStyle(`
        .percentile-column {
            text-align: center;
        }
        .legendary {
            color: #ff8000 !important;
        }
        .mythic {
            color: #e268a8 !important;
        }
        .epic {
            color: #a335ee !important;
        }
        .rare {
            color: #0070ff !important;
        }
        .uncommon {
            color: #00ff96 !important;
        }
        .common {
            color: #9d9d9d !important;
        }
            
    `);

  // 职业类名对照表（CSS类名 -> 中英文名称）
  const JOB_SPECS = {
    // CSS类名 -> [中文名称, 英文名称]
    'Warrior': ['战士', 'Warrior'],
    'Paladin': ['骑士', 'Paladin'],
    'DarkKnight': ['暗黑骑士', 'Dark Knight'],
    'Gunbreaker': ['绝枪战士', 'Gunbreaker'],
    'WhiteMage': ['白魔法师', 'White Mage'],
    'Scholar': ['学者', 'Scholar'],
    'Astrologian': ['占星术士', 'Astrologian'],
    'Sage': ['贤者', 'Sage'],
    'Monk': ['武僧', 'Monk'],
    'Dragoon': ['龙骑士', 'Dragoon'],
    'Ninja': ['忍者', 'Ninja'],
    'Samurai': ['武士', 'Samurai'],
    'Reaper': ['钐镰客', 'Reaper'],
    'Bard': ['吟游诗人', 'Bard'],
    'Machinist': ['机工士', 'Machinist'],
    'Dancer': ['舞者', 'Dancer'],
    'BlackMage': ['黑魔法师', 'Black Mage'],
    'Summoner': ['召唤师', 'Summoner'],
    'RedMage': ['赤魔法师', 'Red Mage'],
    'Pictomancer': ['绘灵法师', 'Pictomancer'],
    'Viper': ['蝰蛇剑士', 'Viper'],
    'LimitBreak': ['极限技', 'Limit Break']
  };

  // 标准化文本（转小写并移除空格）
  function normalizeText(text) {
    return text.toLowerCase().replace(/\s+/g, '');
  }

  // 调试开关：置为 true 时输出每行的职业与 rDPS 日志
  const DEBUG = false;

  // 百分位数据缓存
  const percentileCache = {};
  // CSV文件缓存
  const csvCache = {};
  // 缓存过期时间（毫秒）- 默认24小时
  const CACHE_EXPIRY = 24 * 60 * 60 * 1000;

  // 初始化缓存
  // 注意：缓存键带版本号(v14)，避免新旧版本脚本共用同一份过期数据
  const CACHE_KEY = 'fflogs_csv_cache_v14';
  function initCache() {
    try {
      // 清理旧版本缓存键，避免不同版本脚本互相读取过期数据
      if (localStorage.getItem('fflogs_csv_cache')) {
        localStorage.removeItem('fflogs_csv_cache');
        console.log('已清理旧版缓存 fflogs_csv_cache');
      }
      // 加载版本元数据缓存（版本列表 + 各版本 config）
      loadMetaCache();
      // 从localStorage加载CSV缓存
      const savedCsvCache = localStorage.getItem(CACHE_KEY);
      if (savedCsvCache) {
        const parsedCache = JSON.parse(savedCsvCache);
        // 检查缓存是否过期
        if (parsedCache.timestamp && (Date.now() - parsedCache.timestamp < CACHE_EXPIRY)) {
          Object.assign(csvCache, parsedCache.data);
          console.log('已从localStorage加载CSV缓存');
        } else {
          console.log('CSV缓存已过期，将重新获取');
        }
      }
    } catch (error) {
      console.error('加载CSV缓存失败:', error);
    }
  }

  // 保存缓存到localStorage
  function saveCache() {
    try {
      const cacheData = {
        timestamp: Date.now(),
        data: csvCache
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
      console.log('CSV缓存已保存到localStorage');
    } catch (error) {
      console.error('保存CSV缓存失败:', error);
    }
  }

  // 检查是否在带具体分P参数的页面上（phase=数字）
  // 注意：FFLogs 的 "ALL Phases" 对应 phase=all，不视为分P页面，
  // 故这里要求 phase= 后面跟数字，才不会在 ALL Phases 下显示分P百分位。
  function isPhaseReport() {
    return /phase=\d+/.test(window.location.href) && window.location.href.includes('type=damage-done');
  }

  // 检查是否是伤害统计页面
  function isDamageDonePage() {
    return window.location.href.includes('type=damage-done');
  }

  // 解析URL获取关键信息
  function parseUrl() {
    const url = window.location.href;
    const reportMatch = url.match(/reports\/([^?]+)/);
    const fightMatch = url.match(/fight=(\d+)/);
    const phaseMatch = url.match(/phase=(\d+)/);

    return {
      reportId: reportMatch ? reportMatch[1] : null,
      fightId: fightMatch ? fightMatch[1] : null,
      phaseId: phaseMatch ? phaseMatch[1] : null
    };
  }

  // ============ 动态数据源选择 ============
  // 数据源（ITX351/fflogs_phase_ranker）按 版本目录（v71/v72/.../v750j/v751j2/v751z2）组织，
  // 每个目录的 config.json 把「副本名(raidMatchNames) + 分P(raidLogsPhase)」映射到具体 CSV 文件。
  // 旧版写死 v71(7.1 伊甸) 导致看其他版本副本时拿到的数据明显不对；现改为按页面副本名+分P+区服动态匹配。
  const DATA_REPO_BASE = 'https://raw.githubusercontent.com/ITX351/fflogs_phase_ranker/refs/heads/main/public/data/';

  // 数据区服偏好：'z' = 国服(cn.fflogs.com)，'j' = 国际服(www.fflogs.com)。
  // 注意：数据源仓库(ITX351/fflogs_phase_ranker)的目录后缀含义为 j=国际服、z=国服
  //       （见各版本 config.json 的 datasetName，如 "7.51国际服妖星" 在 v751j2、"7.51国服妖星" 在 v751z2）。
  // 默认使用国服数据；如需国际服百分位，改为 'j' 即可。
  const PREFERRED_REGION = 'z';

  // 中文副本名 -> 数据源里的英文 raidMatchNames
  // 原因：cn.fflogs.com 页面常显示中文副本名，而 config.json 的 raidMatchNames 是英文名，需桥接。
  // 若页面显示其他中文名却匹配不到，请在此补充 '中文名': '英文raidMatchNames'。
  const ENCOUNTER_ALIASES = {
    '妖星乱舞': 'Dancing Mad'
  };

  // 版本目录解析：v71 / v750j / v751j2 / v751z2 ... （j=国服, z=国际服）
  function parseVersionDir(dir) {
    const m = dir.match(/^v(\d+)([jz])?(\d*)$/);
    if (!m) return null;
    return { num: parseInt(m[1], 10), region: m[2] || null, sub: m[3] ? parseInt(m[3], 10) : 0 };
  }

  // 缓存：版本列表、各版本 config、数据集索引（SPA 内导航时复用，避免重复请求）
  let versionListCache = null;
  const configCache = {};
  let datasetIndex = null;

  // 元数据缓存（版本列表 + 各版本 config）整份存 localStorage，24h 有效：
  // 避免每次打开页面都要并行拉十几个 config.json
  const META_CACHE_KEY = 'fflogs_meta_cache_v18';
  function loadMetaCache() {
    try {
      const raw = localStorage.getItem(META_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed.timestamp || Date.now() - parsed.timestamp >= CACHE_EXPIRY) return;
      if (parsed.versionList) versionListCache = parsed.versionList;
      if (parsed.configs) Object.assign(configCache, parsed.configs);
      console.log('[phase-color] 已从localStorage加载版本元数据缓存');
    } catch (e) { /* 缓存损坏时忽略，走正常网络获取 */ }
  }
  function saveMetaCache() {
    try {
      localStorage.setItem(META_CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        versionList: versionListCache,
        configs: configCache
      }));
    } catch (e) { /* 存储异常忽略 */ }
  }

  // GM_xmlhttpRequest 封装（返回文本，带超时，超时后明确失败而不是一直挂起）
  function gmGetText(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: timeoutMs || 12000,
        onload: function (r) {
          if (settled) return; settled = true;
          if (r.status === 200) resolve(r.responseText);
          else reject(new Error('HTTP ' + r.status + ' @ ' + url));
        },
        onerror: function (e) { if (settled) return; settled = true; reject(e && e.error ? new Error(e.error) : new Error('网络错误 @ ' + url)); },
        ontimeout: function () { if (settled) return; settled = true; reject(new Error('请求超时 @ ' + url)); }
      });
    });
  }

  // 主源(raw.githubusercontent.com，国内常慢/被墙)失败或超时时，自动切到 jsDelivr 镜像
  function toMirrorUrl(url) {
    const raw = 'https://raw.githubusercontent.com/ITX351/fflogs_phase_ranker/refs/heads/main/';
    if (url.indexOf(raw) === 0) {
      return 'https://cdn.jsdelivr.net/gh/ITX351/fflogs_phase_ranker@main/' + url.slice(raw.length);
    }
    return null;
  }

  // 国内直连 raw.githubusercontent.com 经常很慢/被拦截，默认优先走 jsDelivr 镜像，失败再回主源
  const PREFER_MIRROR = true;

  async function gmGetTextWithFallback(url) {
    const mirror = toMirrorUrl(url);
    const order = (PREFER_MIRROR && mirror) ? [mirror, url] : [url, mirror].filter(Boolean);
    let lastErr = null;
    for (const target of order) {
      try {
        return await gmGetText(target, 10000);
      } catch (e) {
        lastErr = e;
        console.warn('[phase-color] 取数据失败(' + (e && e.message ? e.message : e) + ')，尝试下一个源...');
      }
    }
    throw lastErr || new Error('全部数据源均不可用');
  }

  // 读取 config_file_list.json，得到所有版本目录
  async function fetchVersionList() {
    if (versionListCache) return versionListCache;
    const text = await gmGetText(DATA_REPO_BASE + 'config_file_list.json');
    versionListCache = JSON.parse(text);
    return versionListCache;
  }

  // 读取某版本目录的 config.json（缓存；缺失则标记为 null）
  async function fetchVersionConfig(dir) {
    if (Object.prototype.hasOwnProperty.call(configCache, dir)) return configCache[dir];
    try {
      const text = await gmGetText(DATA_REPO_BASE + dir + '/config.json');
      const cfg = JSON.parse(text);
      configCache[dir] = cfg;
      return cfg;
    } catch (e) {
      configCache[dir] = null;
      return null;
    }
  }

  // 构建 副本名 -> 候选数据集 的索引（候选按版本新旧排序，新版优先）
  async function buildDatasetIndex() {
    if (datasetIndex) return datasetIndex;
    const list = await fetchVersionList();
    const cfgPairs = await Promise.all(list.map(async (item) => ({
      item: item, cfg: await fetchVersionConfig(item.version)
    })));
    saveMetaCache();
    const byName = {};
    for (const pair of cfgPairs) {
      const item = pair.item, cfg = pair.cfg;
      if (!cfg) continue;
      const pv = parseVersionDir(item.version);
      for (const entry of cfg) {
        const region = pv ? pv.region : null;
        for (const name of (entry.raidMatchNames || [])) {
          const n = normalizeText(name);
          if (!byName[n]) byName[n] = [];
          byName[n].push({ dir: item.version, phase: String(entry.raidLogsPhase), file: entry.dataFileName, region });
        }
      }
    }
    for (const n in byName) {
      byName[n].sort((a, b) => {
        const pa = parseVersionDir(a.dir), pb = parseVersionDir(b.dir);
        return (pb.num - pa.num) || (pb.sub - pa.sub);
      });
    }
    datasetIndex = { byName, names: Object.keys(byName) };
    return datasetIndex;
  }

  // 从页面提取当前副本名。
  // 优先用 document.title（FFLogs 页面标题形如 "杀条_战斗_4 - 报告: Dancing Mad - FF Logs"，必含当前副本名）。
  // 整页 HTML 扫描只作最后兜底：页面上可能出现其它副本的引用（如他人战绩列表），
  // 此前曾把 Futures Rewritten 误判为当前副本，导致拉错数据源（取成 v750z 的伊甸数据）。
  async function extractEncounterName() {
    const idx = await buildDatasetIndex();
    for (let attempt = 0; attempt < 3; attempt++) {
      // 1) 页面标题（最可靠）
      const titleNorm = normalizeText(document.title || '');
      if (titleNorm) {
        for (const name of idx.names) {
          if (titleNorm.includes(name)) return name;
        }
        for (const cn in ENCOUNTER_ALIASES) {
          if (titleNorm.includes(normalizeText(cn))) {
            const en = normalizeText(ENCOUNTER_ALIASES[cn]);
            if (idx.byName[en]) return en;
          }
        }
      }
      // 2) 兜底：只在报告表格容器内扫描（范围远小于整页，误判概率低）
      const scope = document.getElementById('main-table-container') || document.body;
      const scopeNorm = normalizeText(scope.innerHTML || '');
      for (const name of idx.names) {
        if (scopeNorm.includes(name)) return name;
      }
      for (const cn in ENCOUNTER_ALIASES) {
        if (scopeNorm.includes(normalizeText(cn))) {
          const en = normalizeText(ENCOUNTER_ALIASES[cn]);
          if (idx.byName[en]) return en;
        }
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 1200));
    }
    return null;
  }

  // 根据副本名+分P+区服，解析出正确的 CSV URL
  async function resolveCsvUrl(encounterNorm, phase, region) {
    const idx = await buildDatasetIndex();
    const cands = idx.byName[encounterNorm];
    if (!cands) return null;
    // 按区域过滤：优先该区服专属目录(j/z)，否则用无后缀(旧版统一)目录
    const filtered = cands.filter(c => c.region === null || c.region === region);
    if (filtered.length === 0 && region === 'z') {
      console.warn('[phase-color] 国服(z)数据中未找到「' + encounterNorm + '」P' + phase +
        '，将回退使用国际服数据。候选版本: ' + cands.map(c => c.dir).join(','));
    }
    const pool = filtered.length ? filtered : cands;
    for (const c of pool) {
      if (String(c.phase) !== String(phase)) continue;
      let file = c.file;
      // 国服(z)优先带 _chn 的文件（v71 等旧目录同时存在 _chn 与英文两份，_chn=国服）
      if (region === 'z' && !file.endsWith('_chn.csv')) {
        const chn = cands.find(x => x.dir === c.dir && String(x.phase) === String(c.phase) && x.file.endsWith('_chn.csv'));
        if (chn) file = chn.file;
      }
      return { url: DATA_REPO_BASE + c.dir + '/' + file, version: c.dir };
    }
    return null;
  }

  // ===== 整页只解析一次数据源（性能关键）=====
  // 之前每插一行都要重新扫描整页 HTML 找副本名并重新解析数据源，
  // 8 个玩家就要扫 8 遍整页 → 表现为"逐行加载、非常慢"。这里改为按分P缓存解析结果。
  // 用 Promise 缓存解析过程：8 行同时进来时共用同一份解析，不会重复扫描页面/重复联网
  const phaseCsvPromises = {};      // phaseId -> Promise<{url,version}|null>
  const phaseCsvLoadPromises = {};  // phaseId -> Promise<url|null>
  let encounterNamePromise = null;  // 副本名只扫描一次

  // SPA 内切换副本/分P（不刷新页面）时，按「报告+战斗+分P」上下文失效缓存，
  // 否则会拿旧副本的数据算新副本的 dps 颜色（原作者评审指出的缓存污染问题）。
  // 仅 csvCache(localStorage，键含完整 CSV URL) 与 元数据缓存是跨副本通用的，无需失效。
  let activeContext = null;
  function computeContext() {
    const u = parseUrl();
    return (u.reportId || '?') + '|' + (u.fightId || '?') + '|' + (u.phaseId || '?');
  }
  function invalidateCachesIfContextChanged() {
    const ctx = computeContext();
    if (ctx === activeContext) return;
    console.log('[phase-color] 上下文切换 ' + (activeContext || '(初始)') + ' -> ' + ctx + '，失效旧副本缓存');
    activeContext = ctx;
    encounterNamePromise = null;
    Object.keys(phaseCsvPromises).forEach(k => delete phaseCsvPromises[k]);
    Object.keys(phaseCsvLoadPromises).forEach(k => delete phaseCsvLoadPromises[k]);
    Object.keys(percentileCache).forEach(k => delete percentileCache[k]);
    // 同时剥掉旧副本残留的彩色单元格（保留表头），避免 SPA 复用行节点导致旧数字滞留
    document.querySelectorAll('.percentile-cell-v14').forEach(el => el.remove());
  }

  function getEncounterNameOnce() {
    if (!encounterNamePromise) {
      encounterNamePromise = extractEncounterName().then(function (name) {
        console.log('[phase-color] 匹配到的副本名: ' + name);
        return name;
      });
    }
    return encounterNamePromise;
  }

  // 解析并缓存「该分P对应的 CSV 数据源」
  function resolvePhaseCsv(phaseId) {
    const key = String(phaseId || '1');
    if (!phaseCsvPromises[key]) {
      phaseCsvPromises[key] = (async function () {
        let result = null;
        try {
          const enc = await getEncounterNameOnce();
          if (enc) {
            result = await resolveCsvUrl(normalizeText(enc), key, PREFERRED_REGION);
            if (result) {
              console.log('[phase-color] region=' + PREFERRED_REGION + ' phase=' + key +
                ' -> 数据源: ' + result.url + ' (目录: ' + result.version + ')');
            }
          }
        } catch (e) {
          console.error('[phase-color] 解析数据源失败:', e && e.message ? e.message : e);
        }
        if (!result) {
          console.warn('[phase-color] 无法确定 CSV 数据源（副本名未匹配或该分P无数据），将显示 -');
        }
        return result;
      })();
    }
    return phaseCsvPromises[key];
  }

  // 预取该分P的 CSV：整页只下一次网络请求，所有职业共用这一份
  function preloadPhaseCsv(phaseId) {
    const key = String(phaseId || '1');
    if (!phaseCsvLoadPromises[key]) {
      phaseCsvLoadPromises[key] = (async function () {
        const r = await resolvePhaseCsv(phaseId);
        if (!r) return null;
        if (csvCache[r.url]) return r.url;
        console.log('[phase-color] 请求CSV数据: ' + r.url);
        const csvText = await gmGetTextWithFallback(r.url);
        csvCache[r.url] = csvText;
        saveCache();
        return r.url;
      })();
    }
    return phaseCsvLoadPromises[key];
  }

  // 获取职业百分位数据（数据已预取，这里只解析，不再发起网络请求）
  async function fetchJobPercentileStats(jobClass, phaseId) {
    const cacheKey = jobClass + '_' + (phaseId || '1');
    if (percentileCache[cacheKey]) return percentileCache[cacheKey];

    const r = await resolvePhaseCsv(phaseId);
    if (!r) return null;

    if (!csvCache[r.url]) {
      // 未被预取时兜底拉一次（带超时与镜像）
      try {
        csvCache[r.url] = await gmGetTextWithFallback(r.url);
        saveCache();
      } catch (error) {
        console.error('[phase-color] 获取CSV数据失败:', error && error.message ? error.message : error);
        return null;
      }
    }

    const dpsValues = parseCSVData(csvCache[r.url], jobClass);
    percentileCache[cacheKey] = dpsValues;
    return dpsValues;
  }

  // 解析CSV数据
  function parseCSVData(csvText, jobClass) {
    try {
      // 将CSV文本分割成行
      const lines = csvText.split('\n');
      if (lines.length < 2) {
        console.warn('CSV数据格式不正确');
        return null;
      }

      // 解析表头获取百分位点
      const headerLine = lines[0];
      const headers = headerLine.split(',');
      const percentilePoints = headers.slice(1).map(h => parseInt(h, 10));

      // 查找职业行
      let jobRow = null;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const columns = line.split(',');
        if (columns.length > 0) {
          const rowJobClass = columns[0].trim();

          // 标准化比较：忽略大小写与空格，兼容 "BlackMage" 与 "Black Mage" 等写法
          if (normalizeText(rowJobClass) === normalizeText(jobClass)) {
            jobRow = columns;
            break;
          }

          // 检查中英文名称
          const jobInfo = JOB_SPECS[jobClass];
          if (jobInfo) {
            const [cnName, enName] = jobInfo;
            if (normalizeText(rowJobClass) === normalizeText(cnName) ||
                normalizeText(rowJobClass) === normalizeText(enName)) {
              jobRow = columns;
              break;
            }
          }
        }
      }

      if (!jobRow) {
        console.warn(`在CSV中未找到职业 ${jobClass}`);
        return null;
      }

      // 提取各百分位的DPS值
      const results = {};
      for (let i = 0; i < percentilePoints.length; i++) {
        const percentile = percentilePoints[i];
        const dpsValue = parseFloat(jobRow[i + 1]);
        if (!isNaN(dpsValue)) {
          results[percentile] = dpsValue;
        }
      }

      return results;
    } catch (error) {
      console.error('解析CSV数据出错:', error);
      return null;
    }
  }

  // 根据DPS计算百分位
  function calculatePercentile(rdps, percentileData) {
    if (!percentileData || Object.keys(percentileData).length === 0) {
      return '-';
    }

    // 获取所有百分位点并排序
    const percentiles = Object.keys(percentileData)
      .map(Number)
      .sort((a, b) => b - a);

    // 如果达到/超过最高百分位点（P100）
    if (rdps >= percentileData[percentiles[0]]) {
      return 100; // 达到或超过最高百分位，显示 100
    }

    // 如果低于最低百分位
    if (rdps < percentileData[percentiles[percentiles.length - 1]]) {
      return Math.floor(percentiles[percentiles.length - 1] / 2); // 默认为最低已知百分位的一半
    }

    // 查找合适的区间并插值
    for (let i = 0; i < percentiles.length - 1; i++) {
      const higher = percentiles[i];
      const lower = percentiles[i + 1];

      if (rdps >= percentileData[lower] && rdps < percentileData[higher]) {
        // 线性插值计算更精确的百分位
        const ratio = (rdps - percentileData[lower]) /
          (percentileData[higher] - percentileData[lower]);
        return Math.round(lower + ratio * (higher - lower));
      }
    }

    return 50; // 默认值
  }

  // 从表格行获取RDPS值
  function getRDPS(row) {
    const rdpsCell = row.querySelector('.rdps');
    if (!rdpsCell) return null;

    // 提取数字并移除非数字字符
    const rdpsText = rdpsCell.textContent.trim();
    const rdps = parseFloat(rdpsText.replace(/,/g, ''));
    return isNaN(rdps) ? null : rdps;
  }

  // 确保表头存在百分位列标题（仅插入一次）
  function ensurePercentileHeader() {
    if (document.querySelector('.percentile-header-v14')) return;

    const headerRow = document.querySelector('table thead tr');
    if (!headerRow) return;

    const th = document.createElement('th');
    // 继承网页表头本身的样式：复制第一个已有 th 的类名，再叠加我们的标记类，
    // 这样 CN_logs/EN_logs 表头能自动匹配 FFLogs 原生的 UI 风格。
    const firstTh = headerRow.querySelector('th');
    if (firstTh) {
      th.className = firstTh.className + ' percentile-column percentile-header percentile-header-v14';
      if (!th.getAttribute('scope')) th.setAttribute('scope', 'col');
    } else {
      th.className = 'percentile-column percentile-header percentile-header-v14';
    }
    // 国服(z)显示 CN_logs，国际服(j)显示 EN_logs
    th.textContent = PREFERRED_REGION === 'z' ? 'CN_logs' : 'EN_logs';

    if (firstTh) {
      headerRow.insertBefore(th, firstTh);
    } else {
      headerRow.appendChild(th);
    }
  }

  // 防止 5 秒轮询与 DOM 变更监听同时触发多次重建（会表现为反复"逐行加载"）
  let columnBuildRunning = false;
  async function addPercentileColumn() {
    if (columnBuildRunning) return;
    columnBuildRunning = true;
    try {
      await addPercentileColumnInternal();
    } catch (e) {
      console.error('[phase-color] 构建百分位列出错:', e && e.message ? e.message : e);
    } finally {
      columnBuildRunning = false;
    }
  }

  async function addPercentileColumnInternal() {
    // 切换副本/分P（不刷新页面）时失效旧副本缓存，避免缓存污染串数据
    invalidateCachesIfContextChanged();

    // 等待表格加载完成
    await waitForElement('tr[id^="main-table-row-"]');

    const reportInfo = parseUrl();

    // 查找所有行
    const rows = document.querySelectorAll('tr[id^="main-table-row-"]');

    // 先补表头，避免所有表头后退错位
    ensurePercentileHeader();

    // 整页只预取一次该分P的 CSV，之后所有行共用，避免逐行联网（这是"很慢/逐行加载"的主因）
    try {
      await preloadPhaseCsv(reportInfo.phaseId);
    } catch (e) {
      console.error('[phase-color] 预取CSV失败:', e && e.message ? e.message : e);
    }

    // 看门狗：30 秒后仍停留在"加载中..."的单元格一律结算为 '-'，绝不允许永久卡住
    setTimeout(function () {
      document.querySelectorAll('.percentile-column span').forEach(function (span) {
        if (span.textContent === '加载中...') {
          span.textContent = '-';
          console.warn('[phase-color] 超时仍未取到数据，已标记为 -');
        }
      });
    }, 30000);

    // 存储所有获取百分位的promise
    const promises = [];

    // 首先创建所有单元格，避免重排
    for (const row of rows) {
      // 跳过已处理的行
      if (row.querySelector('.percentile-column')) {
        continue;
      }

      // 创建百分位单元格（初始为空）
      const cell = document.createElement('td');
      cell.className = 'main-table-performance rank percentile-column percentile-cell-v14';
      cell.innerHTML = '<span>加载中...</span>';

      // 插入单元格
      const firstCell = row.querySelector('td');
      if (firstCell) {
        row.insertBefore(cell, firstCell);
      }

      // 获取职业名称
      const jobClassElement = row.querySelector('.main-table-link a');
      if (!jobClassElement) {
        // 找不到职业链接时直接结算为 '-'，避免单元格永远停在"加载中..."
        updatePercentileCell(cell, '-');
        continue;
      }

      // 提取职业名称
      const jobClass = jobClassElement.className.trim();

      // 获取rdps值
      const rdps = getRDPS(row);
      // 诊断日志必须放在 rdps 声明之后（v0.14 曾误放在前面导致 TDZ 报错、整列构建中断）
      if (DEBUG) console.log('[phase-color] 行职业: ' + jobClass + ' | rdps=' + rdps);
      if (rdps === null) {
        // 无RDPS数据，显示-
        updatePercentileCell(cell, '-');
        continue;
      }

      // 极限技特殊处理
      if (jobClass === 'LimitBreak') {
        updatePercentileCell(cell, '-');
        continue;
      }

      // 创建一个Promise来处理百分位计算
      const promise = (async () => {
        try {
          // 获取该职业在这个阶段的百分位统计数据
          const percentileData = await fetchJobPercentileStats(
            jobClass,
            reportInfo.phaseId
          );

          // 计算百分位
          const percentile = calculatePercentile(rdps, percentileData);

          // 更新单元格
          updatePercentileCell(cell, percentile);
        } catch (error) {
          console.error(`获取/计算百分位失败:`, error);
          updatePercentileCell(cell, '错误');
        }
      })();

      promises.push(promise);
    }

    // 等待所有百分位计算完成
    try {
      await Promise.all(promises);
    } catch (error) {
      console.error('百分位计算出错:', error);
    }
  }

  // 更新百分位单元格
  function updatePercentileCell(cell, percentile) {
    // 创建链接元素
    const link = document.createElement('a');

    if (percentile === '加载中...' || percentile === '错误') {
      link.textContent = percentile;
    } else {
      link.className = getColorClass(percentile);
      link.textContent = percentile;
    }

    // 清空单元格并添加链接
    cell.innerHTML = '';
    cell.appendChild(link);
  }

  // 根据百分位值获取颜色类
  function getColorClass(percentile) {
    if (percentile === '-') return '';
    const numPercentile = parseInt(percentile, 10);
    if (numPercentile >= 99) return 'legendary';
    if (numPercentile >= 95) return 'mythic';
    if (numPercentile >= 75) return 'epic';
    if (numPercentile >= 50) return 'rare';
    if (numPercentile >= 25) return 'uncommon';
    return 'common';
  }

  // 等待元素加载
  function waitForElement(selector) {
    return new Promise(resolve => {
      if (document.querySelector(selector)) {
        return resolve();
      }

      const observer = new MutationObserver(mutations => {
        if (document.querySelector(selector)) {
          observer.disconnect();
          resolve();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      // 设置超时
      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 10000);
    });
  }

  // 处理表格更新
  function handleTableUpdate() {
    // 是否处于具体分P页面（phase=数字）且为伤害统计
    const isPhasePage = isPhaseReport();
    const isNonDamagePage = !isDamageDonePage();
    const hasPercentileColumn = document.querySelector('.percentile-column') !== null;

    // 移除条件：非分P页面（含 ALL Phases: phase=all）且已存在百分位列，
    //          或非伤害统计页面 -> 移除并退出
    if ((!isPhasePage && hasPercentileColumn) || isNonDamagePage) {
      console.log('检测到非分P页面(含ALL Phases)或非伤害统计页面，移除所有百分位列');
      removePercentileColumns();
      return;
    }

    // 仅在具体分P页面才允许添加/刷新百分位列（ALL Phases 下直接跳过，避免误显示）
    if (!isPhasePage) return;

    // 清理旧版本脚本残留的百分位单元格/表头（防多版本脚本互相污染数据）
    const removedLegacy = removeLegacyPercentileCells();

    // 查找所有行
    const rows = document.querySelectorAll('tr[id^="main-table-row-"]');

    // 检查是否需要添加百分位列（清理过旧版残留后也强制重建一次）
    const hasPercentileColumnNow = document.querySelector('.percentile-column') !== null;
    const needsPercentileColumn = rows.length > 0 && (!hasPercentileColumnNow || removedLegacy);

    // 检查是否有百分位列但内容为空
    const hasEmptyPercentileCells = document.querySelectorAll('.percentile-column span:empty').length > 0;

    // 检查是否有百分位列但显示"加载中..."
    const hasLoadingCells = Array.from(document.querySelectorAll('.percentile-column span')).some(
      span => span.textContent === '加载中...'
    );

    // 如果有行但没有百分位列，或者有空的百分位单元格，或者有加载中的单元格
    if (needsPercentileColumn || hasEmptyPercentileCells || hasLoadingCells) {
      console.log('检测到表格需要更新，重新添加百分位列');
      addPercentileColumn();
    }
  }

  // 移除所有百分位列
  function removePercentileColumns() {
    const percentileColumns = document.querySelectorAll('.percentile-column');
    percentileColumns.forEach(column => {
      column.remove();
    });
  }

  // 清理旧版本脚本残留的百分位单元格/表头（不带 v14 版本标记的）
  // 背景：如果 Tampermonkey 中同时启用了多个版本的脚本，旧版会插入用错误数据源
  // （如国际服数据）计算的单元格，与本版互相覆盖，导致显示错误的百分位。
  function removeLegacyPercentileCells() {
    const legacy = document.querySelectorAll(
      '.percentile-column:not(.percentile-cell-v14):not(.percentile-header-v14)'
    );
    if (legacy.length > 0) {
      console.warn('[phase-color] 检测到 ' + legacy.length +
        ' 个旧版脚本插入的百分位单元格/表头，已清理。' +
        '请打开 Tampermonkey 管理面板，检查是否同时启用了多个版本的 FFLogs 脚本，只保留一个（v0.14）！');
      legacy.forEach(el => el.remove());
      return true;
    }
    return false;
  }

  // 处理phase报告页面
  async function processPhaseReport() {
    console.log('FFLogs百分位显示脚本已加载');

    // 等待页面完全加载
    await new Promise(r => setTimeout(r, 2000));

    // 设置定期检查
    setInterval(() => {
      handleTableUpdate();
    }, 5000); // 每5秒检查一次

    // 监听DOM变化
    const observer = new MutationObserver((mutations) => {
      // 检查是否有表格相关的变化
      const tableChanged = mutations.some(mutation => {
        // 检查目标元素是否是表格容器或其子元素
        const isTableContainer = mutation.target.id === 'main-table-container';
        const isTableChild = mutation.target.closest('#main-table-container');

        // 检查是否有节点添加或删除
        const hasNodeChanges = mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0;

        return (isTableContainer || isTableChild) && hasNodeChanges;
      });

      if (tableChanged) {
        console.log('检测到表格变化，准备更新');
        // 使用setTimeout延迟处理，避免频繁更新
        setTimeout(() => {
          handleTableUpdate();
        }, 500);
      }
    });

    // 观察整个文档
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // 首次尝试添加百分位列
    addPercentileColumn();
  }

  // 初始化
  function init() {
    // 初始化缓存
    initCache();

    // 检查是否在带phase参数的页面上
    if (isPhaseReport()) {
      console.log('检测到phase报告页面，开始处理...');
      processPhaseReport();
    }
  }

  // 启动脚本
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();