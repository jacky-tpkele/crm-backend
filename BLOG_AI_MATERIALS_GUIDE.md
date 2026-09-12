# AI素材库 + 多插图管理 - 实施指南

## 📋 概述

本次更新为BLOG自动化系统添加了**AI素材库**和**多插图管理**功能，允许你：

1. 保存AI对话内容作为文章素材
2. 自动分析素材并提取关键信息
3. 从素材生成文章时自动规划插图需求
4. 为每篇文章管理多张插图（而不仅仅是一张特色图片）

---

## 🗂️ 文件清单

### 新增文件

1. **schema_blog_phase10_ai_materials.sql** - 数据库Schema
   - `blog_ai_materials` 表：存储AI素材
   - `blog_post_images` 表：支持多插图
   - `blog_posts.material_id` 字段：关联素材

2. **blog-ai-materials.html** - AI素材库管理页面
   - 素材列表展示
   - 新增/编辑素材
   - AI自动分析
   - 插图需求配置
   - 从素材生成文章

### 修改文件

1. **blog-automation.html**
   - 侧边栏新增"AI素材库"按钮

2. **api/blog/index.js**
   - 新增11个API接口（素材管理 + 插图管理）

---

## 🚀 部署步骤

### 第1步：执行数据库迁移

在Supabase SQL编辑器中执行：

```bash
# 连接到Supabase并执行
psql -h <your-supabase-host> -U postgres -d postgres -f schema_blog_phase10_ai_materials.sql
```

或在Supabase Dashboard → SQL Editor 中粘贴 `schema_blog_phase10_ai_materials.sql` 的内容并执行。

### 第2步：部署前端文件

确保以下文件已上传到服务器：

```bash
- blog-automation.html (已更新)
- blog-ai-materials.html (新增)
```

### 第3步：重启API服务

重启Node.js服务以加载新的API接口：

```bash
# 如果使用PM2
pm2 restart blog-api

# 如果使用Vercel
# 推送代码后自动部署
git add .
git commit -m "feat: add AI materials library and multi-image support"
git push
```

### 第4步：验证功能

访问：`https://your-domain.com/blog-automation.html`

1. 点击侧边栏新增的"AI素材库"按钮
2. 尝试新增一条素材
3. 点击"AI自动分析"测试AI分析功能
4. 点击"生成文章"测试从素材生成文章

---

## 📱 功能使用指南

### 一、AI素材库页面

#### 1. 新增素材

**步骤：**
1. 点击右上角"新增素材"按钮
2. 填写素材内容：
   - **标题**：素材标题（可选，AI会自动生成建议）
   - **AI对话内容**：粘贴你与AI的对话，或任何文本素材
   - **文章类型**：选择类型或让AI自动识别
   - **标签**：用逗号分隔多个标签（如：`product, mcb, selection`）
   - **优先级**：1-5星
3. 配置插图需求：
   - 点击"+"添加插图
   - 设置位置（文章开头/第一节/第二节/结尾）
   - 设置类型（产品图/示意图/对比图/信息图）
   - 填写描述（例如："AC MCB 1P-4P产品外观图"）
4. 点击"保存"

**AI自动分析功能：**
- 点击"AI自动分析"按钮
- AI会自动提取：
  - 建议的文章标题
  - 文章类型
  - 关键词
  - 插图需求（位置、类型、描述）

#### 2. 从素材生成文章

**步骤：**
1. 在素材列表中找到目标素材
2. 点击"生成文章"按钮
3. 系统会：
   - 基于素材内容生成完整文章
   - 自动创建插图占位记录
   - 跳转到审核页面（带插图管理）

---

### 二、多插图管理（审核页面）

**注意：** `blog-review.html` 的插图管理功能需要单独实现，当前Schema和API已准备好。

#### 预期功能（待实现）：

**审核文章时的插图步骤：**
1. 特色图片（Featured Image）
   - 社交分享缩略图
   - 推荐尺寸：1200×630

2. 正文插图（Multiple Images）
   - 查看AI建议的插图列表
   - 为每张图上传文件
   - 设置Alt文本和说明
   - 调整排序

