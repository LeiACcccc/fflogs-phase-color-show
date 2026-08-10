// ==UserScript==
// @name         FFLogs 添加精确百分位显示
// @namespace    http://tampermonkey.net/
// @version      0.13
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

  // 默认DPS值 - 用于无法获取数据时的备用值
  const DEFAULT_DPS_VALUES = {

  };

  // 反向映射：中文名称 -> CSS类名
  const CN_TO_CLASS = {};
  // 反向映射：英文名称 -> CSS类名
  const EN_TO_CLASS = {};

  // 标准化文本（转小写并移除空格）
  function normalizeText(text) {
    return text.toLowerCase().replace(/\s+/g, '');
  }

  // 构建反向映射
  Object.entries(JOB_SPECS).forEach(([cssClass, [cnName, enName]]) => {
    // 标准名称
    CN_TO_CLASS[cnName] = cssClass;
    EN_TO_CLASS[enName] = cssClass;

    // 标准化的名称（小写且无空格）
    const normalizedCN = normalizeText(cnName);
    const normalizedEN = normalizeText(enName);

    // 添加标准化后的名称映射
    if (normalizedCN !== cnName) {
      CN_TO_CLASS[normalizedCN] = cssClass;
    }
    if (normalizedEN !== enName) {
      EN_TO_CLASS[normalizedEN] = cssClass;
    }

    // 处理空格问题，同时支持带空格和不带空格的英文职业名
    const noSpaceEnName = enName.replace(/\s+/g, '');
    if (noSpaceEnName !== enName) {
      EN_TO_CLASS[noSpaceEnName] = cssClass;
    }
  });

  // 百分位数据缓存
  const percentileCache = {};
  // CSV文件缓存
  const csvCache = {};
  // 缓存过期时间（毫秒）- 默认24小时
  const CACHE_EXPIRY = 24 * 60 * 60 * 1000;

  // 初始化缓存
  function initCache() {
    try {
      // 从localStorage加载CSV缓存
      const savedCsvCache = localStorage.getItem('fflogs_csv_cache');
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
      localStorage.setItem('fflogs_csv_cache', JSON.stringify(cacheData));
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

    // 判断域名
    const domain = url.includes('cn.fflogs.com') ? 'cn' : 'www';

    // 尝试从URL获取boss信息，默认为当前版本raid
    // 实际应用中可能需要根据副本名称动态确定
    const bossId = '1079'; // 默认为Fatebreaker/破命斗士
    const zoneId = '65';   // 默认为当前版本raid

    return {
      reportId: reportMatch ? reportMatch[1] : null,
      fightId: fightMatch ? fightMatch[1] : null,
      phaseId: phaseMatch ? phaseMatch[1] : null,
      bossId: bossId,
      zoneId: zoneId,
      domain: domain
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

  // GM_xmlhttpRequest 封装（返回文本）
  function gmGetText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        onload: function (r) {
          if (r.status === 200) resolve(r.responseText);
          else reject(new Error('HTTP ' + r.status + ' @ ' + url));
        },
        onerror: function (e) { reject(e); }
      });
    });
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
    const byName = {};
    for (const item of list) {
      const cfg = await fetchVersionConfig(item.version);
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

  // 从页面提取当前副本名：扫描页面（含嵌入JSON）中出现的已知副本名；中文名走别名表。带重试。
  async function extractEncounterName() {
    const idx = await buildDatasetIndex();
    for (let attempt = 0; attempt < 3; attempt++) {
      const htmlNorm = normalizeText(document.documentElement.innerHTML);
      for (const name of idx.names) {
        if (htmlNorm.includes(name)) return name;
      }
      for (const cn in ENCOUNTER_ALIASES) {
        if (htmlNorm.includes(normalizeText(cn))) {
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

  // 获取职业百分位数据
  async function fetchJobPercentileStats(jobClass, phaseId) {
    const cacheKey = `${jobClass}_${phaseId}`;
    if (percentileCache[cacheKey]) {
      return percentileCache[cacheKey];
    }

    const phaseNumber = phaseId || '1';
    const region = PREFERRED_REGION;
    console.log('[phase-color] 开始解析: region=' + region + ' phase=' + phaseNumber);

    let csvUrl = null;
    try {
      const encounterName = await extractEncounterName();
      console.log('[phase-color] 匹配到的副本名: ' + encounterName);
      if (encounterName) {
        const resolved = await resolveCsvUrl(normalizeText(encounterName), phaseNumber, region);
        if (resolved) {
          console.log('[phase-color] 使用数据源: ' + resolved.url + ' (版本目录: ' + resolved.version + ')');
          csvUrl = resolved.url;
        }
      }
    } catch (e) {
      console.error('解析数据源失败:', e);
    }

    if (!csvUrl) {
      console.warn('无法确定对应 CSV 数据源（副本名未匹配或分P不存在），该单元格将显示 -');
      return null;
    }
    console.log('请求CSV数据:', csvUrl);

    try {
      // 检查CSV缓存
      if (csvCache[csvUrl]) {
        console.log('使用缓存的CSV数据');
        const dpsValues = parseCSVData(csvCache[csvUrl], jobClass);
        percentileCache[cacheKey] = dpsValues;
        return dpsValues;
      }

      const csvText = await gmGetText(csvUrl);

      // 保存到CSV缓存
      csvCache[csvUrl] = csvText;
      // 保存缓存到localStorage
      saveCache();

      const dpsValues = parseCSVData(csvText, jobClass);
      percentileCache[cacheKey] = dpsValues;
      return dpsValues;
    } catch (error) {
      console.error('获取CSV数据失败:', error);
      return null;
    }
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

  // 获取页面内容
  function fetchPage(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: 10000, // 设置10秒超时
        onload: function (response) {
          if (response.status === 200) {
            resolve(response.responseText);
          } else {
            reject(`请求失败: ${response.status}`);
          }
        },
        onerror: function (error) {
          reject(error);
        },
        ontimeout: function () {
          reject('请求超时');
        }
      });
    });
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

    // 如果高于最高百分位
    if (rdps >= percentileData[percentiles[0]]) {
      return 99; // 默认为最高的已知百分位
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
    if (document.querySelector('.percentile-header')) return;

    const headerRow = document.querySelector('table thead tr');
    if (!headerRow) return;

    const th = document.createElement('th');
    // 继承网页表头本身的样式：复制第一个已有 th 的类名，再叠加我们的标记类，
    // 这样 CN_logs/EN_logs 表头能自动匹配 FFLogs 原生的 UI 风格。
    const firstTh = headerRow.querySelector('th');
    if (firstTh) {
      th.className = firstTh.className + ' percentile-column percentile-header';
      if (!th.getAttribute('scope')) th.setAttribute('scope', 'col');
    } else {
      th.className = 'percentile-column percentile-header';
    }
    // 国服(z)显示 CN_logs，国际服(j)显示 EN_logs
    th.textContent = PREFERRED_REGION === 'z' ? 'CN_logs' : 'EN_logs';

    if (firstTh) {
      headerRow.insertBefore(th, firstTh);
    } else {
      headerRow.appendChild(th);
    }
  }

  // 添加百分位列
  async function addPercentileColumn() {
    // 等待表格加载完成
    await waitForElement('tr[id^="main-table-row-"]');

    const reportInfo = parseUrl();

    // 查找所有行
    const rows = document.querySelectorAll('tr[id^="main-table-row-"]');

    // 先补表头，避免所有表头后退错位
    ensurePercentileHeader();

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
      cell.className = 'main-table-performance rank percentile-column';
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

    // 查找所有行
    const rows = document.querySelectorAll('tr[id^="main-table-row-"]');

    // 检查是否需要添加百分位列
    const needsPercentileColumn = rows.length > 0 && !hasPercentileColumn;

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