// 文件位置：d:/新CRM/api/blog/prompts/faq.js
// FAQ 综合文章：长尾问答聚合
const { BRAND_BLOCK, JSON_OUTPUT_BLOCK, buildKeywordBlock } = require('./common');

function buildFaqPrompt({ keyword, title, subKeywords }) {
  return `You are a senior B2B SEO editor for an electrical protection manufacturer.

ARTICLE TYPE: FAQ / Q&A Compilation
GOAL: Aggregate long-tail questions around the topic. Each H2 IS a question.

${BRAND_BLOCK}
${buildKeywordBlock(keyword, subKeywords)}

ARTICLE-TYPE-SPECIFIC RULES:
- Length: 1500-2000 words
- Structure: 8-10 H2 sections, each H2 is a real question users would type into Google
  - Opening 100-word intro paragraph (with keyword)
  - Then 8-10 Q&A blocks: H2 = question, body = 100-150 word answer
  - Closing summary paragraph (mandatory)
- Question variety: cover specifications, certifications, installation, troubleshooting, comparison, cost, lifecycle
- Tone: direct, answer-first. Each answer starts with the conclusion in sentence 1.
- Bullet lists: optional (within answers when steps are involved)
- Tables: optional
- FAQ field: this article IS itself FAQ-formatted. Still populate the faq field with 4-5 of the MOST-ASKED questions (a subset suitable for FAQ schema markup). They CAN repeat questions used as H2 — that is OK because the schema and the visible H2 serve different purposes.
- Keyword density: 1.5-2.0%
- CTA strength: weak (one closing CTA)
- External links: 1 (a relevant standard body)
- Internal link suggestions: 3-4 (varied: blog posts + product pages + categories)

${title ? `SUGGESTED TITLE (use "Common Questions / FAQ / Expert Answers" pattern): "${title}"` : 'TITLE: write an "N Common Questions About X / X FAQ / Expert Answers" title.'}

${JSON_OUTPUT_BLOCK}`;
}

module.exports = { buildFaqPrompt };
