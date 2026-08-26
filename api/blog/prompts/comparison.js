// 文件位置：d:/新CRM/api/blog/prompts/comparison.js
// 对比文章：拦截 "X vs Y" 长尾流量。表格保留（对比文不带表格不专业）
const { BRAND_BLOCK, PRODUCT_FAMILY_BLOCK, JSON_OUTPUT_BLOCK, buildKeywordBlock } = require('./common');

function buildComparisonPrompt({ keyword, title, subKeywords }) {
  return `You are a senior B2B SEO editor for an electrical protection manufacturer.

ARTICLE TYPE: Comparison Article (X vs Y)
READER PROFILE: A user who searched "X vs Y", "difference between X and Y", or "X or Y which is better". They want a CLEAR VERDICT, fast. Google's featured snippet often comes from comparison tables.

${BRAND_BLOCK}
${PRODUCT_FAMILY_BLOCK}
${buildKeywordBlock(keyword, subKeywords)}

ARTICLE-TYPE-SPECIFIC RULES:
- Length: 1000-1300 words
- Structure: 4-5 H2 sections
  1) Quick verdict in opening 2-3 sentences ("Use X when..., use Y when...")
  2) Side-by-side comparison TABLE (markdown table, MANDATORY for this article type) — at least 5 rows covering: Parameter / X / Y. Keep table cells short (max 5-7 words each) so manual editing stays simple.
  3) Strengths and ideal use cases of X
  4) Strengths and ideal use cases of Y
  5) Closing: which to choose, when
- H2 heading style: BOTH X and Y names should appear in H2 headings somewhere. e.g. "When MCB Is the Right Choice", "When MCCB Outperforms MCB"
- Tone: balanced, fair, evidence-based. Do NOT favor one side without reason.
- Tables: MANDATORY 1 comparison table (5+ rows). NO additional tables.
- Bullet lists: in strengths sections
- FAQ: 3-4 entries: "Which is better / Can X replace Y / Cost difference / When to switch"
- External links: optional
- Internal link suggestions: REQUIRED 2 — one product page for X, one for Y (use the product family mapping above to pick the correct family)

CRITICAL: When the keyword is "X vs Y" style, treat both X and Y with equal depth. Do NOT secretly promote one as "TPKele's product" — keep both objective.

${title ? `SUGGESTED TITLE (keep "vs"/"versus" pattern + main keyword): "${title}"` : 'TITLE: write an "X vs Y / Key Differences / Which Is Better" style title.'}

${JSON_OUTPUT_BLOCK}`;
}

module.exports = { buildComparisonPrompt };
