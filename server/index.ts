import { createApp } from './app.ts';
import { readModelConfig } from './model.ts';

try {
  process.loadEnvFile?.();
} catch (error) {
  if (!(typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT')) {
    console.error('无法读取本地 .env 文件，请检查文件格式。');
    process.exit(1);
  }
}

try {
  const port = Number(process.env.PORT || 4310);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 必须是1024到65535之间的整数。');
  const config = readModelConfig();
  const server = createApp({ config }).listen(port, '127.0.0.1', () => {
    console.log(`Human 3.0 对话工作台：http://127.0.0.1:${port}`);
    console.log(config.apiKey ? '真实模型模式：仅分析时发送当前访谈和规则。' : '本地演示模式：未调用外部模型。');
  });
  server.on('error', () => { console.error('启动失败，请检查端口是否被占用。'); process.exitCode = 1; });
} catch {
  console.error('启动配置无效，请检查本地 .env 中的端口及模型地址。');
  process.exitCode = 1;
}
