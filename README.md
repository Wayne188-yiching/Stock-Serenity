# Stock-Serenity

台股 + 美股混合投組追蹤，內建 Serenity 供應鏈透鏡策略。純前端 SPA，開 `index.html` 即可跑。

**目前階段：Phase 4 完成（體驗打磨）**

## 首次 clone 後設定

`portfolio.json` 已被 `.gitignore`（避免個人持股外流）。第一次 clone 後執行：

```bash
cp portfolio.example.json portfolio.json
```

然後用「我的持倉」頁編輯持股即可，之後所有更動只留在本地。

## 檔案清單

```
Stock-Serenity/
├── index.html                ← 頁面（6 頁 SPA + Drawer + Onboarding）
├── styles.css                ← 設計系統（DS tokens · 深色主題）
├── app.js                    ← 核心邏輯（含資料層 + 技術指標 + 通知）
├── app-enhancements.js       ← UI 補強（Drawer / Tab bar / 排序 / 匯出）
├── portfolio.json            ← 個人真實持股（我的持倉頁讀取）— gitignored，本地才有
├── portfolio.example.json    ← 檔案結構範本，clone 後複製一份成 portfolio.json
├── serenity.json             ← Serenity 名單 + 配置比重（可獨立編輯後 git push 上線）
├── scripts/                  ← CI 用：Anthropic API 分析腳本 + 12 條方法論 prompt
│   ├── serenity-review.mjs   ← 每月 review 主程式
│   ├── skills-prompt.md      ← System prompt（從兩份 MIT skill 蒸餾）
│   └── package.json          ← 只依賴 @anthropic-ai/sdk
├── .github/workflows/
│   └── serenity-review.yml   ← 每日 06:00 Taipei check，到期自動開 PR
├── OPTIMIZATION_GUIDE.html   ← 四階段優化總指南
├── REDESIGN_BRIEF.html       ← Phase 2 Claude Design brief
└── README.md                 ← 本檔
```

## 四階段進度

| Phase | 範疇 | 狀態 |
|---|---|---|
| Phase 1 | 資安 / 穩定性（CORS fallback / XSS / 匯率） | ✅ 完成 |
| Phase 2 | Claude Design 重設計 UI/UX | ✅ 完成 |
| Phase 3 前半 | Prompt D 設計落地 | ✅ 完成 |
| Phase 3 後半 | 資料層（Serenity 單源 / 快取 / 匯出 / NAV） | ✅ 完成 |
| **Phase 4** | **體驗打磨（P3-1~6）** | **✅ 完成** |

## DOM 契約全數保留

| ID / attribute            | 位置                                    |
|---------------------------|-----------------------------------------|
| `#total-value`            | Dashboard KPI (primary)                 |
| `#total-cost`             | Dashboard KPI                           |
| `#total-pnl`              | Dashboard KPI                           |
| `#total-pnl-pct`          | Dashboard KPI                           |
| `#pnl-icon`, `#pnl-pct-icon` | 保留但 CSS 隱藏（不再顯示 icon）     |
| `#holdings-tbody` (10 cols) | Dashboard 持股明細（第 10 欄為觸價狀態） |
| `#allocation-chart`       | Dashboard 持股配置 donut               |
| `#pnl-chart`              | Dashboard 資產淨值走勢（沿用 pnl chart canvas） |
| `#manage-tbody` (8 cols)  | Portfolio 目前持股（含目標價 / 停損可編輯欄） |
| `#add-stock-form`         | Portfolio (Drawer submits into this)   |
| `#stock-market/-symbol/-name/-shares/-cost/-target/-stoploss` | Add stock form fields |
| `#shares-label`           | Form label                              |
| `#chart-stock-select`     | Charts stock selector                   |
| `.period-btn[data-period]`| Charts 期間切換                        |
| `#price-chart`            | Charts 主圖 canvas                     |
| `#ind-ma5/-ma20/-rsi/-macd` | Charts 右側面板                       |
| `#macd-chart`, `#rsi-chart` | Charts 頁 MACD + RSI 獨立子圖 canvas |
| `#news-container`         | News timeline                          |
| `#serenity-budget`        | Serenity 預算 input                    |
| `#serenity-alloc-tbody` (6 cols) | Serenity 配置表                  |
| `#last-update`            | Sidebar footer                          |
| `.nav-item[data-page]`    | Sidebar 導航                           |
| `.card-value`, `.profit-text`, `.loss-text` | app.js 動態 class      |
| `onclick` bindings        | `addStock` `deleteStock` `refreshAll` `calcSerenityAlloc` `fetchNews` |

