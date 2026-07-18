import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier, // 关闭与 Prettier 冲突的规则,必须在最后
  {
    rules: {
      // React 19 新增规则,要求不在 effect 内同步调用 setState。
      // 全仓现有组件大量使用 effect 数据获取模式,完整改写需专门的 fetch 层重构。
      // 降级为 warn,重构时逐步收敛为 error。
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
