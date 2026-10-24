import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "분양 CRM 대시보드",
  description: "고객·상담·계약·광고 데이터를 정리해 만든 분양 CRM 대시보드와 인사이트",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
