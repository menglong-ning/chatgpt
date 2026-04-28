# 正式部署说明：digxipop fulfillment-app

目标：把当前 Shopify Remix App 部署到 Render，并安装到正式店使用。

## 1. 部署前检查

当前项目已调整为正式部署方向：

- Docker 使用 Node 20。
- Prisma datasource 改为 PostgreSQL。
- 新增 `render.yaml`。
- Shopify scopes 包含订单、客户、发货和 merchant-managed fulfillment order 权限。

## 2. 推送到 GitHub

在项目根目录初始化或使用已有 GitHub 仓库：

```bash
git init
git add .
git commit -m "Prepare fulfillment app for production deployment"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/digxipop-fulfillment-app.git
git push -u origin main
```

不要提交这些目录/文件：

```text
node_modules
build
.shopify
prisma/dev.sqlite
```

## 3. 在 Render 创建服务

推荐使用 Render Blueprint：

1. 打开 Render。
2. 连接 GitHub。
3. New -> Blueprint。
4. 选择该仓库。
5. Render 会读取 `render.yaml`，创建：
   - Web Service: `digxipop-fulfillment-app`
   - PostgreSQL: `digxipop-fulfillment-db`

如果不用 Blueprint，也可以手动创建：

Build command:

```bash
npm ci && npm run build
```

Start command:

```bash
npm run setup && npm run start
```

## 4. Render 环境变量

Render Web Service 里填写：

```text
SHOPIFY_API_KEY=Shopify Dev Dashboard 里的客户端 ID
SHOPIFY_API_SECRET=Shopify Dev Dashboard 里的加密密钥
SHOPIFY_APP_URL=https://你的-render-service.onrender.com
SCOPES=read_assigned_fulfillment_orders,read_customers,read_fulfillments,read_merchant_managed_fulfillment_orders,read_orders,write_assigned_fulfillment_orders,write_fulfillments,write_merchant_managed_fulfillment_orders
DATABASE_URL=Render PostgreSQL connection string
NODE_ENV=production
```

`DATABASE_URL` 如果使用 `render.yaml`，会自动从数据库注入。

## 5. 修改 Shopify App URL

部署完成后，拿到 Render HTTPS 地址，例如：

```text
https://digxipop-fulfillment-app.onrender.com
```

修改 `shopify.app.fulfillment-app.toml`：

```toml
application_url = "https://digxipop-fulfillment-app.onrender.com"

[auth]
redirect_urls = [ "https://digxipop-fulfillment-app.onrender.com/api/auth" ]
```

然后运行：

```bash
shopify app deploy --config fulfillment-app
```

## 6. 安装到正式店

进入 Shopify Dev Dashboard：

1. 打开 `fulfillment-app`。
2. 确认 active version 已更新。
3. 点安装应用。
4. 选择正式店 `digxipop Japan`。
5. 授权权限。

## 7. 上线后测试

1. 打开正式店后台里的 fulfillment-app。
2. 确认订单列表能加载。
3. 勾选订单导出 CSV。
4. 检查 CSV：
   - A 订单号
   - I 电话
   - K 邮编
   - L/M 地址
   - P 客户名
   - R 様
5. 上传 Yamato CSV，确认 A 列订单号、D 列运单号能解析。
6. 测试批量发货。
7. 确认是否需要通知客户。当前代码是 `notifyCustomer: true`。

## 8. 生产风险

- 当前订单查询只取前 100 条，应补分页或日期筛选。
- 当前没有导出/发货操作日志。
- 当前没有自动化测试。
- Yamato CSV 如果运单号被 Excel 保存成科学计数法并丢失尾数，无法恢复真实尾数。
- 正式上线前建议把固定发件人信息做成配置项。
