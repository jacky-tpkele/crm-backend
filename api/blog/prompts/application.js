// 文件位置：d:/新CRM/api/blog/prompts/application.js
// 应用场景文章：解决方案型，吸引项目经理/工程师
const { BRAND_BLOCK, JSON_OUTPUT_BLOCK, buildKeywordBlock } = require('./common');

function buildApplicationPrompt({ keyword, title, subKeywords }) {
  return `You are a senior B2B SEO editor for an electrical protection manufacturer.

ARTICLE TYPE: Application / Use-Case Article
GOAL: Show how the product solves a real-world installation problem. Engineering tone.

${BRAND_BLOCK}
${buildKeywordBlock(keyword, subKeywords)}

ARTICLE-TYPE-SPECIFIC RULES:
- Length: 1200-1500 words
- Structure: 5-7 H2 sections
  1) Use-case overview / project context (with keyword in first paragraph)
  2) Specific challenges of this application (electrical, environmental, code-compliance)
  3) Solution overview: which product fits and why
  4) Technical specification recommendations (sized to the application)
  5) Installation / wiring considerations (a checklist or step list)
  6) Common mistakes to avoid + how to verify
  7) Conclusion (mandatory)
- Tone: technical project-engineer voice. Concrete numbers (currents, voltages, distances).
- Bullet lists: REQUIRED — at least 2 (challenges, installation checklist)
- Tables: optional
- FAQ: 3-4 entries: "How do I install / What size / Can I use this in [environment] / What if [edge case]"
- Keyword density: 1.0-1.5%
- CTA strength: medium — link to a "Request engineering support" or product family
- External links: optional
- Internal link suggestions: 2-3 (related application stories + relevant product pages)

${title ? `SUGGESTED TITLE (action-oriented): "${title}"` : 'TITLE: write a "How to Use / Application Guide / X for Y" style title.'}

${JSON_OUTPUT_BLOCK}`;
}

module.exports = { buildApplicationPrompt };