3. 插图信息：
   - 位置：intro/section1/section2/conclusion
   - 类型：product/diagram/comparison/infographic
   - Alt文本（SEO）
   - 图片说明（Caption）

---

## 🔧 API接口文档

### AI素材管理

#### 1. 获取素材列表
```http
GET /api/blog/materials?status=pending&article_type=product
```

**响应：**
```json
{
  "success": true,
  "materials": [
    {
      "id": 1,
      "title": "AC MCB选型指南",
      "content": "...",
      "article_type": "buying",
      "tags": ["product", "mcb"],
      "status": "pending",
      "used_count": 0,
      "image_requirements": {
        "count": 3,
        "suggestions": [...]
      },
      "created_at": "2026-09-12T10:00:00Z"
    }
  ]
}
```

#### 2. 创建素材
```http
POST /api/blog/materials
Content-Type: application/json

{
  "title": "AC MCB选型指南",
  "content": "用户: 我需要了解...\nAI: ...",
  "article_type": "buying",
  "tags": ["product", "mcb"],
  "priority": 3,
  "image_requirements": {
    "count": 2,
    "suggestions": [
      {
        "position": "intro",
        "type": "product",
        "description": "AC MCB产品图",
        "alt_text": "AC Miniature Circuit Breaker"
      }
    ]
  }
}
```

#### 3. AI分析素材
```http
POST /api/blog/analyze-material
Content-Type: application/json

{
  "content": "素材内容...",
  "modelType": "deepseek"
}
```

**响应：**
```json
{
  "success": true,
  "analysis": {
    "suggested_title": "How to Choose AC MCB",
    "article_type": "buying",
    "main_keywords": ["AC MCB", "circuit breaker"],
    "topics": ["selection", "ratings"],
    "image_requirements": [...]
  }
}
```

#### 4. 从素材生成文章
```http
POST /api/blog/generate-from-material
Content-Type: application/json

{
  "materialId": 1,
  "modelType": "deepseek"
}
```

**响应：**
```json
{
  "success": true,
  "postId": 123,
  "title": "How to Choose AC MCB",
  "imageRequirements": {...}
}
```

### 插图管理

#### 5. 获取文章插图列表
```http
GET /api/blog/posts/123/images
```

#### 6. 上传插图
```http
POST /api/blog/posts/123/images
Content-Type: application/json

{
  "imageBase64": "data:image/png;base64,...",
  "position": "intro",
  "imageType": "product",
  "altText": "AC MCB Product",
  "caption": "Figure 1: AC MCB Configuration",
  "sortOrder": 0
}
```

#### 7. 更新插图信息
```http
PUT /api/blog/posts/123/images/456
Content-Type: application/json

{
  "altText": "Updated alt text",
  "caption": "Updated caption",
  "sortOrder": 1
}
```

#### 8. 删除插图
```http
DELETE /api/blog/posts/123/images/456
```

---

## 📊 数据库表结构

### blog_ai_materials（AI素材表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGSERIAL | 主键 |
| title | VARCHAR(500) | 素材标题 |
| content | TEXT | AI对话内容 |
| source_type | VARCHAR(50) | manual/api |
| extracted_keywords | TEXT[] | 提取的关键词 |
| article_type | VARCHAR(50) | 文章类型 |
| image_requirements | JSONB | 插图需求 |
| tags | TEXT[] | 标签 |
| priority | INT | 优先级(0-5) |
| status | VARCHAR(50) | pending/analyzed/used/archived |
| used_count | INT | 使用次数 |
| created_at | TIMESTAMP | 创建时间 |

### blog_post_images（文章插图表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGSERIAL | 主键 |
| post_id | BIGINT | 文章ID（外键） |
| image_url | TEXT | Cloudinary URL |
| cloudinary_id | TEXT | Cloudinary Public ID |
| position | VARCHAR(50) | intro/section1/section2/conclusion |
| alt_text | VARCHAR(500) | SEO友好的alt文本 |
| caption | TEXT | 图片说明 |
| image_type | VARCHAR(50) | product/diagram/comparison/infographic |
| width | INT | 宽度 |
| height | INT | 高度 |
| sort_order | INT | 排序 |
| ai_generated | BOOLEAN | 是否AI生成 |
| created_at | TIMESTAMP | 创建时间 |

