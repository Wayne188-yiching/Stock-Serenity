// Monthly Serenity review — scores current stocks + candidates via Anthropic
// API, ranks them, and writes a proposed serenity.json + review-report.md.
//
// Env:
//   ANTHROPIC_API_KEY  (required)
//   FORCE_RUN=true     (optional, bypass nextReviewBy date gate)
//   MODEL              (optional, defaults to claude-sonnet-5)
//
// Exit codes:
//   0  ok — either wrote proposal, or nothing due
//   1  fatal error
//   2  API key missing

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const MODEL = process.env.MODEL || "claude-sonnet-5";
const MAX_TICKERS_PER_RUN = 15;
const TOP_N = 5;
const DEFAULT_WEIGHTS = [0.35, 0.25, 0.20, 0.10, 0.10];
const DEFAULT_CADENCE_DAYS = 30;
const REQUEST_SPACING_MS = 1500;

async function main() {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error("ANTHROPIC_API_KEY not set. Add it as a GitHub Actions secret.");
        process.exit(2);
    }

    const force = process.env.FORCE_RUN === "true";
    const serenityPath = path.join(REPO_ROOT, "serenity.json");
    const serenity = JSON.parse(await readFile(serenityPath, "utf-8"));

    if (!force && !isReviewDue(serenity.nextReviewBy)) {
        console.log(`Not due yet (nextReviewBy=${serenity.nextReviewBy}). Skipping.`);
        // Signal to workflow via file — no PR needed
        await writeFile(path.join(__dirname, ".skip"), "not-due\n", "utf-8");
        process.exit(0);
    }

    const systemPrompt = await readFile(
        path.join(__dirname, "skills-prompt.md"),
        "utf-8"
    );

    const universe = [
        ...(serenity.stocks || []).map((s) => ({ ...s, source: "current" })),
        ...(serenity.candidates || []).map((c) => ({ ...c, source: "candidate" })),
    ].slice(0, MAX_TICKERS_PER_RUN);

    if (!universe.length) {
        console.error("No stocks or candidates to review. Exiting.");
        process.exit(1);
    }

    console.log(`Scoring ${universe.length} tickers with ${MODEL}...`);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const results = [];

    for (const stock of universe) {
        process.stdout.write(`  → ${stock.ticker} ${stock.name} ... `);
        try {
            const analysis = await analyzeOne(client, systemPrompt, stock);
            results.push({ ...stock, ...analysis });
            console.log(`score ${analysis.final_score?.toFixed(1) ?? "?"}`);
        } catch (err) {
            console.log(`FAIL (${err.message})`);
            results.push({
                ...stock,
                final_score: 0,
                error: err.message,
                tier: "⚠️ 分析失敗",
            });
        }
        await sleep(REQUEST_SPACING_MS);
    }

    results.sort((a, b) => (b.final_score || 0) - (a.final_score || 0));

    const topN = results.slice(0, TOP_N);
    const remaining = results.slice(TOP_N);

    const today = new Date().toISOString().slice(0, 10);
    const cadence = serenity.reviewCadenceDays || DEFAULT_CADENCE_DAYS;
    const nextReview = addDays(today, cadence);

    const proposed = {
        lastReviewed: today,
        nextReviewBy: nextReview,
        reviewCadenceDays: cadence,
        strategyNote: serenity.strategyNote,
        stocks: topN.map((r, i) => ({
            name: r.name,
            ticker: r.ticker,
            market: r.market || "TW",
            weight: DEFAULT_WEIGHTS[i] ?? 0.05,
            tier: r.tier || tierFromScore(r.final_score),
        })),
        candidates: remaining.map((r) => ({
            name: r.name,
            ticker: r.ticker,
            market: r.market || "TW",
            note: r.note || r.chokepoint_layer || "",
        })),
    };

    await writeFile(
        serenityPath,
        JSON.stringify(proposed, null, 2) + "\n",
        "utf-8"
    );

    const report = buildReport(results, topN, today, nextReview);
    await writeFile(path.join(__dirname, "review-report.md"), report, "utf-8");

    console.log(
        `\nDone. Top ${topN.length} picks + ${remaining.length} candidates written to serenity.json.`
    );
}

function isReviewDue(nextReviewBy) {
    if (!nextReviewBy) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(nextReviewBy);
    due.setHours(0, 0, 0, 0);
    return today >= due;
}

