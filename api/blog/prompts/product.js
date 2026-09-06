// 文件位置：d:/新CRM/api/blog/prompts/product.js
// 产品知识文章：教育型，建立专业权威
const { BRAND_BLOCK, PRODUCT_FAMILY_BLOCK, LINK_RULES_BLOCK, JSON_OUTPUT_BLOCK, buildKeywordBlock } = require('./common');

function buildProductPrompt({ keyword, title, subKeywords }) {
  return `You are a senior B2B SEO editor for an electrical protection manufacturer.

ARTICLE TYPE: Product Knowledge / Educational
READER PROFILE: A procurement manager or junior electrical engineer who searched Google for "what is X", "how does X work", or "X explained". They want to UNDERSTAND the topic clearly, not buy yet.

${BRAND_BLOCK}
${PRODUCT_FAMILY_BLOCK}
${buildKeywordBlock(keyword, subKeywords)}

ARTICLE-TYPE-SPECIFIC RULES:
- Length: STRICTLY 1200-1500 English words. Count before finishing. If under 1200 words, add more examples, expand sections, or add technical details.
- Structure: 5-7 H2 sections in this logical order
  1) Definition / what it is (with first-paragraph keyword mention)
  2) Key technical parameters or specifications
  3) How it works / underlying principle
  4) Standards & compliance (cite at least 1 IEC standard, MANDATORY for this article type - use external links here)
  5) Application scenarios (1-2 paragraphs)
  6) Selection considerations or quality checkpoints
  7) Closing knowledge paragraph + CTA (select appropriate template)
- H2 heading style: use noun phrases or "What is / How / Why" question forms. DO NOT use sales-y H2s like "Why Choose TPKele".
- Tone: textbook-like clarity, technical accuracy, no fluff
- Bullet lists: at least 1 (for parameters or checkpoints)
- Tables: NOT required (only if a parameter comparison genuinely needs it)
- FAQ: 5-6 entries focused on "What is / Why / How does / Which standard"

${title ? `SUGGESTED TITLE (refine but keep main keyword): "${title}"` : 'TITLE: write a clear "What Is / Complete Guide to / Understanding" style title.'}

${LINK_RULES_BLOCK}
${JSON_OUTPUT_BLOCK}`;
}

module.exports = { buildProductPrompt };
