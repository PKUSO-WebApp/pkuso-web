import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthGate } from "@/components/auth-gate";
import { ErrorBoundary } from "@/components/error-boundary";
import { ToastProvider } from "@/components/ui/Toast";
import { ThemeProvider } from "@/context/theme-context";
import { UserProvider } from "@/context/user-context";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "乐团管理助手",
  description: "面向乐团的移动端管理助手",
};

// iOS 键盘弹起时收缩视口高度：h-[100dvh] 不含软键盘，默认 resizes-visual 会遮挡
// 全屏编辑底部操作栏，改 resizes-content 让页面随键盘压缩、底部栏始终可见
export const viewport: Viewport = {
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // suppressHydrationWarning：首帧脚本在 hydration 前改动 <html> 的 data-theme 属性，
  // React 对该外部改动不做校验，抑制预期中的 mismatch 告警（Next.js 官方防闪烁模式）
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 首帧防闪烁（Issue #203）：HTML 解析阶段按存储偏好预置 data-theme，
            防暗色用户白屏闪烁（useEffect 时机太晚）；脚本与 useTheme 共享解析规则，
            见 src/lib/theme.ts 的 THEME_INIT_SCRIPT */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-page-bg`}>
        {/* 全局主题 Provider（对抗返工 Issue #203）：全站共享主题状态与系统外观监听，
            须在根 layout 挂载（首帧脚本负责预置，provider 负责 hydration 后的实时跟随） */}
        <ThemeProvider>
          <UserProvider>
            <ToastProvider>
              <ErrorBoundary>
                <AuthGate>{children}</AuthGate>
              </ErrorBoundary>
            </ToastProvider>
          </UserProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
