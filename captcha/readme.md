# ddddocr 点选验证码识别服务

本地 HTTP 服务，替代图鉴 (ttshitu) API，识别延迟从 ~4s 降至 <100ms。

## 启动

```bash
cd /Users/yangyiming/Documents/nodeDev/captcha
source venv/bin/activate
python ddddocr_server.py
```

服务启动后监听 `http://127.0.0.1:9898`。

可选参数：

```bash
python ddddocr_server.py --port 9000   # 指定端口
python ddddocr_server.py --host 0.0.0.0  # 允许外部访问
python ddddocr_server.py --debug       # debug 模式
```

## 接口

### POST /click

识别点选验证码，返回格式与图鉴 API 兼容。

```json
// 请求
POST http://127.0.0.1:9898/click
Content-Type: application/json

{
  "image": "<图片 base64>",
  "remark": "大中小"
}

// 响应
{
  "success": true,
  "data": {
    "result": "x1,y1|x2,y2|x3,y3",
    "id": ""
  }
}
```

### GET /health

健康检查。

```json
{"status": "ok", "engine": "ddddocr"}
```
