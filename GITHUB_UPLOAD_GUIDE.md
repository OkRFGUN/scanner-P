# Scanner-P 上传到 GitHub 完整指南

## 📋 准备工作

### 1️⃣ 安装 Git
如果你还没有安装Git，先下载安装：
👉 https://git-scm.com/downloads

安装后重启终端/命令行！

### 2️⃣ 准备 GitHub 仓库
1. 访问 https://github.com
2. 登录你的账号
3. 点击右上角的 "+" → "New repository"
4. 填写仓库信息：
   - Repository name: `scanner-p`（或你喜欢的名字）
   - Description: `Web scanner with resource extraction and Plus modules`
   - Public/Private: 按你需要选
   - **不要**勾选 "Initialize this repository with..."
5. 点击 "Create repository"

---

## 🚀 上传步骤

### 步骤 1: 打开命令行/终端
打开 PowerShell 或 Command Prompt，进入项目目录：
```powershell
cd d:\exproject pym\scanner-P
```

### 步骤 2: 初始化 Git 仓库（已准备好 .gitignore）
```powershell
# 初始化仓库
git init

# 配置用户信息（第一次用Git需要）
git config user.name "你的名字"
git config user.email "你的邮箱@example.com"

# 添加所有文件
git add .

# 第一次提交
git commit -m "Initial commit: Scanner-P v1.0"
```

### 步骤 3: 连接到 GitHub 仓库
把下面的 `你的用户名` 换成你真实的GitHub用户名！
```powershell
# 添加远程仓库（替换成你的信息）
git remote add origin https://github.com/你的用户名/scanner-p.git

# 推送到 GitHub
git branch -M main
git push -u origin main
```

---

## 📦 已准备好的文件

✅ `.gitignore` 已创建 - 正确排除了敏感文件
✅ 源代码完整
✅ README.md 已存在
✅ package.json 已准备好

---

## 🔐 安全提示

**已自动排除以下内容，不会上传到GitHub：**
- ❌ `data/` - 用户数据
- ❌ `node_modules/` - 依赖包
- ❌ `backups/` - 备份文件
- ❌ `*.log` - 日志文件

---

## 📝 如果已有仓库

如果你已经有GitHub仓库，直接添加远程地址：
```powershell
git remote add origin https://github.com/你的用户名/你的仓库名.git
git branch -M main
git push -u origin main
```

---

## 💡 提示

1. **首次推送可能需要登录** - 用你的GitHub账号登录
2. **建议创建Release** - 上传后可以创建v1.0 Release
3. **仓库设为Private** - 如果不想公开，设为私有仓库

---

## 🎯 功能总结（可写在GitHub README中）

### 核心功能
- ✅ 网页扫描和数据捕获
- ✅ Plus增强模块（可选）
- ✅ 网页资源提取
- ✅ 资源筛选和搜索
- ✅ 批量资源下载和保存
- ✅ 按类型分类保存

### 技术栈
- Node.js
- Vanilla JavaScript
- No framework dependencies

---

## ⚠️ 重要提醒

- 内部版V1备份在 `internal-backups/` 文件夹（已在.gitignore中，不会上传）
- 请确保 .gitignore 正常工作
- 上传前检查没有敏感数据
