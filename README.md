# FFLogs 精确百分位显示

> ⚠️ **AI 修改说明**：本仓库由 AI（WorkBuddy）基于 [The-D66/fflogs-phase-color-show](https://github.com/The-D66/fflogs-phase-color-show) 原仓库修复并改进。**原脚本已过时，在 FFLogs 7.5x（7.51 妖星乱舞）版本的伤害统计页面下无法正常工作**（表格能显示但百分位数字缺失/错误，且默认取的是国际服数据），本版本已修复使其恢复可用。
>
> - **推送原因**：原脚本过旧，在当前 FFLogs 7.5x 版本下无法使用。
> - **参考来源 / 数据来源**：百分位数据来自 [ITX351/fflogs_phase_ranker](https://github.com/ITX351/fflogs_phase_ranker)（见下文「数据来源」）。修复基于对数据源组织方式的分析：数据按版本目录（`v71`/`v72`/…/`v751`）组织，各版本用 `config.json` 的 `raidMatchNames` + `raidLogsPhase` 映射到具体 CSV，并以各 `config.json` 的 `datasetName` 为准确认 **`j` = 国际服、`z` = 国服**。

一个 Tampermonkey 脚本，用于在 FFLogs 的伤害统计页面中显示精确的百分位数据。

## 功能特点

- 在 FFLogs 的伤害统计页面中添加精确百分位列
- 根据不同的副本和阶段**自动选择对应的 CSV 数据源**（动态选源，不再写死 7.1）
- **默认使用国服数据**（可在脚本 `PREFERRED_REGION` 中改为国际服）
- 仅在**具体分P 页面**（URL 含 `phase=数字`）显示百分位；**ALL Phases（`phase=all`）下不显示**分P百分数
- 百分位列独立表头：国服显示 `CN_logs`，国际服显示 `EN_logs`，并继承 FFLogs 原生 UI 风格
- 支持缓存 CSV 数据，减少网络请求
- 自动适应页面变化，确保百分位列始终显示
- 支持中英文职业名称
- 根据百分位值显示不同颜色

## 安装方法

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击 Tampermonkey 图标，选择"添加新脚本"
3. 将脚本内容复制粘贴到编辑器中
4. 保存脚本

或者直接从 [ScriptCat](https://scriptcat.org/zh-CN/script-show-page/7414) 安装。

## 使用方法

1. 安装脚本后，访问 FFLogs 的伤害统计页面
2. 如果页面包含具体的 phase 参数（如 `phase=3`），脚本会自动添加百分位列
3. 百分位列会显示在表格的最左侧
4. 百分位值会根据不同的区间显示不同的颜色

## 数据来源

脚本从 [ITX351/fflogs_phase_ranker](https://github.com/ITX351/fflogs_phase_ranker) 获取 dps 数据，感谢该项目提供的数据支持。

## 主要修复（v0.5 ~ v0.13，由 AI 完成）

1. CSV 数据源路径修正（补 `v71/` 子目录，原 404 导致无数据）
2. 职业名匹配标准化（兼容 `BlackMage` ↔ `Black Mage`）
3. 动态选择数据源（按副本名 + 分P + 区服匹配对应版本 CSV，不再写死 7.1）
4. 默认使用国服数据（修正 `j`/`z` 含义理解反的问题）
5. ALL Phases（`phase=all`）下不再显示分P百分数
6. 为百分位列补独立表头，修复原表头整体错位
7. 表头文案 `CN_logs` / `EN_logs` 并继承 FFLogs 原生 UI 风格

## 注意事项

- 脚本仅在伤害统计页面（包含 `type=damage-done` 的 URL）生效
- 脚本需要访问 GitHub raw 文件，请确保网络连接正常
- 首次加载可能需要一些时间，因为需要下载 CSV 数据

## 许可证

本项目采用 [MIT 许可证](LICENSE)。

## 贡献

欢迎提交问题和改进建议！请访问 [GitHub 仓库](https://github.com/The-D66/fflogs-phase-color-show) 提交 Issue 或 Pull Request。