`app.js` 內每個 `getElementById` / 每個 render function 產生的 innerHTML 結構都對得上 CSS。

## 主要變更 · 從舊版到新版

### 視覺 · Design tokens
- 全部改用 CSS variables（`--bg-base` `--accent-primary` `--sp-*` `--r-*` etc.）
- 深色主題只有一套，不做 light mode
- Inter + Noto Sans TC + JetBrains Mono，數字全部 `tabular-nums`
- 8pt spacing scale · 3 級 radius

### Dashboard
- 4 張 KPI cards：**主卡（總市值）為 primary variant**，最大字級 + 30 日 sparkline
- 資產淨值走勢（沿用 `#pnl-chart` canvas）+ 持股配置 donut，60/40 分欄
- 持股明細 table 換成金融終端風格（40px 行高 · hover 高亮 · 數字欄 tabular-nums 右對齊）
- Segmented control：全部 / TW / US 分市場篩選

### Portfolio 持股管理
- 「新增持股」按鈕觸發**右側 Drawer**（440px slide-over）
- Drawer 內含市場 toggle + 代號 + 名稱 + 持股 + 均價
- Submit 時 mirror 值到原本 `#add-stock-form` 並觸發 submit（app.js 完全不用改）
- 搜尋 + 篩選 chip + 匯入 / 匯出按鈕
- 原本的 inline form 保留但預設隱藏（`hidden` attribute）

### Charts 走勢圖
- 主圖 + 右側 280px 固定面板（現價、52W range slider、技術指標 grid、signals）
- Segmented control 期間切換
- OHLC readout 準備接 crosshair（要求 Chart.js hover event → 更新 `#ohlc-readout`）

### News 新聞
- Two-column layout：左 timeline + 右 filter panel（依持股 / 情緒 / 時間 / 來源）
- News card 改為情緒色 border-left + 已讀/未讀 dot
- 內建篩選 UI（互動邏輯要接：現階段 checkbox / chip 只是視覺）

### Serenity 供應鏈透鏡
- Hero 卡：漸層底 + 摺疊免責聲明 + 右上即時損益
- 配置計算器置頂 + 預算 preset chip（5萬 / 8萬 / 10萬 / 20萬）
- Stacked bar 視覺化配置比例
- 6 格 methodology grid（水平 icon row）

### 手機版
- `< 768px`：sidebar 隱藏，改用 **bottom tab bar**（56px + 20px safe area）
- Tab bar 點擊會同步呼叫 sidebar 的 nav item click（沿用 app.js 導航）
- KPI 卡改成 2×2，primary 卡跨欄
- Drawer 全螢幕，Serenity table 隱藏次要欄位

### 平板（768 – 1023px）
- Sidebar 收合為 64px icon-only
- Grid 從 4-col 收成 2-col

### 首次使用導覽（新功能）
- Welcome modal · 5 步驟 spotlight tour · settings popover
- **狀態存 `localStorage['stockfolio-onboarded']`**
  - 不存在 → 首次載入自動彈出 welcome
  - `'true'` → 已完成，不再自動彈
  - `'skipped'` → 略過，不自動彈但 sidebar 齒輪會顯示紅點提醒可重啟
- Tour 步驟：
  1. Sidebar 五個頁面
  2. KPI cards 「數字是主角」
  3. Holdings table 點列展開
  4. Serenity 策略頁 NEW badge
  5. 完成 + 設定位置
- Tooltip 自動定位（上 / 下 / 左 / 右 + viewport clamp）
- 從 `設定 → 首次使用導覽 → 重新啟動` 可再次觸發

## app-enhancements.js 職責一覽

