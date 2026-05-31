// 文件位置：d:/新CRM/api/blog/prompts/comparison.js
// 对比文章：拦截 "X vs Y" 长尾流量
const { BRAND_BLOCK, JSON_OUTPUT_BLOCK, buildKeywordBlock } = require('./common');

function buildComparisonPrompt({ keyword, title, subKeywords }) {
  return `You are a senior B2B SEO editor for an electrical protection manufacturer.

ARTICLE TYPE: Comparison Article (X vs Y)
GOAL: Capture comparison-intent search traffic. Reader wants a clear verdict.

${BRAND_BLOCK}
${buildKeywordBlock(keyword, subKeywords)}

ARTICLE-TYPE-SPECIFIC RULES:
- Length: 1000-1300 words
- Structure: 4-5 H2 sections
  1) Quick verdict in opening (state which to use when, in 2-3 sentences) — Google likes upfront answers
  2) Side-by-side comparison TABLE (markdown table, MANDATORY) — covers: parameter / X / Y rows
  3) Strengths and ideal use cases of X
  4) Strengths and ideal use cases of Y
  5) Conclusion: which to choose, when (mandatory)
- Tone: balanced, fair, evidence-based. Do NOT favor one side without reason.
- Tables: MANDATORY — must include 1 comparison table with at least 5 rows
- Bullet lists: in strengths/ideal-use sections
- FAQ: 3-4 entries: "Which is better / Can X replace Y / Cost difference / Switching from X to Y"
- Keyword density: 1.0-1.5% (the comparison terms naturally repeat)
- CTA strength: medium — at the closing
- External links: optional
- Internal link suggestions: REQUIRED 2 — one product page for X, one for Y

CRITICAL: When the keyword is "X vs Y" style, treat both X and Y with equal depth. Do not write a hidden ad for one side.

${title ? `SUGGESTED TITLE (keep "vs"/"versus" pattern + main keyword): "${title}"` : 'TITLE: write an "X vs Y / Key Differences / Which Is Better" style title.'}

${JSON_OUTPUT_BLOCK}`;
}

module.exports = { buildComparisonPrompt };
