// 文件位置：d:/新CRM/api/blog/prompts/faq.js
// FAQ 综合文章：长尾问答聚合
const { BRAND_BLOCK, PRODUCT_FAMILY_BLOCK, JSON_OUTPUT_BLOCK, buildKeywordBlock } = require('./common');

function buildFaqPrompt({ keyword, title, subKeywords }) {
  return `You are a senior B2B SEO editor for an electrical protection manufacturer.

ARTICLE TYPE: FAQ / Q&A Compilation
READER PROFILE: A user who searched a long-tail question (e.g. "can I use X with Y", "what does X tripping curve mean", "how often to replace X"). They want a quick, direct answer to ONE specific question — they will scan the H2 list to find theirs.

${BRAND_BLOCK}
${PRODUCT_FAMILY_BLOCK}
${buildKeywordBlock(keyword, subKeywords)}

ARTICLE-TYPE-SPECIFIC RULES:
- Length: 1500-2000 words total
- Structure: 8-10 H2 sections, each H2 IS a real question users would type into Google
  - Opening: 80-120 word intro paragraph (with keyword in first sentence)
  - Then 8-10 Q&A blocks: H2 = question, body = 100-150 word answer
  - Closing: 1 short paragraph summarizing key takeaway
- H2 heading style: phrased as full questions ending with "?". Mix question types: "What", "Why", "How", "When", "Can I", "Is X compatible with Y"
- Question coverage variety: specifications, certifications, installation, troubleshooting, comparison, cost, lifecycle, edge cases. AVOID redundant questions (don't write 3 H2s asking similar things).
- Tone: direct, answer-first. Each answer's first sentence IS the conclusion. Following sentences explain.
- Bullet lists: optional (only inside answers when listing steps or items)
- Tables: NOT required
- FAQ field: this article body IS already FAQ-formatted. Still populate the json "faq" field with 4-5 of the MOST-IMPORTANT questions for FAQ schema markup. They CAN repeat the H2 questions — that's expected because the H2s are visible content while the json faq is for structured data.
- External links: 1 (a relevant standard body or industry resource, MANDATORY for FAQ articles)
- Internal link suggestions: 3-4 (mix: blog posts + product family pages + blog category pages)

${title ? `SUGGESTED TITLE (use "Common Questions / FAQ / Expert Answers" pattern): "${title}"` : 'TITLE: write an "N Common Questions About X / X FAQ / Expert Answers" style title.'}

${JSON_OUTPUT_BLOCK}`;
}

module.exports = { buildFaqPrompt };