| 區塊 | 做什麼 |
|------|--------|
| 1. Mobile tab bar sync | 手機底部 tab bar 與 sidebar 雙向同步（重用 app.js `.nav-item` click handler） |
| 2. Drawer | Add-stock drawer 開關 + 提交時 mirror 值到 `#add-stock-form` |
| 3. Settings popover | 齒輪按鈕 popover + toggle 元件 |
| 4. Onboarding tour | Welcome modal + 5 步 spotlight + `localStorage` 狀態管理 |
| 5. Total Value sparkline | 佔位 SVG path（後續可接 `fetchHistory()` 累計數據） |
| 6. Serenity budget presets | 預算 preset chip 觸發 `calcSerenityAlloc()` |
| 7. Holdings count badge | `MutationObserver` 追蹤 `#holdings-tbody` 更新 badge |
| 8. Table sort & search | `wireTable()` 為 holdings/manage 兩表加排序 + 搜尋，`sessionStorage` 記憶狀態，`mutating` flag 防 MutationObserver 遞迴 |
| 9. Export / Import 按鈕綁定 | JSON 匯出、CSV 匯出、CSV 匯入（隱藏 file input） |

## Phase 4 完成項目（P3-1 ~ P3-6）

| # | 項目 | 交付重點 |
|---|---|---|
| P3-1 | 表格排序 & 搜尋 | 持股/管理表 th 點擊循環 asc→desc→none，▲▼ 箭頭；即時搜尋；sessionStorage 記憶排序 |
| P3-2 | 目標價 / 停損 + Notification | portfolio 加 `targetPrice`/`stopLoss`；持股表加「觸價狀態」欄；瀏覽器 Notification + Toast，6h de-dupe |
| P3-3 | 技術指標完整化 | MACD 三序列（macd/signal/histogram）+ RSI Wilder 序列；獨立 `#macd-chart`/`#rsi-chart`；30/70 參考線 |
| P3-4 | Loading Skeleton | KPI shimmer + 3 列骨架 row + chart overlay；`showLoadingSkeletons`/`hideLoadingSkeletons` |
| P3-5 | RWD 補完 | <480px KPI 單欄 + holdings 卡片式；44px 觸控目標；匯出/匯入按鈕綁定 |
| P3-6 | a11y 無障礙 | skip-link、`role="navigation"`、`aria-labelledby`、`<th scope>`、canvas `role="img"`、`:focus-visible` |

## Serenity 名單維護

**要換股或改比重時：**

1. 編輯 `serenity.json`（可以直接在 GitHub 網頁上按鉛筆 icon 編）
2. 更新 `lastReviewed`, `stocks[]` (name/ticker/market/weight/tier)
3. Commit → GitHub Pages 1~2 分鐘後自動生效
4. 不用改任何程式碼

**股價：** app.js 會用 `fetchPrice()` 抓 Yahoo Finance 即時報價（TW 加 `.TW` 後綴，US 直接查），90 秒快取；失敗時對應那一列顯示「價格待更新」，不會用舊快照誤導。

## Serenity 自動 review pipeline

由 GitHub Actions + Anthropic API 驅動，每月自動幫你重排 `stocks[]`，開 PR 讓你 review。

### 一次性設定（5 分鐘）

1. **拿 Anthropic API key**
   - 去 https://console.anthropic.com/
   - Settings → API Keys → Create Key
   - 儲值 $5 起（一次 review 大約消耗 $0.5–$2，撐半年沒問題）

2. **加到 GitHub Secrets**
   - Repo → Settings → Secrets and variables → Actions → New repository secret
   - Name: `ANTHROPIC_API_KEY`
   - Value: 貼你剛才產的 key

3. **完成。** 每天 06:00（Taipei）workflow 會自動檢查 `nextReviewBy`，未到期不會呼叫 API（0 成本）。

### 到期時會發生什麼

- Workflow 讀 `serenity.json` 內的 `stocks[]`（目前 5 檔）+ `candidates[]`（我預填 8 檔候選）
- 對每一檔跑一次 Claude 分析（依 `scripts/skills-prompt.md` 內的 12 條方法論打分）
- 依分數排名，取前 5 名進 `stocks[]`（35/25/20/10/10 權重），其餘回到 `candidates[]`
- 更新 `lastReviewed` / `nextReviewBy`
- 自動開 PR，內容包含每檔的分數 / chokepoint 位置 / 論點 / 失效條件 / 待驗證原始文件
- 你 review + merge → GitHub Pages 網站自動更新

