// =============================================
// BLOG 自动化 - 后端 API（支持多模型）
// =============================================

// 文件位置：d:/新CRM/api/blog/index.js

const express = require('express');
const fetch = require('node-fetch');
const cloudinary = require('cloudinary').v2;
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { buildPromptByType, VALID_TYPES } = require('./prompts');

const router = express.Router();

// ──────────────────────────────────────────
// 环境变量配置
// ──────────────────────────────────────────

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cloudinary 配置
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// AI 模型配置
const AI_MODELS = {
  deepseek: {
    name: 'DeepSeek',
    apiKey: process.env.DEEPSEEK_API_KEY,
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
  },
  claude: {
    name: 'Claude',
    apiKey: process.env.CLAUDE_API_KEY,
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-5-sonnet-20241022',
  },
  gpt: {
    name: 'GPT-4',
    apiKey: process.env.OPENAI_API_KEY,
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4-turbo',
  },
  gemini: {
    name: 'Gemini',
    apiKey: process.env.GEMINI_API_KEY,
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
    model: 'gemini-pro',
  },
};

// 图片压缩配置
const IMAGE_CONFIG = {
  maxWidth: parseInt(process.env.IMAGE_MAX_WIDTH || '1200'),
  maxHeight: parseInt(process.env.IMAGE_MAX_HEIGHT || '800'),
  quality: parseInt(process.env.IMAGE_COMPRESSION_QUALITY || '85'),
  maxSize: parseInt(process.env.IMAGE_MAX_SIZE || '200000'),
};

// ──────────────────────────────────────────
// Supabase 辅助函数
// ──────────────────────────────────────────

async function sb(path, opts = {}) {
  const url = `${SB_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_SERVICE_KEY}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(data?.message || data?.error || JSON.stringify(data));
  return data;
}

// 鈹€鈹€ 安全解析 AI 返回的 JSON（处理 markdown 代码块包裹、额外文本等异常情形） 鈹€鈹€
function parseAIJson(content) {
  if (!content) throw new Error('Empty AI response');
  let text = String(content).trim();
  // 剥除 ```json ... ``` 包裹
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch (e1) {
    // 提取第一个完整的 {...} 块（处理嵌套）
    const candidate = extractBalancedJson(text);
    if (!candidate) {
      const preview = text.slice(0, 200).replace(/\s+/g, ' ');
      throw new Error(`Failed to parse AI JSON response. Preview: "${preview}..."`);
    }
    try {
      return JSON.parse(candidate);
    } catch (e2) {
      const preview = candidate.slice(0, 200).replace(/\s+/g, ' ');
      throw new Error(`AI JSON malformed: ${e2.message}. Preview: "${preview}..."`);
    }
  }
}

// 提取第一个嵌套层级匹配的 {...} 子串（应付 AI 在 JSON 前后插入说明文字）
function extractBalancedJson(text) {
  const start = text.indexOf('{');
  if (start < 0) {
    const arrStart = text.indexOf('[');
    if (arrStart < 0) return null;
    return extractBalanced(text, arrStart, '[', ']');
  }
  return extractBalanced(text, start, '{', '}');
}

function extractBalanced(text, start, open, close) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// ──────────────────────────────────────────
// AI 模型适配器
// ──────────────────────────────────────────

async function generateContentWithAI(keyword, title, modelType = 'claude') {
  const model = AI_MODELS[modelType];
  if (!model || !model.apiKey) {
    throw new Error(`Model ${modelType} not configured or API key missing`);
  }

  const prompt = `
You are a professional B2B SEO blog writer for an electrical products manufacturer (TPKele).
Write a high-quality English blog article on the topic below.

Target keyword: ${keyword}
Article title: ${title}

Requirements:
1. Length: 800-1200 words
2. Format: clean Markdown
3. Structure: 2-3 main sections with H2 headings
4. Each section: 2-3 paragraphs
5. Include bullet lists where helpful
6. End with a short conclusion
7. SEO-friendly: naturally use the target keyword 3-5 times
8. Tone: professional, technical, helpful for procurement managers
9. No images, no HTML tags

Return ONLY the Markdown article. Do not add any preamble or explanation.
  `;

  if (modelType === 'claude') {
    return await generateWithClaude(prompt, model);
  } else if (modelType === 'gpt') {
    return await generateWithGPT(prompt, model);
  } else if (modelType === 'gemini') {
    return await generateWithGemini(prompt, model);
  } else if (modelType === 'deepseek') {
    return await generateWithDeepSeek(prompt, model);
  } else {
    throw new Error(`Unsupported model type: ${modelType}`);
  }
}

async function generateWithDeepSeek(prompt, model) {
  const response = await fetch(model.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${model.apiKey}`,
    },
    body: JSON.stringify({
      model: model.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 6000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let msg = text;
    try { msg = JSON.parse(text)?.error?.message || text; } catch {}
    throw new Error(`DeepSeek API error: ${msg}`);
  }

  const data = await response.json();
  if (!data.choices || !data.choices[0]) {
    throw new Error(`DeepSeek invalid response: ${JSON.stringify(data)}`);
  }
  return data.choices[0].message.content;
}

