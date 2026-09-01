// 文件位置：d:/新CRM/api/blog/prompts/common.js
// 5 套类型 Prompt 的公共片段：公司信息、产品族对应、输出 JSON、通用 SEO 约束

const BRAND_BLOCK = `
COMPANY CONTEXT (do not invent other brands):
- Brand: TPKele
- Website: https://www.tpkele.com (NEVER use crm.tpkele.com or any other subdomain in article content)
- Industry: B2B manufacturer of solar DC and low-voltage electrical protection products
- Target audience: international procurement managers, solar EPC engineers, electrical contractors, distributors
- Voice: professional, technical, helpful, concrete (concrete current ratings, IEC standards, real-world scenarios). NEVER salesy or hype-laden.
- Audience reads English; everything (title, content, meta, FAQ) must be in English.
`;

// 产品族严格对应表 —— 让 AI 提到的具体产品和文章主题匹配，避免"AC MCB 文章"里乱提 DC SPD
const PRODUCT_FAMILY_BLOCK = `
PRODUCT FAMILY MAPPING (you MUST mention only the product family that fits the topic):
- Generic "MCB" or "circuit breaker" or "miniature circuit breaker" topics → mention "AC MCB 1P/2P/3P/4P series" or "DC MCB 1P/2P/3P/4P series"
- Topics specifically about AC MCB → ONLY "AC MCB 1P/2P/3P/4P series"
- Topics about DC MCB / solar circuit breaker / PV breaker → ONLY "DC MCB 1P/2P/3P/4P series"
- "SPD" or "surge protector" / "surge protective device" → "AC SPD" or "DC SPD"
- AC-specific SPD topics → ONLY "AC SPD"
- DC/solar SPD topics → ONLY "DC SPD"
- "ATS" / "automatic transfer switch" → "ATS"
- "PV combiner box" / "DC combiner" / "string combiner" → "PV Combiner Box"
- "voltage protector" / "over/under voltage protection" → "Voltage Protector"
- "energy meter" / "kWh meter" / "DIN rail meter" → "DIN Rail Energy Meter"

DO NOT mention competitor brands. DO NOT invent specific SKU numbers.
DO NOT mention product families that are unrelated to the article topic
(e.g. an article about MCBs should NOT promote SPDs or energy meters).
`;

// AI 输出 JSON 格式 —— DeepSeek/GPT 已强制 response_format json，但仍写在 prompt 里双保险
const JSON_OUTPUT_BLOCK = `
OUTPUT FORMAT — return ONE single valid JSON object. No markdown fences, no preamble, no trailing prose.

{
  "title": "string — 30-70 chars. MUST include the main keyword. For long keywords (4+ words), include at least the first 2-3 core words. Example: for 'iec 60898 circuit breaker standards' use 'IEC 60898 Circuit Breaker Standards Guide'",
  "content": "string — Markdown body. Starts with intro paragraph (no H1, the title above is the H1). Then ## H2 sections, paragraphs, bullet lists where useful. NO image markdown (![](...)). NO HTML. NO call-to-action sales language at the end (the website renders a CTA component automatically — your last paragraph should end on a knowledge note or next-step suggestion).",
  "meta_title": "string — 30-60 chars, MUST contain main keyword, click-worthy",
  "meta_description": "string — 120-155 chars (leave 5-char buffer for safety), MUST contain main keyword, value proposition",
  "main_keyword": "string — same as the input keyword",
  "sub_keywords": ["string", "string", "string", "string"],
  "faq": [
    {"question": "string", "answer": "string — 2-4 sentences"}
  ],
  "internal_link_suggestions": [
    {"anchor": "string — exact phrase from article body (2-5 words, naturally appearing in text)", "url_hint": "keyword description: 'AC MCB products' or 'DC circuit breaker category' or 'installation guide blog'", "reason": "string — 1 sentence why"}
  ],
  "external_link_suggestions": [
    {"anchor": "string — exact phrase from article body (e.g. 'IEC 60898', 'IEEE standards')", "url": "string — full https:// (only use: IEC.ch, IEEE.org, NEMA.org, EN/IEC official sites)", "reason": "string"}
  ]
}

CRITICAL RULES (apply to every article type):
1. Main keyword frequency:
   - For SHORT keywords (1-2 words): use EXACTLY 4-6 times naturally in body paragraphs
   - For LONG keywords (3+ words): use the FULL phrase 2-3 times, plus use core words/variations 3-5 more times
   - FIRST mention MUST be in the opening paragraph (within first 100 words)
2. Main keyword placement: MUST appear in title (full or core words), first paragraph (within first 100 words), at least one H2 heading, meta_title, meta_description.
3. NEVER invent product specifications, certifications, or test data. Only reference IEC standards that actually exist (IEC 60898, IEC 60947-2, IEC 61643, IEC 60364, IEC 62109, IEEE C62.41, etc.).
3a. NEVER write full URLs in article body content (no https://www.tpkele.com/... or https://crm.tpkele.com/... in paragraphs). Links are inserted automatically via internal_link_suggestions and external_link_suggestions.
4. Internal links:
   - anchor: MUST be exact 2-5 word phrases that ALREADY APPEAR in your article body (e.g. if you write "AC MCB products", use that as anchor)
   - url_hint: describe what page type to link (use keywords like: "AC MCB products", "DC circuit breaker category", "SPD installation guide", "voltage protector selection")
   - REQUIRED: 2-3 internal link suggestions
5. External links:
   - anchor: MUST be exact phrases from your article (e.g. "IEC 60898", "IEEE C62.41")
   - url: ONLY use official sources: https://webstore.iec.ch, https://standards.ieee.org, https://www.nema.org, https://webstore.ansi.org
   - REQUIRED: 1-2 external link suggestions
6. Avoid first-person plural ("we", "our company", "we offer", "contact us") in body text — keep it informational. The website renders a separate CTA component below the article, so body content should be pure knowledge content.
7. End the body content with a knowledge-focused closing paragraph (1-3 sentences). Examples: "These principles ensure reliable protection across most installations." or "Selecting components that meet these specifications protects both equipment and personnel." DO NOT write "contact us for a quote" or similar sales language.
8. CONTENT UNIQUENESS: If this keyword has been covered before, approach it from a DIFFERENT ANGLE:
   - Use different examples, different application scenarios, different technical details
   - Vary your H2 structure and section focus
   - Reference different IEC standards or technical aspects
   - This ensures each article on the same topic provides unique value
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
  PRODUCT_FAMILY_BLOCK,
  JSON_OUTPUT_BLOCK,
  buildKeywordBlock,
};
