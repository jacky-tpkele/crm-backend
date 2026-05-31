// 文件位置：d:/新CRM/api/blog/prompts/index.js
// 导出按 article_type 分发的 Prompt 选择器

const { buildProductPrompt } = require('./product');
const { buildBuyingPrompt } = require('./buying');
const { buildComparisonPrompt } = require('./comparison');
const { buildApplicationPrompt } = require('./application');
const { buildFaqPrompt } = require('./faq');

function buildPromptByType(articleType, opts) {
  switch (articleType) {
    case 'product': return buildProductPrompt(opts);
    case 'buying': return buildBuyingPrompt(opts);
    case 'comparison': return buildComparisonPrompt(opts);
    case 'application': return buildApplicationPrompt(opts);
    case 'faq': return buildFaqPrompt(opts);
    default: return buildProductPrompt(opts); // 兜底
  }
}

const VALID_TYPES = ['product', 'buying', 'comparison', 'application', 'faq'];

module.exports = { buildPromptByType, VALID_TYPES };