async function generateWithClaude(prompt, model) {
  const response = await fetch(model.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': model.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model.model,
      max_tokens: 6000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Claude API error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function generateWithGPT(prompt, model) {
  const response = await fetch(model.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${model.apiKey}`,
    },
    body: JSON.stringify({
      model: model.model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 6000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`GPT API error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function generateWithGemini(prompt, model) {
  const response = await fetch(`${model.endpoint}?key=${model.apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Gemini API error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

// ──────────────────────────────────────────
// 结构化生成：调用对应 article_type 的 Prompt，返回 JSON 对象
// 包含 content + meta_title + meta_description + faq + 内/外链建议等
// ──────────────────────────────────────────
async function generateStructuredArticle({ keyword, title, articleType, subKeywords, modelType }) {
  if (!VALID_TYPES.includes(articleType)) articleType = 'product';
  const model = AI_MODELS[modelType];
  if (!model || !model.apiKey) {
    throw new Error(`Model ${modelType} not configured or API key missing`);
  }

  const prompt = buildPromptByType(articleType, { keyword, title, subKeywords });

  let raw;
  if (modelType === 'claude') raw = await generateWithClaude(prompt, model);
  else if (modelType === 'gpt') raw = await generateWithGPT(prompt, model);
  else if (modelType === 'gemini') raw = await generateWithGemini(prompt, model);
  else if (modelType === 'deepseek') raw = await generateWithDeepSeek(prompt, model);
  else throw new Error(`Unsupported model type: ${modelType}`);

  const parsed = parseAIJson(raw);

  // 校验关键字段
  if (!parsed.title || typeof parsed.title !== 'string') {
    throw new Error('AI response missing title');
  }
  if (!parsed.content || typeof parsed.content !== 'string') {
    throw new Error('AI response missing content');
  }

  // 标准化输出（防 AI 漏字段）
  return {
    title: parsed.title.trim(),
    content: parsed.content.trim(),
    meta_title: (parsed.meta_title || '').trim(),
    meta_description: (parsed.meta_description || '').trim(),
    main_keyword: (parsed.main_keyword || keyword || '').trim(),
    sub_keywords: Array.isArray(parsed.sub_keywords) ? parsed.sub_keywords.filter(s => typeof s === 'string') : [],
    faq: Array.isArray(parsed.faq) ? parsed.faq.filter(f => f && f.question && f.answer).map(f => ({
      question: String(f.question).trim(),
      answer: String(f.answer).trim(),
    })) : [],
    internal_link_suggestions: Array.isArray(parsed.internal_link_suggestions) ? parsed.internal_link_suggestions : [],
    external_link_suggestions: Array.isArray(parsed.external_link_suggestions) ? parsed.external_link_suggestions : [],
  };
}

// ──────────────────────────────────────────
// 把 structured 结果转成 blog_posts 行（不含 plan_id / status，由调用方填）
// ──────────────────────────────────────────
function structuredToPostRow(structured, { keyword, articleType }) {
  const wc = (structured.content || '').split(/\s+/).filter(Boolean).length;
  return {
    title: structured.title,
    content: structured.content,
    keywords: [keyword],
    main_keyword: structured.main_keyword || keyword,
    sub_keywords: structured.sub_keywords || [],
    meta_title: structured.meta_title || '',
    meta_description: structured.meta_description || '',
    article_type: articleType || null,
    faq: structured.faq || [],
    // AI 给的链接建议先存到 internal_links / external_links 字段
    // 操作员审核时可以采纳/修改/删除
    internal_links: (structured.internal_link_suggestions || []).map(l => ({
      title: l.anchor || '',
      url: l.url_hint || '',
      reason: l.reason || '',
      ai_suggestion: true,
    })),
    external_links: (structured.external_link_suggestions || []).map(l => ({
      title: l.anchor || '',
      url: l.url || '',
      reason: l.reason || '',
      ai_suggestion: true,
    })),
    word_count: wc,
    reading_time: Math.max(1, Math.ceil(wc / 200)),
  };
}

// ──────────────────────────────────────────
// 图片处理函数
// ──────────────────────────────────────────

async function compressImage(imageBase64) {
  // 移除 data:image/... 前缀
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  // 使用 sharp 压缩
  const compressed = await sharp(buffer)
    .resize(IMAGE_CONFIG.maxWidth, IMAGE_CONFIG.maxHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: IMAGE_CONFIG.quality })
    .toBuffer();

  return compressed;
}

async function uploadToCloudinary(imageBuffer, fileName) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'blog-images',
        resource_type: 'auto',
        public_id: `blog-${Date.now()}-${uuidv4().slice(0, 8)}`,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    uploadStream.end(imageBuffer);
  });
}

// ──────────────────────────────────────────
// API 路由
// ──────────────────────────────────────────

// 1b. 生成 30 天规划（升级版，支持类型比例和每天篇数）
router.post('/generate-plan-v2', async (req, res) => {
  try {
    const {
      month,
      dailyCount = 4,
      typeRatio = { product: 40, comparison: 25, application: 20, buying: 10, faq: 5 },
      titleTemplate = 'auto',
      customTitles = [],
    } = req.body;

    if (!month) return res.status(400).json({ error: 'month is required' });

    const allKeywords = await sb('blog_keywords?select=*&order=priority.asc,used_count.asc');
    if (!allKeywords || allKeywords.length === 0) {
      return res.status(400).json({ error: '关键词库为空，请先添加关键词' });
    }

    const keywordsByCategory = {
      product: allKeywords.filter(k => k.category === 'product'),
      comparison: allKeywords.filter(k => k.category === 'comparison'),
      application: allKeywords.filter(k => k.category === 'application'),
      buying: allKeywords.filter(k => k.category === 'buying'),
      faq: allKeywords.filter(k => k.category === 'faq'),
    };

    // 没有任何分类匹配时，把全部关键词视为 product 兜底
    const hasAnyCategorized = Object.values(keywordsByCategory).some(arr => arr.length > 0);
    if (!hasAnyCategorized) {
      keywordsByCategory.product = allKeywords;
    }

    const [yy, mm] = month.split('-').map(n => parseInt(n, 10));
    const daysInMonth = new Date(yy, mm, 0).getDate();
    const totalPosts = daysInMonth * dailyCount;

    const typeDistribution = {};
    let remaining = totalPosts;
    const types = Object.keys(typeRatio);

    types.forEach((type, idx) => {
      if (idx === types.length - 1) {
        typeDistribution[type] = remaining;
      } else {
        typeDistribution[type] = Math.round(totalPosts * typeRatio[type] / 100);
        remaining -= typeDistribution[type];
      }
    });

    const typeQueues = {};
    for (const type of types) {
      let kwList = keywordsByCategory[type] || [];
      // 该类型下没有关键词时，从全库借用，避免插入 NULL
      if (kwList.length === 0) kwList = allKeywords;
      typeQueues[type] = [];
      for (let i = 0; i < typeDistribution[type]; i++) {
        typeQueues[type].push(kwList[i % kwList.length]);
      }
    }

    const allTypedPosts = [];
    for (const type of types) {
      for (const kw of typeQueues[type]) {
        allTypedPosts.push({ type, keyword: kw });
      }
    }

    for (let i = allTypedPosts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allTypedPosts[i], allTypedPosts[j]] = [allTypedPosts[j], allTypedPosts[i]];
    }

    const titleTemplates = {
      product: ['What Is {keyword}?', 'Complete Guide to {keyword}', '{keyword}: Everything You Need to Know'],
      comparison: ['{keyword}: Key Differences Explained', 'Comparing {keyword}: Which Is Better?'],
      application: ['How to Use {keyword} in Your Project', '{keyword} for Solar Systems'],
      buying: ['How to Choose the Right {keyword}', 'Best {keyword} for Your Needs'],
      faq: ['10 Common Questions About {keyword}', '{keyword} FAQ: Expert Answers'],
    };

    const plans = [];
    let orderNum = 1;
    for (let i = 0; i < allTypedPosts.length; i++) {
      const { type, keyword } = allTypedPosts[i];
      const kw = keyword ? keyword.keyword : 'electrical protection';

      let title;
      if (titleTemplate === 'auto') {
        const templates = titleTemplates[type] || titleTemplates.product;
        const tmpl = templates[i % templates.length];
        title = tmpl.replace('{keyword}', kw);
      } else if (customTitles.length > 0) {
        title = customTitles[i % customTitles.length].replace('{keyword}', kw);
      } else {
        title = `${kw} Guide`;
      }

      plans.push({
        plan_month: month,
        plan_order: orderNum++,
        keyword: kw,
        title,
        article_type: type,
        daily_count: dailyCount,
        status: 'pending',
      });
    }

    const result = await sb('blog_plans', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(plans),
    });

    res.json({
      success: true,
      planMonth: month,
      totalPlans: plans.length,
      dailyCount,
      typeDistribution,
      plans: result,
    });
  } catch (error) {
    console.error('Error generating plan v2:', error);
    res.status(500).json({ error: error.message });
  }
});

// 1. 生成 30 天规划
router.post('/generate-plan', async (req, res) => {
  try {
    const { month, keywords, titles } = req.body;

    if (!month || !keywords || keywords.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const plans = [];
    for (let i = 0; i < 120; i++) {
      const keyword = keywords[i % keywords.length];
      const title = titles ? titles[i % titles.length] : `${keyword} - Part ${i + 1}`;

      plans.push({
        plan_month: month,
        plan_order: i + 1,
        keyword,
        title,
        status: 'pending',
      });
    }

    // 批量插入
    const result = await sb('blog_plans', {
      method: 'POST',
      body: JSON.stringify(plans),
    });

    res.json({
      success: true,
      planMonth: month,
      totalPlans: 120,
      plans: result,
    });
  } catch (error) {
    console.error('Error generating plan:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. 生成文案（支持多模型）
router.post('/generate-content', async (req, res) => {
  try {
    const { planId, keyword, title, model = 'claude' } = req.body;

    if (!planId || !keyword || !title) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 生成文案
    const content = await generateContentWithAI(keyword, title, model);

    // 创建 blog_post
    const post = {
      plan_id: planId,
      title,
      content,
      keywords: [keyword],
      status: 'draft',
    };

    const result = await sb('blog_posts', {
      method: 'POST',
      body: JSON.stringify(post),
    });

    res.json({
      success: true,
      postId: result[0].id,
      title,
      content,
      keywords: [keyword],
      model,
      recommendedImageSize: {
        width: 1200,
        height: 540,
        ratio: '16:9',
      },
    });
  } catch (error) {
    console.error('Error generating content:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. 编辑文案
router.put('/edit-content', async (req, res) => {
  try {
    const { postId, title, content, keywords } = req.body;

    if (!postId) {
      return res.status(400).json({ error: 'Missing postId' });
    }

    const updates = {
      title: title || undefined,
      content: content || undefined,
      keywords: keywords || undefined,
      updated_at: new Date().toISOString(),
    };

    // 移除 undefined 值
    Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);

    const result = await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });

    res.json({
      success: true,
      postId,
      ...updates,
    });
  } catch (error) {
    console.error('Error editing content:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. 上传 + 压缩图片
router.post('/upload-image', async (req, res) => {
  try {
    const { postId, imageBase64, fileName } = req.body;

    if (!postId || !imageBase64) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 获取原始大小
    const originalSize = Buffer.byteLength(imageBase64, 'base64');

    // 压缩图片
    const compressedBuffer = await compressImage(imageBase64);
    const compressedSize = compressedBuffer.length;

    // 上传到 Cloudinary
    const cloudinaryResult = await uploadToCloudinary(compressedBuffer, fileName);

    // 更新 blog_post
    const updates = {
      image_url: cloudinaryResult.secure_url,
      image_cloudinary_id: cloudinaryResult.public_id,
      image_original_size: originalSize,
      image_compressed_size: compressedSize,
      image_width: cloudinaryResult.width,
      image_height: cloudinaryResult.height,
      updated_at: new Date().toISOString(),
    };

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });

    const compressionRate = ((1 - compressedSize / originalSize) * 100).toFixed(1);

    res.json({
      success: true,
      imageUrl: cloudinaryResult.secure_url,
      cloudinaryId: cloudinaryResult.public_id,
      originalSize,
      compressedSize,
      compressionRate: `${compressionRate}%`,
      width: cloudinaryResult.width,
      height: cloudinaryResult.height,
      format: 'webp',
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. 预览文章
router.get('/preview/:postId', async (req, res) => {
  try {
    const { postId } = req.params;

    const result = await sb(`blog_posts?id=eq.${postId}`);

    if (!result || result.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = result[0];

    res.json({
      success: true,
      postId: post.id,
      title: post.title,
      content: post.content,
      keywords: post.keywords,
      imageUrl: post.image_url,
      imageSize: {
        width: post.image_width,
        height: post.image_height,
      },
      status: post.status,
    });
  } catch (error) {
    console.error('Error previewing post:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. 发布文章
router.post('/publish', async (req, res) => {
  try {
    const { postId } = req.body;

    if (!postId) {
      return res.status(400).json({ error: 'Missing postId' });
    }

    // 生成 slug
    const post = await sb(`blog_posts?id=eq.${postId}`);
    if (!post || post.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const slug = post[0].title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');

    const updates = {
      slug,
      status: 'published',
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });

    // 更新 blog_plans 状态
    const planId = post[0].plan_id;
    if (planId) {
      await sb(`blog_plans?id=eq.${planId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'published' }),
      });
    }

    res.json({
      success: true,
      slug,
      publishedAt: updates.published_at,
      url: `https://www.tpkele.com/blog/${slug}`,
    });
  } catch (error) {
    console.error('Error publishing post:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. 定时任务（每天凌晨 8 点）
router.get('/cron', async (req, res) => {
  try {
    const { token } = req.query;

    // 验证 CRON 密钥
    if (token !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 查询当天 4 篇 pending 的计划
    const today = new Date().toISOString().split('T')[0];
    const plans = await sb(
      `blog_plans?status=eq.pending&plan_month=eq.${today.slice(0, 7)}&limit=4`
    );

    const results = [];

    for (const plan of plans) {
      try {
        const articleType = plan.article_type || 'product';
        const structured = await generateStructuredArticle({
          keyword: plan.keyword,
          title: plan.title,
          articleType,
          modelType: 'deepseek',
        });

        const postRow = structuredToPostRow(structured, { keyword: plan.keyword, articleType });
        const post = {
          ...postRow,
          plan_id: plan.id,
          status: 'pending_review',
        };

        const postResult = await sb('blog_posts', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify(post),
        });

        // 更新 blog_plans 状态
        await sb(`blog_plans?id=eq.${plan.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'content_generated' }),
        });

        results.push({
          planId: plan.id,
          postId: postResult[0]?.id,
          title: structured.title,
          status: 'success',
        });
      } catch (error) {
        results.push({
          planId: plan.id,
          title: plan.title,
          status: 'error',
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      generatedCount: results.filter(r => r.status === 'success').length,
      results,
    });
  } catch (error) {
    console.error('Error in cron job:', error);
    res.status(500).json({ error: error.message });
  }
});

// 8. 获取可用模型列表
router.get('/models', (req, res) => {
  const availableModels = Object.entries(AI_MODELS)
    .filter(([key, model]) => model.apiKey)
    .map(([key, model]) => ({
      id: key,
      name: model.name,
      model: model.model,
    }));

  res.json({
    success: true,
    models: availableModels,
  });
});

// ──────────────────────────────────────────
// Phase 3: SEO 优化 + 链接管理 + FAQ
// ──────────────────────────────────────────

// 9. 生成 SEO 元数据
router.post('/generate-seo', async (req, res) => {
  try {
    const { postId, modelType = 'deepseek' } = req.body;

    if (!postId) {
      return res.status(400).json({ error: 'Missing postId' });
    }

    // 获取文章
    const posts = await sb(`blog_posts?id=eq.${postId}`);
    if (!posts || posts.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = posts[0];
    const model = AI_MODELS[modelType];
    if (!model || !model.apiKey) {
      return res.status(400).json({ error: `Model ${modelType} not configured` });
    }

    // 生成 SEO 元数据
    const seoPrompt = `You are an SEO expert. Generate SEO metadata for the article below.

Article title: ${post.title}
Article excerpt: ${post.content.substring(0, 500)}

Return ONLY valid JSON (no markdown, no code fences):
{
  "meta_title": "SEO-optimized title (50-60 chars)",
  "meta_description": "SEO-optimized description (150-160 chars)",
  "main_keyword": "primary keyword",
  "sub_keywords": ["secondary 1", "secondary 2", "secondary 3"]
}`;

    let seoData;
    if (modelType === 'deepseek' || modelType === 'gpt') {
      const response = await fetch(model.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify({
          model: model.model,
          messages: [{ role: 'user', content: seoPrompt }],
          temperature: 0.7,
        }),
      });
      const result = await response.json();
      if (!result.choices || !result.choices[0]) {
        throw new Error(`API error: ${JSON.stringify(result)}`);
      }
      seoData = parseAIJson(result.choices[0].message.content);
    } else if (modelType === 'claude') {
      const response = await fetch(model.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': model.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model.model,
          max_tokens: 500,
          messages: [{ role: 'user', content: seoPrompt }],
        }),
      });
      const result = await response.json();
      const content = result.content[0].text;
      seoData = parseAIJson(content);
    }

    // 计算字数和阅读时间
    const wordCount = post.content.split(/\s+/).length;
    const readingTime = Math.ceil(wordCount / 200); // 假设每分钟 200 字

    // 更新数据库
    const updates = {
      meta_title: seoData.meta_title,
      meta_description: seoData.meta_description,
      main_keyword: seoData.main_keyword,
      sub_keywords: seoData.sub_keywords,
      word_count: wordCount,
      reading_time: readingTime,
      updated_at: new Date().toISOString(),
    };

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });

    res.json({
      success: true,
      postId,
      seoData: {
        ...seoData,
        wordCount,
        readingTime,
      },
    });
  } catch (error) {
    console.error('Error generating SEO:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10. 生成内部/外部链接推荐
router.post('/generate-links', async (req, res) => {
  try {
    const { postId, modelType = 'deepseek' } = req.body;

    if (!postId) {
      return res.status(400).json({ error: 'Missing postId' });
    }

    // 获取文章
    const posts = await sb(`blog_posts?id=eq.${postId}`);
    if (!posts || posts.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = posts[0];
    const model = AI_MODELS[modelType];
    if (!model || !model.apiKey) {
      return res.status(400).json({ error: `Model ${modelType} not configured` });
    }

    // 获取所有已发布的文章用于内部链接推荐
    const publishedPosts = await sb('blog_posts?status=eq.published&select=id,title,main_keyword');

    const linksPrompt = `You are a content strategist. Recommend internal and external links for the article below.

Article title: ${post.title}
Main keyword: ${post.main_keyword}
Article excerpt: ${post.content.substring(0, 500)}

Already published articles available for internal linking:
${publishedPosts.map(p => `- ${p.title} (keyword: ${p.main_keyword})`).join('\n')}

Return ONLY valid JSON (no markdown, no code fences):
{
  "internal_links": [
    {"title": "related article title", "url": "/blog/slug", "reason": "why link"}
  ],
  "external_links": [
    {"title": "external resource title", "url": "https://example.com", "reason": "why link"}
  ]
}

Recommend at most 3 internal and 3 external links.`;

    let linksData;
    if (modelType === 'deepseek' || modelType === 'gpt') {
      const response = await fetch(model.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify({
          model: model.model,
          messages: [{ role: 'user', content: linksPrompt }],
          temperature: 0.7,
        }),
      });
      const result = await response.json();
      if (!result.choices || !result.choices[0]) {
        throw new Error(`API error: ${JSON.stringify(result)}`);
      }
      linksData = parseAIJson(result.choices[0].message.content);
    } else if (modelType === 'claude') {
      const response = await fetch(model.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': model.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model.model,
          max_tokens: 800,
          messages: [{ role: 'user', content: linksPrompt }],
        }),
      });
      const result = await response.json();
      const content = result.content[0].text;
      linksData = parseAIJson(content);
    }

    // 更新数据库
    const updates = {
      internal_links: linksData.internal_links || [],
      external_links: linksData.external_links || [],
      updated_at: new Date().toISOString(),
    };

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });

    res.json({
      success: true,
      postId,
      linksData,
    });
  } catch (error) {
    console.error('Error generating links:', error);
    res.status(500).json({ error: error.message });
  }
});

// 11. 生成 FAQ
router.post('/generate-faq', async (req, res) => {
  try {
    const { postId, modelType = 'deepseek' } = req.body;

    if (!postId) {
      return res.status(400).json({ error: 'Missing postId' });
    }

    // 获取文章
    const posts = await sb(`blog_posts?id=eq.${postId}`);
    if (!posts || posts.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = posts[0];
    const model = AI_MODELS[modelType];
    if (!model || !model.apiKey) {
      return res.status(400).json({ error: `Model ${modelType} not configured` });
    }

    // 生成 FAQ
    const faqPrompt = `You are a content editor. Generate 5-7 frequently asked questions and answers based on the article below.

Article title: ${post.title}
Article content: ${post.content}

Return ONLY valid JSON (no markdown, no code fences):
{
  "faq": [
    {"question": "Question 1?", "answer": "Answer 1"},
    {"question": "Question 2?", "answer": "Answer 2"}
  ]
}

Keep questions and answers concise and suitable for a public webpage.`;

    let faqData;
    if (modelType === 'deepseek' || modelType === 'gpt') {
      const response = await fetch(model.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify({
          model: model.model,
          messages: [{ role: 'user', content: faqPrompt }],
          temperature: 0.7,
        }),
      });
      const result = await response.json();
      if (!result.choices || !result.choices[0]) {
        throw new Error(`API error: ${JSON.stringify(result)}`);
      }
      faqData = JSON.parse(result.choices[0].message.content);
    } else if (modelType === 'claude') {
      const response = await fetch(model.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': model.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model.model,
          max_tokens: 1000,
          messages: [{ role: 'user', content: faqPrompt }],
        }),
      });
      const result = await response.json();
      const content = result.content[0].text;
      faqData = parseAIJson(content);
    }

    // 更新数据库
    const updates = {
      faq: faqData.faq || [],
      updated_at: new Date().toISOString(),
    };

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });

    res.json({
      success: true,
      postId,
      faqData,
    });
  } catch (error) {
    console.error('Error generating FAQ:', error);
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────
// Phase 4: 仪表盘 + 自动化管理
// ──────────────────────────────────────────

// 1. 获取仪表盘统计数据
router.get('/dashboard', async (req, res) => {
  try {
    const plans = await sb('blog_plans?select=*');
    const posts = await sb('blog_posts?select=*');

    // 文章状态：draft/pending_review = 待审核, approved = 已批准, published = 已发布, generation_failed/failed = 失败
    const todayStats = {
      total: plans.length,
      generated: posts.filter(p => ['draft', 'pending_review', 'approved', 'published'].includes(p.status)).length,
      pending_review: posts.filter(p => ['draft', 'pending_review'].includes(p.status)).length,
      approved: posts.filter(p => p.status === 'approved').length,
      published: posts.filter(p => p.status === 'published').length,
      failed: posts.filter(p => ['failed', 'generation_failed'].includes(p.status)).length,
    };

    // 下次执行时间：明天上午 8:00
    const next = new Date();
    next.setDate(next.getDate() + (next.getHours() >= 8 ? 1 : 0));
    next.setHours(8, 0, 0, 0);
    const hoursUntil = ((next.getTime() - Date.now()) / (1000 * 60 * 60)).toFixed(1);

    res.json({
      success: true,
      todayStats,
      nextExecutionTime: next.toISOString(),
      hoursUntilNextExecution: hoursUntil,
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. 立即生成今天的文章
router.post('/generate-now', async (req, res) => {
  try {
    const { modelType = 'deepseek' } = req.body;

    // 先尝试从计划中找
    const today = new Date().toISOString().split('T')[0];
    let plans = await sb(
      `blog_plans?status=eq.pending&plan_month=eq.${today.slice(0, 7)}&select=*&limit=4`
    );

    // 如果没有计划，从关键词库直接生成
    if (!plans || plans.length === 0) {
      const keywords = await sb('blog_keywords?select=*&order=created_at.desc&limit=4');

      if (!keywords || keywords.length === 0) {
        return res.status(400).json({
          error: '没有可用的关键词。请先到"关键词库"添加关键词，或到"生成规划"创建月度计划'
        });
      }

      // 临时计划列表（继承关键词的 category 作为 article_type）
      plans = keywords.map(kw => ({
        id: null,
        keyword: kw.keyword,
        title: null, // 让 Prompt 自己生成标题
        article_type: kw.category && kw.category !== 'general' ? kw.category : 'product',
      }));
    }

    const results = [];

    for (const plan of plans) {
      try {
        const articleType = plan.article_type || 'product';
        const structured = await generateStructuredArticle({
          keyword: plan.keyword,
          title: plan.title,
          articleType,
          modelType,
        });

        const postRow = structuredToPostRow(structured, { keyword: plan.keyword, articleType });
        const post = {
          ...postRow,
          plan_id: plan.id,
          status: 'pending_review',
        };

        const postResult = await sb('blog_posts', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify(post),
        });

        if (plan.id) {
          await sb(`blog_plans?id=eq.${plan.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'content_generated' }),
          });
        }

        // 增加关键词使用计数
        try {
          const kw = await sb(`blog_keywords?keyword=eq.${encodeURIComponent(plan.keyword)}&select=id,used_count`);
          if (kw && kw[0]) {
            await sb(`blog_keywords?id=eq.${kw[0].id}`, {
              method: 'PATCH',
              body: JSON.stringify({
                used_count: (kw[0].used_count || 0) + 1,
                last_used_date: new Date().toISOString().split('T')[0],
              }),
            });
          }
        } catch {}

        results.push({
          planId: plan.id,
          postId: postResult[0]?.id,
          title: structured.title,
          status: 'success',
        });
      } catch (error) {
        results.push({
          planId: plan.id,
          title: plan.title,
          status: 'error',
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      generatedCount: results.filter(r => r.status === 'success').length,
      results,
    });
  } catch (error) {
    console.error('Error in generate-now:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. 重新生成失败的文章
router.post('/retry-failed', async (req, res) => {
  try {
    const { modelType = 'deepseek' } = req.body;

    const failedPosts = await sb('blog_posts?status=eq.failed&select=*');
    const results = [];

    for (const post of failedPosts) {
      try {
        const plan = await sb(`blog_plans?id=eq.${post.plan_id}&select=*`);
        if (!plan || plan.length === 0) continue;

        const content = await generateContentWithAI(
          plan[0].keyword,
          plan[0].title,
          modelType
        );

        await sb(`blog_posts?id=eq.${post.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            content,
            status: 'draft',
            updated_at: new Date().toISOString(),
          }),
        });

        results.push({
          postId: post.id,
          title: post.title,
          status: 'success',
        });
      } catch (error) {
        results.push({
          postId: post.id,
          title: post.title,
          status: 'error',
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      retriedCount: failedPosts.length,
      successCount: results.filter(r => r.status === 'success').length,
      results,
    });
  } catch (error) {
    console.error('Error in retry-failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. 同步已审核的文章到网站
router.post('/sync-approved', async (req, res) => {
  try {
    const approvedPosts = await sb('blog_posts?status=eq.approved&select=*');
    const results = [];

    for (const post of approvedPosts) {
      try {
        const slug = post.title
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');

        await sb(`blog_posts?id=eq.${post.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            slug,
            status: 'published',
            published_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        });

        if (post.plan_id) {
          await sb(`blog_plans?id=eq.${post.plan_id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'published' }),
          });
        }

        results.push({
          postId: post.id,
          title: post.title,
          slug,
          status: 'success',
        });
      } catch (error) {
        results.push({
          postId: post.id,
          title: post.title,
          status: 'error',
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      syncedCount: results.filter(r => r.status === 'success').length,
      results,
    });
  } catch (error) {
    console.error('Error in sync-approved:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. 切换自动生成开关
router.post('/toggle-auto-generation', async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Missing enabled flag' });
    }

    // 简单实现：直接返回成功
    // 实际的配置存储可以在后续扩展
    res.json({
      success: true,
      autoGenerationEnabled: enabled,
      message: enabled ? '已启用自动生成' : '已禁用自动生成',
    });
  } catch (error) {
    console.error('Error toggling auto-generation:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. 获取计划列表
router.get('/plans', async (req, res) => {
  try {
    const { status, limit = 100 } = req.query;
    let query = `blog_plans?select=*&order=created_at.desc&limit=${limit}`;
    if (status) query += `&status=eq.${status}`;

    const plans = await sb(query);

    res.json({
      success: true,
      plans,
    });
  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. 批准文章
router.post('/approve', async (req, res) => {
  try {
    const { postId } = req.body;

    if (!postId) {
      return res.status(400).json({ error: 'Missing postId' });
    }

    // 取出文章看是否已经手填 slug_url，否则从 title 自动生成
    const posts = await sb(`blog_posts?id=eq.${postId}`);
    if (!posts || posts.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const post = posts[0];

    let baseSlug = (post.slug_url || '').trim();
    if (!baseSlug) {
      baseSlug = post.title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 80);
    }

    // 处理 slug 唯一性冲突：同名 slug 已被别的 post 占用时，追加 -2/-3/...
    const slug = await ensureUniqueSlug(baseSlug, postId);

    const now = new Date().toISOString();
    const updates = {
      status: 'published',
      slug,
      slug_url: slug,
      approved_at: now,
      published_at: now,
      updated_at: now,
    };

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });

    // 同步 plan 状态
    if (post.plan_id) {
      try {
        await sb(`blog_plans?id=eq.${post.plan_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'published' }),
        });
      } catch {}
    }

    res.json({
      success: true,
      postId,
      slug,
      status: 'published',
      url: `https://www.tpkele.com/blog/${slug}`,
    });
  } catch (error) {
    console.error('Error approving+publishing post:', error);
    res.status(500).json({ error: error.message });
  }
});

// slug 唯一性兜底：同 baseSlug 已被其他 post 占用时，自动加 -2 / -3 ...
async function ensureUniqueSlug(baseSlug, currentPostId) {
  let candidate = baseSlug;
  let n = 1;
  // 最多查 50 次，防止意外死循环
  for (let i = 0; i < 50; i++) {
    const conflicts = await sb(`blog_posts?slug=eq.${encodeURIComponent(candidate)}&select=id`);
    const others = (conflicts || []).filter(p => p.id !== currentPostId);
    if (others.length === 0) return candidate;
    n += 1;
    candidate = `${baseSlug}-${n}`;
  }
  // 兜底：用时间戳后缀
  return `${baseSlug}-${Date.now()}`;
}

// 8. 拒绝文章
router.post('/reject', async (req, res) => {
  try {
    const { postId, reason } = req.body;

    if (!postId) {
      return res.status(400).json({ error: 'Missing postId' });
    }

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'rejected',
        rejection_reason: reason || '',
        updated_at: new Date().toISOString(),
      }),
    });

    res.json({
      success: true,
      postId,
      status: 'rejected',
    });
  } catch (error) {
    console.error('Error rejecting post:', error);
    res.status(500).json({ error: error.message });
  }
});

// 9. 获取自动化状态
router.get('/status', async (req, res) => {
  try {
    const config = await sb('blog_config?select=*');
    const autoEnabled = config.find(c => c.config_key === 'auto_generation_enabled')?.config_value === 'true' || false;

    res.json({
      success: true,
      autoGenerationEnabled: autoEnabled,
    });
  } catch (error) {
    console.error('Error fetching status:', error);
    res.json({
      success: true,
      autoGenerationEnabled: false,
    });
  }
});

// 10. 切换自动化
router.post('/toggle-auto', async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Missing enabled flag' });
    }

    // 简单实现：直接返回成功
    // 实际的配置存储可以在后续扩展
    res.json({
      success: true,
      autoGenerationEnabled: enabled,
      message: enabled ? '已启用自动生成' : '已禁用自动生成',
    });
  } catch (error) {
    console.error('Error toggling auto:', error);
    res.status(500).json({ error: error.message });
  }
});

