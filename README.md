# HN Ranking Analysis

Amazon US 泳装类目周度榜单只读站。除工作台“分析工具”外，保留全部三个只读模块：

- 子类目榜单：全部 13 个榜单期，四类目 BSR / NEW 图片模式和表格模式
- 汇总报告：全部 14 份完整工作簿（汇总表 + 4 个子类目明细表）
- 跨期对比：任意两期指标对比、ASIN 异动、全部期次趋势

## 数据来源

- 原始榜单：`AMZ- auto/榜单Data/Raw`
- 全部汇总：`AMZ- auto/榜单Data/Output/榜单分析汇总_YYYYMMDD.xlsx`

## 本地构建

```bash
node build-site.mjs
python3 -m http.server 8780 -d docs
```

构建脚本默认读取 `/Users/lynn/Desktop/AMZ- auto`，也可以通过 `RANKING_WORKSPACE_DIR` 覆盖。

## 发布

工作台 `http://localhost:8766/#category` 的“更新团队链接”按钮会执行构建、提交并推送 `docs/` 到本仓库的 `main` 分支。

团队链接：<https://Mlhz083922.github.io/hn-ranking-analysis/>
