// =============================================
// BLOG 自动化 - 后端 API（支持多模型）
// =============================================

// 文件位置：d:/新CRM/api/blog/index.js

const express = require('express');
const fetch = require('node-fetch');
const cloudinary = require('cloudinary').v2;
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

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
  // 如果仍不是纯 JSON，提取第一个 {...} 或 [...] 块
  try {
    return JSON.parse(text);
  } catch {
    const objMatch = text.match(/\{[\s\S]*\}/);
    const arrMatch = text.match(/\[[\s\S]*\]/);
    const candidate = objMatch ? objMatch[0] : (arrMatch ? arrMatch[0] : null);
    if (!candidate) throw new Error('Failed to parse AI JSON response');
    return JSON.parse(candidate);
  }
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
  } else {
    throw new Error(`Unsupported model type: ${modelType}`);
  }
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
      max_tokens: 2000,
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
      max_tokens: 2000,
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
        // 生成文案
        const content = await generateContentWithAI(plan.keyword, plan.title, 'claude');

        // 创建 blog_post
        const post = {
          plan_id: plan.id,
          title: plan.title,
          content,
          keywords: [plan.keyword],
          status: 'draft',
        };

        const postResult = await sb('blog_posts', {
          method: 'POST',
          body: JSON.stringify(post),
        });

        // 更新 blog_plans 状态
        await sb(`blog_plans?id=eq.${plan.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'content_generated' }),
        });

        results.push({
          planId: plan.id,
          postId: postResult[0].id,
          title: plan.title,
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

      // 临时计划列表
      plans = keywords.map(kw => ({
        id: null,
        keyword: kw.keyword,
        title: `Complete Guide to ${kw.keyword}`,
      }));
    }

    const results = [];

    for (const plan of plans) {
      try {
        const content = await generateContentWithAI(plan.keyword, plan.title, modelType);

        const post = {
          plan_id: plan.id,
          title: plan.title,
          content,
          keywords: [plan.keyword],
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
          title: plan.title,
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

    await sb(`blog_posts?id=eq.${postId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'approved',
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });

    res.json({
      success: true,
      postId,
      status: 'approved',
    });
  } catch (error) {
    console.error('Error approving post:', error);
    res.status(500).json({ error: error.message });
  }
});

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

module.exports = router;
