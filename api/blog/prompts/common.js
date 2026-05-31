// 文件位置：d:/新CRM/api/blog/prompts/common.js
// 5 套类型 Prompt 的公共片段：公司信息、输出 JSON 结构、通用 SEO 约束

const BRAND_BLOCK = `
COMPANY CONTEXT (do not invent other brands):
- Brand: TPKele
- Industry: B2B manufacturer of solar DC and low-voltage electrical protection products
- Product families: AC/DC MCBs, AC/DC SPDs, ATS (automatic transfer switch), PV combiner boxes, voltage protectors, DIN rail energy meters
- Target audience: international procurement managers, solar EPC engineers, electrical contractors, distributors
- Voice: professional, technical, helpful, concrete (concrete current ratings, IEC standards, real-world scenarios). NEVER salesy or hype-laden.
- Audience reads English; everything (title, content, meta, FAQ) must be in English.
`;

const JSON_OUTPUT_BLOCK = `
OUTPUT FORMAT — return ONE single valid JSON object. No markdown fences, no preamble, no trailing prose.

{
  "title": "string — 30-70 chars, MUST contain the main keyword",
  "content": "string — Markdown body. Starts with intro paragraph (no H1, the title above is the H1). Then ## H2 sections, paragraphs, bullet lists where useful. NO image markdown (![](...)). NO HTML.",
  "meta_title": "string — 30-60 chars, MUST contain main keyword, click-worthy",
  "meta_description": "string — 120-160 chars, MUST contain main keyword, value proposition + CTA hint",
  "main_keyword": "string — same as the input keyword",
  "sub_keywords": ["string", "string", "string", "string"],
  "faq": [
    {"question": "string", "answer": "string — 2-4 sentences"}
  ],
  "internal_link_suggestions": [
    {"anchor": "string — short anchor text from the article", "url_hint": "/blog/related-topic OR /products/some-slug", "reason": "string — 1 sentence why"}
  ],
  "external_link_suggestions": [
    {"anchor": "string", "url": "string — full https://", "reason": "string"}
  ]
}

CRITICAL RULES (apply to every article type):
1. Main keyword density: 1.0%-2.5% of total word count. Mention naturally, do not stuff.
2. Main keyword MUST appear in: title, first paragraph (within first 100 words), at least one H2 heading, meta_title, meta_description.
3. NEVER invent product specifications, certifications, or test data. Use IEC standard references that actually exist (IEC 60898, IEC 60947-2, IEC 61643, IEC 60364, IEEE C62.41 etc.).
4. NEVER invent internal URLs. The url_hint should describe the type of page (e.g. "/products/ac-mcb-1p", "/blog/spd-installation"). The CRM operator will replace with real URLs during review.
5. External links must be authoritative: IEC.ch, IEEE.org, NEMA.org, government standards bodies, or major industry associations. Do NOT link to competitor manufacturers.
6. Avoid first-person plural ("we", "our company") in body text — keep it informational. CTAs at the end may use first-person.
`;

function buildKeywordBlock(keyword, subKeywords) {
  const subs = (subKeywords || []).filter(Boolean);
  return `
TARGET KEYWORD INPUT:
- Main keyword: "${keyword}"
${subs.length > 0 ? `- Sub keywords (use 1-2 of these in H2 headings or naturally in body): ${subs.map(s => `"${s}"`).join(', ')}` : '- Sub keywords: derive 4 closely-related long-tail variants and put them in sub_keywords field'}
`;
}

module.exports = {
  BRAND_BLOCK,
  JSON_OUTPUT_BLOCK,
  buildKeywordBlock,
};
