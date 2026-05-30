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

// ──────────────────────────────────────────
// AI 模型适配器
// ──────────────────────────────────────────

async function generateContentWithAI(keyword, title, modelType = 'claude') {
  const model = AI_MODELS[modelType];
  if (!model || !model.apiKey) {
    throw new Error(`Model ${modelType} not configured or API key missing`);
  }

  const prompt = `
你是一个专业的 BLOG 内容创作者。请为以下主题创建一篇高质量的 BLOG 文章。

主题关键词：${keyword}
文章标题：${title}

要求：
1. 文章长度：800-1200 字
2. 格式：Markdown
3. 包含 2-3 个主要章节
4. 每个章节包含 2-3 个段落
5. 在适当位置添加列表或要点
6. 最后包含一个总结段落
7. 不要包含图片标记或 HTML 标签
8. 确保内容对 SEO 友好

请直接返回 Markdown 格式的文章内容，不要添加任何额外的说明或标记。
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

module.exports = router;
