// 文件位置：d:/新CRM/api/blog/prompts/common.js
// 5 套类型 Prompt 的公共片段：公司信息、产品族对应、输出 JSON、通用 SEO 约束

const BRAND_BLOCK = `
COMPANY CONTEXT (do not invent other brands):
- Brand: TPKele
- Website: https://www.tpkele.com (NEVER use crm.tpkele.com or any other subdomain in article content)
- Industry: B2B manufacturer of solar DC and low-voltage electrical protection products
- Main products: DC MCB, AC MCB, DC MCCB, AC SPD, DC SPD, ATS (Automatic Transfer Switch), Voltage Protector, DIN Rail Energy Meter, PV Combiner Box, PV Fuse, DC Isolator
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
- "DC MCCB" / "molded case circuit breaker for DC" → "DC MCCB"
- "PV fuse" / "solar fuse" → "PV Fuse"
- "DC isolator" / "PV isolator switch" → "DC Isolator"

DO NOT mention competitor brands. DO NOT invent specific SKU numbers.
DO NOT mention product families that are unrelated to the article topic
(e.g. an article about MCBs should NOT promote SPDs or energy meters).
DO NOT force product mentions into every section - only mention products when naturally relevant to solving the reader's problem.
`;

// 外链和内链严格规则 —— 基于用户提供的完整规范
const LINK_RULES_BLOCK = `
═══════════════════════════════════════════════════════════════════
EXTERNAL LINKS & INTERNAL LINKS - MANDATORY RULES (READ CAREFULLY)
═══════════════════════════════════════════════════════════════════

You are writing for TPKELE (https://www.tpkele.com), a B2B electrical products manufacturer.
Every article MUST include both external reference links and internal TPKELE links.

┌─────────────────────────────────────────────────────────────────┐
│ PART 1: EXTERNAL LINKS (Authoritative Reference Links)         │
└─────────────────────────────────────────────────────────────────┘

PURPOSE:
- Support technical parameters, standards, regulations, safety requirements
- Provide authoritative background information
- Enhance article credibility and E-E-A-T
- Help readers further understand technical standards

QUANTITY:
- 1000-1500 word articles: 2-4 external links
- 1500-2500+ word articles: 3-5 external links
- DO NOT add more links just to reach a number - quality over quantity
- Same external domain: maximum 1-2 times per article

TRUSTED SOURCES (ONLY use these types):
1. International standards organizations:
   ✓ https://www.iec.ch (International Electrotechnical Commission)
   ✓ https://www.ieee.org (Institute of Electrical and Electronics Engineers)
   ✓ https://www.iso.org (International Organization for Standardization)
   ✓ https://www.nfpa.org (National Fire Protection Association)
   ✓ https://www.nema.org (National Electrical Manufacturers Association)
   ✓ https://www.ul.com (Underwriters Laboratories)

2. Government agencies and energy organizations:
   ✓ https://www.energy.gov (U.S. Department of Energy)
   ✓ https://www.nrel.gov (National Renewable Energy Laboratory)
   ✓ https://www.osha.gov (Occupational Safety and Health Administration)
   ✓ Official EU agency websites

3. Universities, research institutions, technical organizations

4. Wikipedia for technical concept explanations:
   ✓ https://en.wikipedia.org/wiki/[Technical_Topic]

5. When explaining a technology, you may reference public technical documentation from well-known electrical component manufacturers, but avoid linking to direct competitors' product purchase pages.

STRICTLY FORBIDDEN:
✗ NEVER invent URLs - if you cannot verify a link exists, omit it completely
✗ NEVER guess non-existent webpage addresses
✗ NEVER link to: spam sites, content farms, scraped content sites
✗ NEVER link to: gambling, adult content, crypto scam sites
✗ NEVER force unrelated links just for SEO
✗ NEVER link to competitor product sales/purchase pages as primary recommendations
✗ NEVER use e-commerce sites (Amazon, Alibaba) as technical references
✗ NEVER link to deep unstable paths (e.g. webstore.iec.ch/publication/27173)
✗ Link to organization homepages or stable reference pages instead

ANCHOR TEXT RULES:
✓ CORRECT: "IEC 60947-2 defines requirements for low-voltage circuit breakers..."
  → Use "IEC 60947-2" or "IEC requirements for circuit breakers" as anchor
✓ CORRECT: Natural semantic anchors like "NFPA 70E safety standards", "IEEE surge protection guidelines"

✗ NEVER use meaningless anchors: "click here", "read more", "website", "source"

LINK PLACEMENT:
- External links MUST be placed in sentences directly related to that source
- Distribute links naturally throughout the article, not clustered in one section
- Do NOT create a separate "External Links" section at the end

PRIORITY LINKING RULES:
- If content involves IEC standards → link to IEC
- If content involves UL standards → link to UL
- If content involves PV technology → link to NREL / IEC / IEEE
- If content involves electrical safety → link to NFPA / IEC / OSHA
- If content involves technical papers → link to original paper, university, or research institution
- DO NOT link to reposted/copied articles - always use original sources

┌─────────────────────────────────────────────────────────────────┐
│ PART 2: INTERNAL LINKS (TPKELE Site Links)                     │
└─────────────────────────────────────────────────────────────────┘

PURPOSE:
- Guide readers to relevant TPKELE products and resources
- Improve site navigation and user experience
- Support SEO internal linking structure

QUANTITY:
- Every article: 3-6 internal links
- DO NOT force product links into every section
- Only link when content naturally mentions the product/topic

DOMAIN:
- ALL internal links MUST use: https://www.tpkele.com/
- NEVER invent TPKELE URLs

LINK TARGETS (in priority order):
1. Corresponding product category pages
2. Corresponding product detail pages
3. Related blog articles
4. Products overview page
5. Contact page

url_hint RULES:
- In the JSON output, use "url_hint" to describe what type of TPKELE page should be linked
- Examples:
  • "DC MCB product page"
  • "AC circuit breaker category"
  • "surge protection devices overview"
  • "ATS automatic transfer switch products"
  • "voltage protector selection guide"
- DO NOT invent specific URLs - the backend system will match url_hint to real pages

ANCHOR TEXT:
✓ Natural anchors: "DC circuit breakers", "automatic transfer switches", "surge protection devices", "TPKELE DC MCB"
✗ Avoid repetition: Don't use the exact same keyword repeatedly
✗ One page per article: Link to the same page only once per article

COMMERCIAL BALANCE:
- Technical articles should solve reader problems FIRST, not push products
- DO NOT insert TPKELE products into every section
- When the article naturally discusses a solution, THEN add a product link
- Example: "For photovoltaic DC protection applications, TPKELE offers DC circuit breakers designed for PV distribution systems." → Then link to TPKELE DC MCB page

┌─────────────────────────────────────────────────────────────────┐
│ PART 3: CALL-TO-ACTION (CTA) AT ARTICLE END                    │
└─────────────────────────────────────────────────────────────────┘

Every article MUST end with ONE brief, natural commercial CTA.

CTA should:
✓ Be professional and helpful (not pushy)
✓ Invite readers to contact TPKELE for product selection support
✓ Mention specific application context from the article

CTA MUST NOT:
✗ Use over-marketing language: "We are the best manufacturer in China", "Buy now", "No.1 supplier"
✗ Make unverifiable claims unless backed by evidence

TEMPLATE SELECTION:
Choose ONE of these 10 CTA templates based on article topic. The CTA should be the LAST paragraph of your article content.

[CTA_TEMPLATE_1: DC Circuit Breaker Selection]
"Need help selecting a DC circuit breaker for your PV system? Contact TPKELE with your system voltage, current rating, and application requirements for product recommendation support."

[CTA_TEMPLATE_2: AC Circuit Breaker Selection]
"Selecting the right AC circuit breaker for your installation? TPKELE offers AC MCB solutions from 1P to 4P configurations. Contact us with your voltage, current, and breaking capacity requirements for technical support."

[CTA_TEMPLATE_3: Surge Protection Devices]
"Looking for surge protection for your installation? TPKELE provides AC and DC SPD solutions designed for various protection levels. Share your system specifications for product selection guidance."

[CTA_TEMPLATE_4: Automatic Transfer Switch]
"Need an ATS for your backup power system? TPKELE offers automatic transfer switches for various load capacities. Contact us with your power requirements and switching time specifications for recommendations."

[CTA_TEMPLATE_5: Voltage Protection]
"Protecting your equipment from voltage fluctuations? TPKELE voltage protectors provide over/under voltage protection for sensitive loads. Get in touch with your voltage range and load requirements for product guidance."

[CTA_TEMPLATE_6: PV System Components]
"Designing a photovoltaic system? TPKELE offers complete DC protection solutions including DC MCB, DC SPD, PV combiner boxes, and DC isolators. Contact us with your system specifications for component selection support."

[CTA_TEMPLATE_7: Energy Monitoring]
"Need energy monitoring for your installation? TPKELE DIN rail energy meters provide accurate kWh measurement with communication options. Share your monitoring requirements for product recommendations."

[CTA_TEMPLATE_8: Standards Compliance]
"Ensuring your installation meets IEC/UL standards? TPKELE products are designed to comply with international electrical safety standards. Contact us to discuss your certification requirements and application specifications."

[CTA_TEMPLATE_9: System Design Support]
"Planning your electrical protection system? TPKELE provides technical support for product selection and system design. Get in touch with your project specifications for engineering assistance."

[CTA_TEMPLATE_10: General Product Inquiry]
"Have questions about electrical protection products for your application? TPKELE offers a comprehensive range of circuit breakers, surge protectors, and distribution components. Contact us to discuss your requirements."

USAGE:
- Select the CTA template that best matches your article topic
- Place it as the final paragraph of your content
- DO NOT modify the template significantly - use as written
- The CTA should flow naturally from your closing knowledge paragraph

┌─────────────────────────────────────────────────────────────────┐
│ PART 4: LINK VERIFICATION CHECKLIST (Before Output)            │
└─────────────────────────────────────────────────────────────────┘

Before finalizing your article, verify:

External Links:
☑ All external link domains match cited content
☑ No invented or guessed URLs
☑ No obvious 404 pages
☑ No meaningless external links
☑ External links are from trusted sources only
☑ Same domain appears maximum 1-2 times
☑ Anchor text is semantic and natural

Internal Links:
☑ 3-6 internal links included
☑ No invented TPKELE URLs
☑ url_hint describes real page types
☑ Same page linked only once
☑ Links placed naturally, not forced

CTA:
☑ ONE CTA template selected based on article topic
☑ CTA is the final paragraph
☑ Professional tone (not over-salesy)

═══════════════════════════════════════════════════════════════════
CRITICAL REMINDER: NEVER INVENT URLs
If you cannot verify a source exists, omit the external link.
It is better to have 2 real links than 5 fake links.
═══════════════════════════════════════════════════════════════════
`;