function addDays(isoDate, days) {
    const d = new Date(isoDate);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

function tierFromScore(score) {
    if (score >= 85) return "⭐ 最高";
    if (score >= 70) return "🔥 高";
    if (score >= 55) return "📈 中高";
    if (score >= 40) return "🛡️ 底倉";
    return "⚠️ 觀察";
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function analyzeOne(client, systemPrompt, stock) {
    const userMessage =
        `分析台股 ${stock.ticker}（${stock.name}）的供應鏈瓶頸位置與投資研究優先度。` +
        (stock.note ? `\n\n已知背景：${stock.note}` : "") +
        `\n\n嚴格依系統指令產出 JSON，不要 markdown 圍欄，不要任何解釋文字。`;

    const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
    });

    const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

    return parseJsonRobustly(text);
}

function parseJsonRobustly(text) {
    let cleaned = text.trim();
    // Strip common markdown fences if the model ignored the "no fences" rule
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) {
        throw new Error(
            `No JSON object in response: ${text.slice(0, 200)}...`
        );
    }
    return JSON.parse(cleaned.slice(start, end + 1));
}

function buildReport(all, topN, today, nextReview) {
    const lines = [
        `# Serenity 月度 review — ${today}`,
        ``,
        `> Auto-generated by \`.github/workflows/serenity-review.yml\`.  `,
        `> **人工 review 後再 merge。** LLM 打分不是交易信號。`,
        ``,
        `- **模型：** \`${MODEL}\``,
        `- **下次 review：** ${nextReview}`,
        `- **分析標的數：** ${all.length}`,
        ``,
        `## 排名結果（12 條方法論分數）`,
        ``,
        `| 排名 | 代號 | 名稱 | 分數 | Tier | Chokepoint 層 |`,
        `|---:|---|---|---:|---|---|`,
    ];

    all.forEach((r, i) => {
        const inTop = i < topN.length ? " **✓**" : "";
        const layer = (r.chokepoint_layer || "—").replace(/\|/g, "\\|");
        lines.push(
            `| ${i + 1}${inTop} | ${r.ticker} | ${r.name} | ${r.final_score?.toFixed(1) ?? "—"} | ${r.tier ?? "—"} | ${layer} |`
        );
    });

    lines.push(``, `## 前 ${topN.length} 名 → 建議進入 stocks[]`, ``);

    topN.forEach((r, i) => {
        const w = (DEFAULT_WEIGHTS[i] ?? 0.05) * 100;
        lines.push(`### ${i + 1}. ${r.name} (${r.ticker}) — ${w}%`);
        lines.push(``);
        lines.push(`- **Tier：** ${r.tier ?? "—"}`);
        lines.push(`- **分數：** ${r.final_score?.toFixed(1) ?? "—"}`);
        lines.push(`- **Chokepoint 層：** ${r.chokepoint_layer ?? "—"}`);
        lines.push(``);
        lines.push(`**論點：** ${r.rationale_zh ?? "—"}`);
        lines.push(``);
        lines.push(`**失效條件：** ${r.invalidation ?? "—"}`);
        if (Array.isArray(r.primary_evidence_needed) && r.primary_evidence_needed.length) {
            lines.push(``);
            lines.push(`**待驗證原始文件：**`);
            r.primary_evidence_needed.forEach((e) => lines.push(`- ${e}`));
        }
        lines.push(``);
    });

    if (all.some((r) => r.error)) {
        lines.push(``, `## ⚠️ 分析失敗的標的`, ``);
        all.filter((r) => r.error).forEach((r) => {
            lines.push(`- **${r.ticker} ${r.name}** — ${r.error}`);
        });
    }

    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    lines.push(`## 免責與 review checklist`);
    lines.push(``);
    lines.push(`Merge 之前請確認：`);
    lines.push(``);
    lines.push(`- [ ] 至少抽 2 檔到公開資訊觀測站查最近月營收 / 財報是否符合論點`);
    lines.push(`- [ ] 檢查每檔 Yahoo 股價與 LLM 隱含估值方向是否一致`);
    lines.push(`- [ ] 讀 top 3 的「失效條件」，確認邏輯合理`);
    lines.push(`- [ ] 前 5 名總權重 = 100%（35/25/20/10/10）`);
    lines.push(`- [ ] 沒有已知「地雷」個股（下市風險、財報疑慮）混進來`);
    lines.push(``);
    lines.push(`LLM 分析可能有幻覺、時間差、資料錯誤 — 交易決策仍以你自己的驗證為準。`);
    lines.push(``);

    return lines.join("\n");
}

main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
});
