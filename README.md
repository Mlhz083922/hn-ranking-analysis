# HN Ranking Analysis

Amazon US 泳装类目周度榜单只读站，供运营团队查看最新 BSR / New Releases Top100、跨期榜位变化和本期分析结论。

## 数据来源

- 原始榜单：`AMZ- auto/榜单Data/Raw`
- 本期汇总：`AMZ- auto/榜单Data/Output/榜单分析汇总_YYYYMMDD.xlsx`

## 本地构建

```bash
node build-site.mjs
python3 -m http.server 8780 -d docs
```

构建脚本默认读取 `/Users/lynn/Desktop/AMZ- auto`，也可以通过 `RANKING_WORKSPACE_DIR` 覆盖。

## 发布

工作台 `http://localhost:8766/#category` 的“更新团队链接”按钮会执行构建、提交并推送 `docs/` 到本仓库的 `main` 分支。

团队链接：<https://Mlhz083922.github.io/hn-ranking-analysis/>
