import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const path = (value) => fileURLToPath(new URL(value, import.meta.url));
if (existsSync(path('../node_modules/esbuild/package.json'))) await import('./build.mjs');
else if (!existsSync(path('../dist/client/manifest.json')))
  throw new Error(
    '缺少前端构建产物，请先安装开发依赖并执行 npm run build，或使用多阶段 Docker 镜像',
  );
