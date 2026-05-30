# BLOG 自动化系统 - 完整部署指南

## 📋 部署清单

### 第 1 步：Supabase 配置（已完成）
- ✅ 执行 SQL 脚本创建表结构
- ✅ 启用 RLS 权限

### 第 2 步：Vercel 环境变量配置

在 **Vercel → Settings → Environment Variables** 中添加以下变量：

#### Supabase（已有）
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

#### Cloudinary（新增）
```
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

#### AI 模型（选择至少一个）
```
# Claude API
CLAUDE_API_KEY=sk-ant-xxx

# OpenAI API（可选）
OPENAI_API_KEY=sk-xxx

# Google Gemini API（可选）
GEMINI_API_KEY=your_gemini_api_key
```

#### 定时任务
```
CRON_SECRET=your_random_secret_key_32_chars_minimum
```

#### 图片压缩配置
```
IMAGE_COMPRESSION_QUALITY=85
IMAGE_MAX_WIDTH=1200
IMAGE_MAX_HEIGHT=800
IMAGE_MAX_SIZE=200000
```

#### 网站配置
```
NEXT_PUBLIC_SITE_URL=https://www.tpkele.com
```

### 第 3 步：安装依赖

在 CRM 项目中运行：
```bash
npm install
```

新增的依赖已在 package.json 中：
- `cloudinary` - 图片存储
- `sharp` - 图片压缩
- `uuid` - 生成唯一 ID

### 第 4 步：部署到 Vercel

#### CRM 部署
```bash
cd d:/新CRM
git add .
git commit -m "feat: add BLOG automation system"
git push origin main
```

Vercel 会自动部署。部署完成后：
- ✅ 后端 API 可用：`https://your-crm.vercel.app/api/blog/*`
- ✅ 定时任务启用：每天凌晨 8 点自动执行

#### 网站部署
```bash
cd D:/TPKELE/5月5日网站
git add .
git commit -m "feat: migrate BLOG to dynamic data source"
git push origin main
```

Vercel 会自动部署。部署完成后：
- ✅ BLOG 列表页面：`https://www.tpkele.com/blog`
- ✅ BLOG 详情页面：`https://www.tpkele.com/blog/[slug]`
- ✅ API 接口：`https://www.tpkele.com/api/blog`

---

## 🚀 使用流程

### 初始化（第一次使用）

1. **打开 CRM BLOG 自动化模块**
   - 访问：`https://your-crm.vercel.app/blog-automation.html`

2. **添加关键词库**
   - 在"关键词库"标签页输入 50-100 个关键词
   - 点击"添加"

3. **生成 30 天规划**
   - 切换到"生成规划"标签页
   - 选择月份（如 2026-06）
   - 点击"生成 30 天规划"
   - 系统会规划 120 篇 BLOG（每天 4 篇）

### 每天自动执行（凌晨 8 点）

1. **定时任务触发**
   - Vercel Cron 在每天凌晨 8 点自动执行
   - 生成当天 4 篇文案（无图）
   - 保存到 Supabase

2. **你会收到通知**
   - 邮件通知：今天 4 篇文案已生成
   - 在 CRM 中看到"已生成"的文章

### 用户工作流（工作时间）

1. **打开 CRM，查看计划列表**
   - 切换到"计划列表"标签页
   - 看到"已生成"的文章

2. **点击"预览"打开编辑页面**
   - 可以编辑标题
   - 可以编辑内容（Markdown）
   - 可以编辑关键词

3. **用自己的 AI 工具生成图片**
   - 推荐尺寸：1200 × 540 px (16:9)
   - 推荐格式：WebP / JPEG
   - 最大文件：200KB

4. **在 CRM 上传图片**
   - 拖拽或点击选择文件
   - 系统自动压缩优化
   - 显示压缩效果（原始 vs 压缩后）

5. **预览效果**
   - 显示详情页预览（1200×540）
   - 显示前台卡片预览（470×210）

6. **点击"确认发布"**
   - 文章发布到网站 BLOG 页面
   - 网站自动展示新文章

### 30 天后（生成下一个周期）

1. 再次点击"生成 30 天规划"
2. 系统自动规划下一个月的 120 篇
3. 循环执行

---

## 🔍 验证部署

### 验证后端 API

```bash
# 获取可用模型列表
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://your-crm.vercel.app/api/blog/models

# 获取计划列表
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://your-crm.vercel.app/api/blog/plans
```

### 验证网站 BLOG

```bash
# 获取所有已发布的 BLOG
curl https://www.tpkele.com/api/blog

# 获取单篇 BLOG
curl https://www.tpkele.com/api/blog?slug=your-blog-slug
```

### 验证定时任务

1. 在 Vercel 中查看 Cron 日志
2. 或手动触发测试：
```bash
curl "https://your-crm.vercel.app/api/blog/cron?token=YOUR_CRON_SECRET"
```

---

## 📊 成本分析

| 项目 | 月费 | 年费 |
|------|------|------|
| Supabase（Free） | $0 | $0 |
| Cloudinary（Free） | $0 | $0 |
| Claude API | $0.5-1 | $6-12 |
| Vercel（Free） | $0 | $0 |
| **总计** | **$0.5-1** | **$6-12** |

---

## 🛠️ 故障排查

### 问题 1：定时任务没有执行

**检查清单：**
1. 确认 `vercel.json` 中有 crons 配置
2. 确认 `CRON_SECRET` 环境变量已设置
3. 在 Vercel 中查看 Cron 日志
4. 手动测试：`curl "https://your-crm.vercel.app/api/blog/cron?token=YOUR_CRON_SECRET"`

### 问题 2：图片上传失败

**检查清单：**
1. 确认 Cloudinary 环境变量正确
2. 确认图片格式支持（WebP/JPEG/PNG）
3. 确认图片大小 < 200KB
4. 查看浏览器控制台错误信息

### 问题 3：AI 生成失败

**检查清单：**
1. 确认 AI 模型 API Key 正确
2. 确认 API Key 有足够的配额
3. 检查网络连接
4. 查看后端日志

### 问题 4：网站 BLOG 页面显示为空

**检查清单：**
1. 确认 Supabase 中有已发布的文章（status = 'published'）
2. 确认网站 API 接口可访问：`https://www.tpkele.com/api/blog`
3. 确认 `NEXT_PUBLIC_SITE_URL` 环境变量正确
4. 检查网站构建日志

---

## 📞 支持

如有问题，请检查：
1. 环境变量是否正确设置
2. Supabase 表结构是否正确创建
3. Vercel 部署日志
4. 浏览器控制台错误信息

---

## ✅ 完成清单

- ✅ 数据库设计（Supabase）
- ✅ 后端 API 开发（9 个接口）
- ✅ 前端页面开发（CRM BLOG 自动化模块）
- ✅ 网站改造（动态 BLOG 页面）
- ✅ 环境变量配置
- ✅ 定时任务配置
- ✅ 部署指南

**系统已准备就绪，可以开始使用！** 🎉