// 11. 关键词管理

// 11a. 获取关键词列表
router.get('/keywords', async (req, res) => {
  try {
    const keywords = await sb('blog_keywords?select=*&order=created_at.desc');

    res.json({
      success: true,
      keywords,
    });
  } catch (error) {
    console.error('Error fetching keywords:', error);
    res.status(500).json({ error: error.message });
  }
});

// 11b. 添加关键词
router.post('/keywords', async (req, res) => {
  try {
    const { keyword, category = 'general', difficulty = 'medium' } = req.body;

    if (!keyword) {
      return res.status(400).json({ error: 'Missing keyword' });
    }

    const result = await sb('blog_keywords', {
      method: 'POST',
      body: JSON.stringify({
        keyword,
        category,
        difficulty,
        created_at: new Date().toISOString(),
      }),
    });

    res.json({
      success: true,
      keyword: result[0],
    });
  } catch (error) {
    console.error('Error adding keyword:', error);
    res.status(500).json({ error: error.message });
  }
});

// 11c. AI 推荐关键词
router.get('/keywords/ai-recommend', async (req, res) => {
  try {
    const { seed } = req.query;

    if (!seed) {
      return res.status(400).json({ error: 'Missing seed keyword' });
    }

    const prompt = `You are an SEO keyword research expert for a B2B electrical products manufacturer.
Based on the seed keyword "${seed}", generate 40-50 highly relevant English long-tail keywords.

Focus on: product specifications, technical applications, buying guides, comparisons, and FAQ-style queries.
Target audience: international procurement managers and electrical engineers.

Return ONLY valid JSON in this exact format (no markdown, no code fences, no explanations):
{"keywords": ["keyword 1", "keyword 2", "..."]}`;

    const model = AI_MODELS['deepseek'];
    if (!model || !model.apiKey) {
      return res.status(400).json({ error: 'DeepSeek not configured' });
    }

    const response = await fetch(model.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify({
        model: model.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`DeepSeek API error: ${error.error?.message || JSON.stringify(error)}`);
    }

    const result = await response.json();
    if (!result.choices || !result.choices[0]) {
      throw new Error(`Invalid API response: ${JSON.stringify(result)}`);
    }

    const content = result.choices[0].message.content;
    const parsed = parseAIJson(content);
    const keywords = parsed.keywords || [];

    res.json({
      success: true,
      seed,
      keywords: keywords.slice(0, 50),
    });
  } catch (error) {
    console.error('Error recommending keywords:', error);
    res.status(500).json({ error: error.message });
  }
});

// 11d. 批量添加关键词
router.post('/keywords/batch', async (req, res) => {
  try {
    const { keywords } = req.body;

    if (!Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ error: 'Missing keywords array' });
    }

    const results = [];

    for (const kw of keywords) {
      try {
        const newKeyword = {
          keyword: kw.keyword || kw,
          category: kw.category || 'general',
          difficulty: kw.difficulty || 'medium',
          created_at: new Date().toISOString(),
        };

        const result = await sb('blog_keywords', {
          method: 'POST',
          body: JSON.stringify(newKeyword),
        });

        results.push({
          keyword: kw.keyword || kw,
          status: 'success',
          id: result[0].id,
        });
      } catch (error) {
        results.push({
          keyword: kw.keyword || kw,
          status: 'error',
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      addedCount: results.filter(r => r.status === 'success').length,
      results,
    });
  } catch (error) {
    console.error('Error batch adding keywords:', error);
    res.status(500).json({ error: error.message });
  }
});

// 11e. 删除关键词
router.delete('/keywords/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Missing keyword id' });
    }

    await sb(`blog_keywords?id=eq.${id}`, {
      method: 'DELETE',
    });

    res.json({
      success: true,
      message: 'Keyword deleted',
    });
  } catch (error) {
    console.error('Error deleting keyword:', error);
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────
// 12. 审核工作台 API（v4 - 用 service key 绕 RLS）
// ──────────────────────────────────────────

// 12a. 获取文章详情（完整字段）
router.get('/post/:postId', async (req, res) => {
  try {
    const posts = await sb(`blog_posts?id=eq.${req.params.postId}`);
    if (!posts || posts.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json({ success: true, post: posts[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 12b. 待审核文章列表
router.get('/pending-review', async (req, res) => {
  try {
    const posts = await sb(
      'blog_posts?status=eq.pending_review&select=id,title,keywords,main_keyword,word_count,reading_time,cover_image_url,created_at,updated_at&order=created_at.desc'
    );
    res.json({ success: true, posts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 12c. 更新文章详情
router.put('/post/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const fields = [
      'title', 'content', 'meta_title', 'meta_description', 'slug_url',
      'main_keyword', 'sub_keywords', 'internal_links', 'external_links',
      'faq', 'cover_image_alt', 'article_type',
    ];
    const updates = { updated_at: new Date().toISOString() };
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (req.body.content !== undefined) {
      const wc = req.body.content.split(/\s+/).filter(Boolean).length;
      updates.word_count = wc;
      updates.reading_time = Math.max(1, Math.ceil(wc / 200));
    }

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 12d. 上传封面图（Base64 → 压缩 → Cloudinary）
router.post('/post/:postId/cover-image', async (req, res) => {
  try {
    const { postId } = req.params;
    const { imageBase64, altText } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });

    const compressedBuffer = await compressImage(imageBase64);
    const cdn = await uploadToCloudinary(compressedBuffer, `cover-${postId}`);

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        cover_image_url: cdn.secure_url,
        cover_image_cloudinary_id: cdn.public_id,
        cover_image_alt: altText || '',
        updated_at: new Date().toISOString(),
      }),
    });

    res.json({ success: true, imageUrl: cdn.secure_url, width: cdn.width, height: cdn.height });
  } catch (error) {
    console.error('cover-image upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 12e. 上传 OG 分享图
router.post('/post/:postId/og-image', async (req, res) => {
  try {
    const { postId } = req.params;
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });

    const compressedBuffer = await compressImage(imageBase64);
    const cdn = await uploadToCloudinary(compressedBuffer, `og-${postId}`);

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        og_image_url: cdn.secure_url,
        og_image_cloudinary_id: cdn.public_id,
        updated_at: new Date().toISOString(),
      }),
    });

    res.json({ success: true, imageUrl: cdn.secure_url });
  } catch (error) {
    console.error('og-image upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 12f. 上传正文插图（关联到 H2 章节）
router.post('/post/:postId/content-image', async (req, res) => {
  try {
    const { postId } = req.params;
    const { imageBase64, altText, sectionIndex } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });

    const compressedBuffer = await compressImage(imageBase64);
    const cdn = await uploadToCloudinary(compressedBuffer, `content-${postId}-${Date.now()}`);

    const posts = await sb(`blog_posts?id=eq.${postId}&select=content_images,content`);
    if (!posts || posts.length === 0) return res.status(404).json({ error: 'Post not found' });

    const existing = posts[0].content_images || [];
    const newImage = {
      id: uuidv4(),
      url: cdn.secure_url,
      cloudinaryId: cdn.public_id,
      altText: altText || '',
      width: cdn.width,
      height: cdn.height,
      sectionIndex: typeof sectionIndex === 'number' ? sectionIndex : null,
    };

    // 自动把 ![alt](url) 插入到对应 H2 章节末尾
    let content = posts[0].content || '';
    if (typeof sectionIndex === 'number' && sectionIndex >= 0) {
      content = insertImageAfterSection(content, sectionIndex, newImage);
    }

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        content_images: [...existing, newImage],
        content,
        updated_at: new Date().toISOString(),
      }),
    });

    res.json({ success: true, image: newImage });
  } catch (error) {
    console.error('content-image upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 12g. 删除正文插图
router.delete('/post/:postId/content-image/:imageId', async (req, res) => {
  try {
    const { postId, imageId } = req.params;
    const posts = await sb(`blog_posts?id=eq.${postId}&select=content_images,content`);
    if (!posts || posts.length === 0) return res.status(404).json({ error: 'Post not found' });

    const target = (posts[0].content_images || []).find(i => i.id === imageId);
    const updated = (posts[0].content_images || []).filter(i => i.id !== imageId);
    let content = posts[0].content || '';
    if (target && target.url) {
      content = content.split('\n').filter(line => !line.includes(target.url)).join('\n');
    }

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        content_images: updated,
        content,
        updated_at: new Date().toISOString(),
      }),
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 12h. AI 推荐正文插图位置（基于 H2 章节）
router.post('/post/:postId/suggest-images', async (req, res) => {
  try {
    const { postId } = req.params;
    const posts = await sb(`blog_posts?id=eq.${postId}&select=title,content,main_keyword,keywords`);
    if (!posts || posts.length === 0) return res.status(404).json({ error: 'Post not found' });

    const post = posts[0];
    const sections = extractH2Sections(post.content || '');
    if (sections.length === 0) {
      return res.json({ success: true, sections: [] });
    }

    // 用 AI 给每节配图建议
    const mainKw = post.main_keyword || (post.keywords && post.keywords[0]) || post.title;
    const prompt = `You are a blog photo editor. For each section below, suggest one short image idea (5-15 words) that fits the section. Return ONLY JSON array.

Article keyword: ${mainKw}
Article title: ${post.title}

Sections:
${sections.map((s, i) => `${i + 1}. ${s.heading}`).join('\n')}

Return format:
[{"sectionIndex": 0, "suggestion": "..."}]`;

    let suggestions = [];
    try {
      const content = await generateContentWithAI(mainKw, prompt, 'deepseek');
      const parsed = parseAIJson(content);
      suggestions = Array.isArray(parsed) ? parsed : (parsed.suggestions || []);
    } catch (err) {
      console.warn('AI image suggestion failed, using fallback:', err.message);
      suggestions = sections.map((s, i) => ({ sectionIndex: i, suggestion: `Photo illustrating "${s.heading}"` }));
    }

    // 合并 sections + suggestions
    const result = sections.map((s, i) => {
      const sug = suggestions.find(x => x.sectionIndex === i);
      return {
        sectionIndex: i,
        heading: s.heading,
        suggestion: sug ? sug.suggestion : `Photo illustrating "${s.heading}"`,
      };
    });

    res.json({ success: true, sections: result });
  } catch (error) {
    console.error('suggest-images error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 12i. SEO 质检（纯前端规则，不烧 token）
router.get('/seo-check/:postId', async (req, res) => {
  try {
    const posts = await sb(`blog_posts?id=eq.${req.params.postId}`);
    if (!posts || posts.length === 0) return res.status(404).json({ error: 'Post not found' });

    const p = posts[0];
    const content = p.content || '';
    const text = content.replace(/[#*_`>\[\]\(\)]/g, ' ');
    const words = text.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const mainKw = (p.main_keyword || (p.keywords && p.keywords[0]) || '').toLowerCase();
    const lcTitle = (p.title || '').toLowerCase();
    const lcMetaTitle = (p.meta_title || '').toLowerCase();
    const lcMetaDesc = (p.meta_description || '').toLowerCase();

    const h2List = (content.match(/^##\s+.+$/gm) || []);
    const h3List = (content.match(/^###\s+.+$/gm) || []);
    const internalLinks = (content.match(/\]\((\/[^)]+)\)/g) || []).length;
    const externalLinks = (content.match(/\]\((https?:\/\/[^)]+)\)/g) || []).length;
    const imagesInBody = (content.match(/!\[[^\]]*\]\([^)]+\)/g) || []);
    const altMissing = imagesInBody.filter(m => /!\[\s*\]\(/.test(m)).length;

    let kwCount = 0;
    if (mainKw) {
      const re = new RegExp(mainKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      kwCount = (text.match(re) || []).length;
    }
    const kwDensity = wordCount > 0 ? (kwCount / wordCount) * 100 : 0;

    const checks = [
      mkCheck('title', '标题长度', p.title && p.title.length >= 30 && p.title.length <= 70,
        `当前 ${p.title?.length || 0} 字符（建议 30-70）`),
      mkCheck('title-kw', '标题包含主关键词', !!mainKw && lcTitle.includes(mainKw),
        mainKw ? `主关键词「${mainKw}」${lcTitle.includes(mainKw) ? '已' : '未'}出现在标题` : '请先设置主关键词'),
      mkCheck('meta-title', 'Meta Title 长度', p.meta_title && p.meta_title.length >= 30 && p.meta_title.length <= 60,
        `当前 ${p.meta_title?.length || 0} 字符（建议 30-60）`),
      mkCheck('meta-desc', 'Meta Description 长度', p.meta_description && p.meta_description.length >= 120 && p.meta_description.length <= 160,
        `当前 ${p.meta_description?.length || 0} 字符（建议 120-160）`),
      mkCheck('meta-kw', 'Meta 包含主关键词', !!mainKw && (lcMetaTitle.includes(mainKw) || lcMetaDesc.includes(mainKw)),
        mainKw ? '' : '请先设置主关键词'),
      mkCheck('slug', 'Slug 已生成', !!p.slug_url, p.slug_url ? `/${p.slug_url}` : '尚未生成'),
      mkCheck('h2', 'H2 数量 (3-8)', h2List.length >= 3 && h2List.length <= 8,
        `当前 ${h2List.length} 个`),
      mkCheck('words', '字数 (800-1500)', wordCount >= 800 && wordCount <= 1800,
        `当前 ${wordCount} 字`),
      mkCheck('density', `关键词密度 (1-3%)`, kwDensity >= 0.8 && kwDensity <= 3,
        `当前 ${kwDensity.toFixed(2)}%（出现 ${kwCount} 次）`),
      mkCheck('first-para', '首段包含主关键词', !!mainKw && firstParagraphHasKeyword(content, mainKw),
        mainKw ? '' : '请先设置主关键词'),
      mkCheck('cover', '已上传封面图', !!p.cover_image_url, p.cover_image_url ? '已上传' : '建议 1200×675 (16:9)'),
      mkCheck('cover-alt', '封面图 Alt 文本', !!p.cover_image_alt, p.cover_image_alt ? '已填写' : 'Alt 缺失'),
      mkCheck('body-img', '正文配图', imagesInBody.length >= 1, `当前 ${imagesInBody.length} 张`),
      mkCheck('img-alt', '正文图片 Alt 完整', altMissing === 0, altMissing > 0 ? `${altMissing} 张缺 alt` : '全部已填'),
      mkCheck('internal', '内链 (≥2)', internalLinks >= 2, `当前 ${internalLinks} 条`),
      mkCheck('external', '外链 (≥1)', externalLinks >= 1, `当前 ${externalLinks} 条`),
      mkCheck('faq', '包含 FAQ', Array.isArray(p.faq) && p.faq.length >= 3, `当前 ${(p.faq || []).length} 条`),
    ];

    const passed = checks.filter(c => c.passed).length;
    const score = Math.round((passed / checks.length) * 100);

    res.json({
      success: true,
      score,
      passedCount: passed,
      totalCount: checks.length,
      checks,
      stats: { wordCount, h2Count: h2List.length, h3Count: h3List.length, internalLinks, externalLinks, kwDensity: +kwDensity.toFixed(2), kwCount, imagesInBody: imagesInBody.length },
    });
  } catch (error) {
    console.error('seo-check error:', error);
    res.status(500).json({ error: error.message });
  }
});

function mkCheck(key, name, passed, detail) {
  return { key, name, passed: !!passed, detail: detail || '' };
}

function firstParagraphHasKeyword(content, kw) {
  const lines = content.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    return t.toLowerCase().includes(kw);
  }
  return false;
}

function extractH2Sections(content) {
  const lines = content.split('\n');
  const sections = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[1].trim(), startLine: i, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function insertImageAfterSection(content, sectionIndex, image) {
  const lines = content.split('\n');
  let h2Seen = -1;
  let insertAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      h2Seen++;
      if (h2Seen === sectionIndex) {
        // 找下一段（或下一个 H2 / 文末）插入
        for (let j = i + 1; j <= lines.length; j++) {
          if (j === lines.length || /^##\s+/.test(lines[j])) {
            insertAt = j;
            break;
          }
        }
        break;
      }
    }
  }
  if (insertAt === -1) {
    return content + `\n\n![${image.altText || ''}](${image.url})\n`;
  }
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  return [...before, '', `![${image.altText || ''}](${image.url})`, '', ...after].join('\n');
}

// 12j. 自动生成 Slug
router.post('/post/:postId/generate-slug', async (req, res) => {
  try {
    const posts = await sb(`blog_posts?id=eq.${req.params.postId}&select=title`);
    if (!posts || posts.length === 0) return res.status(404).json({ error: 'Post not found' });

    const slug = posts[0].title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80);

    await sb(`blog_posts?id=eq.${req.params.postId}`, {
      method: 'PATCH',
      body: JSON.stringify({ slug_url: slug, updated_at: new Date().toISOString() }),
    });
    res.json({ success: true, slug });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 12k. AI 生成 Meta（title + description）
router.post('/post/:postId/generate-meta', async (req, res) => {
  try {
    const { postId } = req.params;
    const { model = 'deepseek' } = req.body;
    const posts = await sb(`blog_posts?id=eq.${postId}`);
    if (!posts || posts.length === 0) return res.status(404).json({ error: 'Post not found' });

    const post = posts[0];
    const prompt = `Generate SEO meta for this article. Return ONLY JSON.

Title: ${post.title}
Main keyword: ${post.main_keyword || (post.keywords && post.keywords[0]) || ''}
Excerpt: ${(post.content || '').slice(0, 500)}

Requirements:
- meta_title: 30-60 chars, include main keyword
- meta_description: 120-160 chars, include main keyword

Return: {"meta_title":"...","meta_description":"..."}`;

    const content = await generateContentWithAI(post.title, prompt, model);
    const meta = parseAIJson(content);

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        meta_title: meta.meta_title || '',
        meta_description: meta.meta_description || '',
        updated_at: new Date().toISOString(),
      }),
    });
    res.json({ success: true, meta });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 12l. 生成预览 token（一次性、1 小时过期，写到 blog_preview_tokens 表）
router.post('/post/:postId/preview-token', async (req, res) => {
  try {
    const { postId } = req.params;

    // 校验文章存在
    const posts = await sb(`blog_posts?id=eq.${postId}&select=id`);
    if (!posts || posts.length === 0) return res.status(404).json({ error: 'Post not found' });

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await sb('blog_preview_tokens', {
      method: 'POST',
      body: JSON.stringify({ token, post_id: postId, expires_at: expiresAt }),
    });

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.tpkele.com';
    const url = `${siteUrl}/blog/preview/${postId}?token=${token}`;

    res.json({ success: true, token, expiresAt, url });
  } catch (error) {
    console.error('preview-token error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────
// 13. plan 单条管理（删除 / 编辑 / 立即跑某条）
// ──────────────────────────────────────────

// 13a. 删除一条 plan
router.delete('/plans/:planId', async (req, res) => {
  try {
    await sb(`blog_plans?id=eq.${req.params.planId}`, { method: 'DELETE' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 13b. 编辑一条 plan（关键词/标题/类型）
router.patch('/plans/:planId', async (req, res) => {
  try {
    const updates = {};
    ['keyword', 'title', 'article_type'].forEach(k => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields' });
    }

    await sb(`blog_plans?id=eq.${req.params.planId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 13c. 立即跑一条 plan（不弹窗，直接生成对应文章）
router.post('/plans/:planId/generate-now', async (req, res) => {
  try {
    const { modelType = 'deepseek' } = req.body;
    const plans = await sb(`blog_plans?id=eq.${req.params.planId}&select=*`);
    if (!plans || plans.length === 0) return res.status(404).json({ error: 'Plan not found' });

    const plan = plans[0];
    const articleType = plan.article_type || 'product';

    const structured = await generateStructuredArticle({
      keyword: plan.keyword,
      title: plan.title,
      articleType,
      modelType,
    });

    const postRow = structuredToPostRow(structured, { keyword: plan.keyword, articleType });
    const post = {
      ...postRow,
      plan_id: plan.id,
      status: 'pending_review',
    };

    const postResult = await sb('blog_posts', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(post),
    });

    await sb(`blog_plans?id=eq.${plan.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'content_generated' }),
    });

    // 关键词使用计数
    try {
      const kw = await sb(`blog_keywords?keyword=eq.${encodeURIComponent(plan.keyword)}&select=id,used_count`);
      if (kw && kw[0]) {
        await sb(`blog_keywords?id=eq.${kw[0].id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            used_count: (kw[0].used_count || 0) + 1,
            last_used_date: new Date().toISOString().split('T')[0],
          }),
        });
      }
    } catch {}

    res.json({
      success: true,
      planId: plan.id,
      postId: postResult[0]?.id,
      title: structured.title,
    });
  } catch (error) {
    console.error('Error generating from plan:', error);
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────
// 14. 手动模式：明确指定关键词 + 类型 + 模型生成一篇
// ──────────────────────────────────────────
router.post('/generate-manual', async (req, res) => {
  try {
    const { keyword, articleType = 'product', model = 'deepseek', title, subKeywords } = req.body;

    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ error: '关键词不能为空' });
    }

    const suggestedTitle = (title && title.trim()) || autoTitleByType(articleType, keyword);

    // 用结构化 Prompt 一次性返回 content + meta + faq + 链接建议
    const structured = await generateStructuredArticle({
      keyword: keyword.trim(),
      title: suggestedTitle,
      articleType,
      subKeywords,
      modelType: model,
    });

    const postRow = structuredToPostRow(structured, { keyword: keyword.trim(), articleType });
    const post = {
      ...postRow,
      plan_id: null,
      status: 'pending_review',
    };

    const result = await sb('blog_posts', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(post),
    });

    // 计数
    try {
      const kw = await sb(`blog_keywords?keyword=eq.${encodeURIComponent(keyword)}&select=id,used_count`);
      if (kw && kw[0]) {
        await sb(`blog_keywords?id=eq.${kw[0].id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            used_count: (kw[0].used_count || 0) + 1,
            last_used_date: new Date().toISOString().split('T')[0],
          }),
        });
      }
    } catch {}

    res.json({
      success: true,
      postId: result[0]?.id,
      title: structured.title,
      articleType,
      stats: {
        wordCount: postRow.word_count,
        faqCount: structured.faq.length,
        internalLinkCount: postRow.internal_links.length,
        externalLinkCount: postRow.external_links.length,
      },
    });
  } catch (error) {
    console.error('Error in generate-manual:', error);
    res.status(500).json({ error: error.message });
  }
});

function autoTitleByType(type, keyword) {
  const tpl = {
    product: `Complete Guide to ${keyword}`,
    buying: `How to Choose the Right ${keyword}`,
    comparison: `${keyword}: Key Differences Explained`,
    application: `How to Use ${keyword} in Your Project`,
    faq: `${keyword} FAQ: Expert Answers`,
  };
  return tpl[type] || `Complete Guide to ${keyword}`;
}

// 14b. 重新生成已有文章（用新 Prompt redo）
router.post('/post/:postId/regenerate', async (req, res) => {
  try {
    const { postId } = req.params;
    const { modelType = 'deepseek', articleType: typeOverride } = req.body;

    const posts = await sb(`blog_posts?id=eq.${postId}&select=*`);
    if (!posts || posts.length === 0) return res.status(404).json({ error: 'Post not found' });
    const post = posts[0];

    const keyword = post.main_keyword || (post.keywords && post.keywords[0]) || post.title;
    const articleType = typeOverride || post.article_type || 'product';

    const structured = await generateStructuredArticle({
      keyword,
      title: post.title,
      articleType,
      subKeywords: post.sub_keywords,
      modelType,
    });

    const postRow = structuredToPostRow(structured, { keyword, articleType });

    // 重生成时保留原本人工已加的资源（封面、正文插图、slug）
    const updates = {
      ...postRow,
      // 不覆盖：cover_image_url, cover_image_alt, og_image_url, content_images, slug_url
      updated_at: new Date().toISOString(),
    };
    delete updates.keywords; // keywords 字段保留原值

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });

    res.json({
      success: true,
      postId,
      title: structured.title,
      articleType,
      stats: {
        wordCount: postRow.word_count,
        faqCount: structured.faq.length,
      },
    });
  } catch (error) {
    console.error('Error regenerating:', error);
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────
// 15. 网站可链向的页面列表（给审核工作台的"添加内链"下拉用）
// ──────────────────────────────────────────
router.get('/site-pages-list', async (req, res) => {
  try {
    // 已发布 blog 文章
    const blogs = await sb('blog_posts?status=eq.published&select=slug_url,title,article_type&order=published_at.desc');

    // 静态产品页 / 分类页（写死一份基础列表，比扫描 site.ts 简单可靠）
    const staticPages = {
      products: [
        { slug: 'ac-mcb-1p', name: 'AC MCB 1P' },
        { slug: 'ac-mcb-2p', name: 'AC MCB 2P' },
        { slug: 'ac-mcb-3p', name: 'AC MCB 3P' },
        { slug: 'ac-mcb-4p', name: 'AC MCB 4P' },
        { slug: 'dc-mcb-1p', name: 'DC MCB 1P' },
        { slug: 'dc-mcb-2p', name: 'DC MCB 2P' },
        { slug: 'dc-mcb-3p', name: 'DC MCB 3P' },
        { slug: 'dc-mcb-4p', name: 'DC MCB 4P' },
        { slug: 'ac-spd', name: 'AC SPD' },
        { slug: 'dc-spd', name: 'DC SPD' },
        { slug: 'ats', name: 'ATS Automatic Transfer Switch' },
        { slug: 'pv-combiner-box', name: 'PV Combiner Box' },
        { slug: 'voltage-protector', name: 'Voltage Protector' },
        { slug: 'din-rail-energy-meter', name: 'DIN Rail Energy Meter' },
      ],
      categories: [
        { slug: 'mcb/ac-mcb', name: 'AC MCB Category' },
        { slug: 'mcb/dc-mcb', name: 'DC MCB Category' },
        { slug: 'spd/ac-spd', name: 'AC SPD Category' },
        { slug: 'spd/dc-spd', name: 'DC SPD Category' },
      ],
      blogCategories: [
        { slug: 'product', name: 'Product Knowledge' },
        { slug: 'buying', name: 'Selection Guides' },
        { slug: 'comparison', name: 'Comparisons' },
        { slug: 'application', name: 'Applications' },
        { slug: 'faq', name: 'FAQs' },
      ],
    };

    res.json({
      success: true,
      pages: {
        blogs: (blogs || []).map(b => ({
          url: `/blog/${b.slug_url}`,
          title: b.title,
          articleType: b.article_type,
        })).filter(b => b.url && b.url !== '/blog/null'),
        products: staticPages.products.map(p => ({
          url: `/products/${p.slug}`,
          title: p.name,
        })),
        productCategories: staticPages.categories.map(c => ({
          url: `/products/category/${c.slug}`,
          title: c.name,
        })),
        blogCategories: staticPages.blogCategories.map(c => ({
          url: `/blog/category/${c.slug}`,
          title: c.name,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