---

## 🎯 工作流程

### 传统流程（关键词生成）
```
关键词 → 生成文章 → 上传1张特色图 → 审核 → 发布
```

### 新流程（AI素材驱动）
```
AI对话 → 保存到素材库 → AI分析提取信息 → 配置插图需求
   ↓
从素材生成文章 → 自动创建插图占位 → 上传多张插图 → 审核 → 发布
```

---

## ⚠️ 注意事项

1. **数据库迁移必须先执行**
   - 否则API接口会报错（表不存在）

2. **blog-review.html插图管理待实现**
   - 当前只有API和数据结构
   - 前端插图上传界面需要额外开发

3. **AI分析功能依赖模型API**
   - 确保`.env`中配置了`DEEPSEEK_API_KEY`或`CLAUDE_API_KEY`
   - 分析一次素材约消耗500-1000 tokens

4. **Cloudinary配置**
   - 插图上传需要Cloudinary配置
   - 确保环境变量已设置：
     ```
     CLOUDINARY_CLOUD_NAME=your_cloud_name
     CLOUDINARY_API_KEY=your_api_key
     CLOUDINARY_API_SECRET=your_api_secret
     ```

5. **图片压缩**
   - 自动压缩为WebP格式
   - 最大宽度1200px，质量85%

---

## 🔮 未来扩展方向

### 短期（建议实现）

1. **blog-review.html插图管理界面**
   - 可视化插图上传
   - 拖拽排序
   - 预览效果

2. **素材导入/导出**
   - 批量导入素材
   - 导出为JSON

3. **素材搜索**
   - 全文搜索
   - 按关键词筛选

### 中期

1. **AI生成插图**
   - 集成DALL-E/Midjourney API
   - 根据描述自动生成图片

2. **素材关联分析**
   - 相似素材推荐
   - 素材复用建议

3. **批量生成**
   - 从多个素材批量生成文章

### 长期

1. **素材智能标签**
   - 自动提取实体
   - 知识图谱构建

2. **多语言支持**
   - 素材翻译
   - 多语言文章生成

---

## 📞 问题排查

### 问题1：AI素材库页面打不开

**检查：**
- 确认`blog-ai-materials.html`已部署
- 检查浏览器控制台是否有404错误

### 问题2：AI分析功能报错

**检查：**
- 环境变量是否配置API Key
- API余额是否充足
- 网络连接是否正常

### 问题3：生成文章后没有插图占位

**检查：**
- 素材的`image_requirements`字段是否有数据
- 检查`blog_post_images`表是否创建成功
- 查看API日志是否有错误

### 问题4：上传插图失败

**检查：**
- Cloudinary配置是否正确
- 图片大小是否超过限制（建议<5MB）
- 检查API日志中的Cloudinary错误信息

---

## 📈 性能优化建议

1. **素材内容分页加载**
   - 当素材超过100条时，实现分页

2. **图片懒加载**
   - 素材卡片中的缩略图使用懒加载

3. **AI分析缓存**
   - 对相同内容的分析结果缓存24小时

4. **批量操作优化**
   - 批量删除/归档素材时使用事务

---

## ✅ 测试清单

- [ ] 数据库表创建成功
- [ ] AI素材库页面可访问
- [ ] 新增素材功能正常
- [ ] AI自动分析功能正常
- [ ] 从素材生成文章功能正常
- [ ] 插图占位记录创建成功
- [ ] 插图上传API正常（需要测试客户端）
- [ ] 插图删除功能正常

---

## 📝 更新日志

### v10.0 - 2026-09-12

**新增：**
- AI素材库管理系统
- 多插图支持
- AI自动分析素材功能
- 从素材生成文章功能

**数据库：**
- 新增`blog_ai_materials`表
- 新增`blog_post_images`表
- `blog_posts`新增`material_id`字段

**API：**
- 11个新接口（素材管理 + 插图管理）

---

## 📧 联系支持

如有问题，请查看：
- API日志：检查错误详情
- Supabase Dashboard：查看数据库状态
- 浏览器控制台：查看前端错误

---

**完成时间：** 2026-09-12  
**版本：** Phase 10 - AI Materials & Multi-Image Support