// AI 输出 JSON 格式 —— DeepSeek/GPT 已强制 response_format json，但仍写在 prompt 里双保险
const JSON_OUTPUT_BLOCK = `
OUTPUT FORMAT — return ONE single valid JSON object. No markdown fences, no preamble, no trailing prose.

{
  "title": "string — 30-70 chars. MUST include the main keyword. For long keywords (4+ words), include at least the first 2-3 core words. Example: for 'iec 60898 circuit breaker standards' use 'IEC 60898 Circuit Breaker Standards Guide'",
  "content": "string — Markdown body. Structure: intro paragraph → ## H2 sections → paragraphs/bullets → knowledge-focused closing paragraph → ONE CTA paragraph (select from templates above). NO H1. NO image markdown (![](...)). NO HTML tags. NO URLs written directly in text.",
  "meta_title": "string — 30-60 chars, MUST contain main keyword, click-worthy",
  "meta_description": "string — 120-155 chars (leave 5-char buffer for safety), MUST contain main keyword, value proposition",
  "main_keyword": "string — same as the input keyword",
  "sub_keywords": ["string", "string", "string", "string"],
  "faq": [
    {"question": "string", "answer": "string — 2-4 sentences"}
  ],
  "internal_link_suggestions": [
    {
      "anchor": "string — exact 2-5 word phrase that appears in your article body (e.g. 'DC circuit breakers')",
      "url_hint": "string — describe the TPKELE page type: 'DC MCB product page' or 'AC circuit breaker category' or 'surge protection overview'",
      "reason": "string — 1 sentence explaining why this link helps the reader"
    }
  ],
  "external_link_suggestions": [
    {
      "anchor": "string — exact phrase from article (e.g. 'IEC 60898', 'NFPA 70E')",
      "url": "string — ONLY use verified stable URLs from trusted sources (IEC.ch, IEEE.org, NFPA.org, NEMA.org, UL.com, Energy.gov, NREL.gov, Wikipedia). NEVER invent URLs.",
      "reason": "string — 1 sentence explaining what this source provides"
    }
  ],
  "cta_template_used": "number — which CTA template you selected (1-10)"
}

CRITICAL RULES FOR ALL ARTICLE TYPES:

1. KEYWORD OPTIMIZATION:
   - SHORT keywords (1-2 words): use 4-6 times naturally in body
   - LONG keywords (3+ words): use FULL phrase 2-3 times + core words 3-5 times
   - FIRST mention MUST be in opening paragraph (within first 100 words)
   - MUST appear in: title, first paragraph, at least one H2, meta_title, meta_description

2. STANDARDS & SPECIFICATIONS:
   - NEVER invent product specs, certifications, or test data
   - ONLY reference real IEC standards: IEC 60898, IEC 60947-2, IEC 61643, IEC 60364, IEC 62109, IEEE C62.41, NFPA 70, UL 489, etc.
   - DO NOT write full URLs in article body - links are inserted via suggestions

3. INTERNAL LINKS (3-6 per article):
   - anchor: exact phrase from your article body (2-5 words)
   - url_hint: describe page type, DO NOT invent specific URLs
   - Same page: link only ONCE per article
   - Natural placement: only when content naturally mentions the product/topic
   - DO NOT force product links into every section

4. EXTERNAL LINKS (2-4 for 1000-1500 words; 3-5 for 1500+ words):
   - ONLY use trusted sources: IEC.ch, IEEE.org, ISO.org, NFPA.org, NEMA.org, UL.com, Energy.gov, NREL.gov, OSHA.gov, Wikipedia
   - NEVER invent URLs - if unsure, omit the link
   - anchor: semantic phrases (e.g. "IEC 60898 standard"), NEVER "click here" or "read more"
   - Same domain: maximum 1-2 times per article
   - QUALITY over quantity

5. VOICE & TONE:
   - Avoid first-person plural ("we", "our company", "we offer", "contact us") in body paragraphs
   - Keep body content informational and knowledge-focused
   - Professional technical tone, not salesy or hype-laden

6. ARTICLE ENDING:
   - Second-to-last paragraph: knowledge-focused closing (1-3 sentences)
     Example: "These selection principles ensure reliable protection across most installations."
   - LAST paragraph: ONE CTA selected from the 10 templates above
   - DO NOT write "contact us for a quote" or generic sales language - use the templates

7. CONTENT UNIQUENESS:
   - If this keyword was covered before, approach from a DIFFERENT ANGLE
   - Vary H2 structure, examples, application scenarios, technical details
   - Reference different standards or technical aspects
   - Ensure unique value for each article

8. LINK VERIFICATION (before output):
   ☑ No invented URLs
   ☑ External links from trusted sources only
   ☑ 3-6 internal links with valid url_hint
   ☑ Semantic anchor text (no "click here")
   ☑ ONE CTA template selected and placed as final paragraph
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
  LINK_RULES_BLOCK,
  JSON_OUTPUT_BLOCK,
  buildKeywordBlock,
};
