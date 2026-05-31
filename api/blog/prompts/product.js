// 文件位置：d:/新CRM/api/blog/prompts/product.js
// 产品知识文章：教育型，建立专业权威。覆盖"What is X / How does X work / X standards"
const { BRAND_BLOCK, JSON_OUTPUT_BLOCK, buildKeywordBlock } = require('./common');

function buildProductPrompt({ keyword, title, subKeywords }) {
  return `You are a senior B2B SEO editor for an electrical protection manufacturer.

ARTICLE TYPE: Product Knowledge / Educational
GOAL: Educate procurement managers and engineers on what this product/standard is, how it works, and what to look for. Build topical authority.

${BRAND_BLOCK}
${buildKeywordBlock(keyword, subKeywords)}

ARTICLE-TYPE-SPECIFIC RULES:
- Length: 1200-1500 words
- Structure: 5-7 H2 sections in this logical order
  1) Definition / what it is (with first-paragraph keyword mention)
  2) Key technical parameters or specifications
  3) How it works / underlying principle
  4) Standards & compliance (cite at least 1 IEC standard)
  5) Application scenarios (brief, 1-2 paragraphs)
  6) Selection considerations or quality checkpoints
  7) Conclusion (mandatory, 1 short paragraph)
- Tone: textbook-like clarity, technical accuracy, no fluff
- Bullet lists: at least 1 (for parameters / checkpoints)
- Tables: optional (use markdown tables sparingly)
- FAQ: 5-6 entries, focused on "What is / Why / How does / Which standard"
- Keyword density: 1.2-1.8%
- CTA strength: weak — at most one inline contact suggestion at end of conclusion
- External links: REQUIRED 1-2 (IEC.ch official standard pages, IEEE.org)
- Internal link suggestions: 2-3 (related blog topics + 1 product family page)

${title ? `SUGGESTED TITLE (you may refine but keep main keyword): "${title}"` : 'TITLE: write a clear "What/Complete Guide to/Understanding" style title.'}

${JSON_OUTPUT_BLOCK}`;
}

module.exports = { buildProductPrompt };
