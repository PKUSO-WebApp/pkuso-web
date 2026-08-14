import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthGate } from "@/components/auth-gate";
import { ErrorBoundary } from "@/components/error-boundary";
import { ToastProvider } from "@/components/ui/Toast";
import { UserProvider } from "@/context/user-context";

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
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-page-bg`}>
        <UserProvider>
          <ToastProvider>
            <ErrorBoundary>
              <AuthGate>{children}</AuthGate>
            </ErrorBoundary>
          </ToastProvider>
        </UserProvider>
      </body>
    </html>
  );
}
