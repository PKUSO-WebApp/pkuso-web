// pdfjs-dist 只发布了 build/pdf.worker.min.mjs，没有配套的 .d.ts。
// pdf.js v6 的主线程（fake worker）机制只要求该模块导出 WorkerMessageHandler，
// 类型无需精确，这里按 TS 建议声明为 any。
declare module "pdfjs-dist/build/pdf.worker.min.mjs";