### 手動觸發（不等到月底）

- Repo → Actions → Serenity monthly review → Run workflow
- 勾 `force = true` 就能立刻跑一次

### 想改候選名單？

- 直接編輯 `serenity.json` 的 `candidates[]`
- 加入新的台股（`name` / `ticker` / `market: "TW"` / `note`）
- 下次 review 時 workflow 會納入評分

### 成本 / 上限

- 每次 review 掃 15 檔上限（`MAX_TICKERS_PER_RUN` in `scripts/serenity-review.mjs`）
- 模型預設 `claude-sonnet-5`（可透過手動觸發時的 `model` 參數換成 `claude-opus-4-8`）
- Sonnet 每次 review 約 $0.5–$1，Opus 約 $2–$4

### 免責

- LLM 打分**不是交易信號**，PR 有預設 checklist 要你去公開資訊觀測站抽驗
- Skills 本身明文禁止 buy/sell 語言（見 `scripts/skills-prompt.md`）
- Merge 前一定要看每檔的「失效條件」欄

## 剩餘待接（非 Phase 4 範疇，如需求可另開）

1. **Total Value KPI sparkline 真實數據** — 目前 SVG 佔位；接 NAV 歷史累積
2. **Charts 頁 crosshair + OHLC readout** — Chart.js hover event 更新 `#ohlc-readout` / `#side-current-price`
3. **News 篩選邏輯** — 篩選 checkbox / chip 需綁到 `fetchNews()` 過濾
4. **Holdings row 展開 inline sparkline** — 點列展開 30 日走勢迷你圖
5. **Serenity table expandable rows** — 展開列（論點 / metrics / checklist）

## Chart.js 顏色建議（改進 app.js render 函式時使用）

```js
// Allocation donut
backgroundColor: ['#5b9dff','#a78bfa','#f472b6','#22d3ee','#10b981','#f59e0b','#ef4444','#84cc16']

// Price line
borderColor: '#e6edf7'  // close
// MA5:  '#f472b6'
// MA20: '#22d3ee'

// Grid / axis text
color: '#5c6577'
grid.color: '#1a2333'
```

## 驗證清單

### Phase 3 樣式
- [ ] Chrome 375px（iPhone SE）
- [ ] Chrome 768px（iPad）
- [ ] Chrome 1440px（桌機）
- [ ] 新增假持股，dashboard summary 正確更新
- [ ] Portfolio 頁 drawer 開關順暢，提交後表格更新
- [ ] Charts 頁 period 切換正常
- [ ] Serenity 預算 input + preset 都能觸發計算
- [ ] Onboarding：清除 localStorage `stockfolio-onboarded` 後重新載入應自動彈 welcome
- [ ] 「設定 → 首次使用導覽 → 重新啟動」可再次觸發

### Phase 4 功能
- [ ] Charts 頁選股後 MACD + RSI 兩張獨立圖顯示，x 軸與主圖對齊
- [ ] 持股明細點 th 標題可循環 asc→desc→none，▲▼ 出現在對應欄
- [ ] Dashboard 右上搜尋框輸入即時過濾持股，清空恢復全部
- [ ] Portfolio 頁可內嵌編輯目標價 / 停損，變更立即存 localStorage
- [ ] 現價超過目標價或跌破停損 → 跳 toast + 瀏覽器 Notification（首次會問權限）
- [ ] 觸價通知 6 小時內不重複
- [ ] Refresh 時 KPI + holdings + charts 有 shimmer skeleton 動畫
- [ ] Devtools 375px 檢查 holdings 卡片式 + KPI 單欄
- [ ] Devtools <480px 所有 button 觸控目標 ≥ 44×44px
- [ ] Tab 鍵可完整走完 sidebar → 主要按鈕 → 表格，focus outline 明顯
- [ ] Lighthouse Performance ≥ 90 · Accessibility ≥ 95

---

**Design Reference：** `Stock-Serenity Mockups.dc.html`（9 frames · Dashboard / Portfolio / Charts / News / Serenity / Mobile / Onboarding Welcome / Onboarding Tour / Settings）

**Design System：** `Stock-Serenity DS.dc.html`（12 components · 4 token groups）
