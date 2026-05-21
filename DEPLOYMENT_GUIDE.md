# Scanner-P 在线部署指南

## 方案一：Replit 部署（推荐）

### 步骤：
1. 访问 https://replit.com 并注册/登录账号
2. 点击 "Create Repl"
3. 选择 "Import from GitHub"
4. 输入您的仓库地址：`https://github.com/OkRFGUN/scanner-P`
5. 点击 "Import from GitHub"
6. 等待导入完成后，Replit 会自动识别 Node.js 项目
7. 在配置中设置：
   - Run command: `npm start`
   - Language: Node.js
8. 点击 "Run" 按钮启动服务
9. 您会获得一个公网访问链接，格式类似：`https://scanner-p.yourusername.repl.co`

### Replit 优势：
- ✅ 完全免费
- ✅ 支持完整 Node.js 后端
- ✅ 一键启动
- ✅ 提供公网访问链接
- ✅ 可以在线编辑代码

---

## 方案二：Glitch 部署

### 步骤：
1. 访问 https://glitch.com 并注册/登录账号
2. 点击 "New Project" → "Import from GitHub"
3. 输入您的仓库地址：`https://github.com/OkRFGUN/scanner-P`
4. 等待导入完成
5. Glitch 会自动识别并启动项目
6. 您会获得一个公网访问链接，格式类似：`https://scanner-p.glitch.me`

### Glitch 优势：
- ✅ 完全免费
- ✅ 支持完整 Node.js 后端
- ✅ 自动休眠节省资源
- ✅ 提供公网访问链接
- ✅ 支持实时协作

---

## 方案三：本地服务 + ngrok 内网穿透

### 步骤：
1. 下载 ngrok：https://ngrok.com/download
2. 解压并运行 ngrok
3. 在本地启动 scanner-P 服务
4. 运行命令：`ngrok http 3000`
5. 您会获得一个公网访问链接

---

## 推荐方案

我推荐使用 **Replit**，因为：
1. 界面友好，操作简单
2. 项目导入和启动速度快
3. 提供稳定的公网访问链接
4. 可以随时在线编辑和更新代码
