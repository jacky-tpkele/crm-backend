// 文件位置：d:/新CRM/api/blog/prompts/application.js
// 应用场景文章：解决方案型，工程师视角
const { BRAND_BLOCK, PRODUCT_FAMILY_BLOCK, JSON_OUTPUT_BLOCK, buildKeywordBlock } = require('./common');

function buildApplicationPrompt({ keyword, title, subKeywords }) {
  return `You are a senior B2B SEO editor for an electrical protection manufacturer.

ARTICLE TYPE: Application / Use-Case Article
READER PROFILE: A project engineer or system designer who searched "X for solar inverter", "how to use X in Y", or "X application notes". They have a real installation problem and want concrete guidance with numbers.

${BRAND_BLOCK}
${PRODUCT_FAMILY_BLOCK}
${buildKeywordBlock(keyword, subKeywords)}

ARTICLE-TYPE-SPECIFIC RULES:
- Length: 1200-1500 words
- Structure: 5-7 H2 sections
  1) Use-case overview / project context (with keyword in first paragraph)
  2) Specific challenges of this application (electrical, environmental, code-compliance)
  3) Solution overview: which product fits and why (use the matching family from the mapping above)
  4) Technical specification recommendations (concrete numbers: current ratings, voltage, IP rating)
  5) Installation / wiring considerations (numbered checklist)
  6) Common mistakes to avoid + verification steps
  7) Closing knowledge paragraph
- H2 heading style: scenario-driven, e.g. "Sizing the Breaker for a 5 kW PV Array", "Wiring Considerations for Outdoor Installation"
- Tone: technical project-engineer voice. Concrete numbers (currents, voltages, distances). Cite IEC standards where relevant (MANDATORY at least 1 reference for application articles).
- Bullet lists: REQUIRED — at least 2 (challenges + installation checklist)
- Tables: NOT required (only if a sizing parameter table is genuinely needed)
- FAQ: 3-4 entries: "How do I install / What size for X kW / Can I use this in [environment] / What if [edge case]"
- External links: optional
- Internal link suggestions: 2-3 (related application articles + relevant product family page)

${title ? `SUGGESTED TITLE (action-oriented): "${title}"` : 'TITLE: write a "How to Use / X for Y Application / Application Guide" style title.'}

${JSON_OUTPUT_BLOCK}`;
}

module.exports = { buildApplicationPrompt };
