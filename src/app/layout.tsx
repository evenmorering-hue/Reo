import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const pretendard = localFont({
  src: [
    { path: "../../public/fonts/Pretendard-Regular.otf", weight: "400", style: "normal" },
    { path: "../../public/fonts/Pretendard-Medium.otf", weight: "500", style: "normal" },
    { path: "../../public/fonts/Pretendard-SemiBold.otf", weight: "600", style: "normal" },
    { path: "../../public/fonts/Pretendard-Bold.otf", weight: "700", style: "normal" },
    { path: "../../public/fonts/Pretendard-ExtraBold.otf", weight: "800", style: "normal" },
  ],
  variable: "--font-pretendard",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Shorts Atelier",
  description: "이미지 2장과 음원만으로 유튜브 쇼츠를 자동 생성하는 브라우저 앱",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      <body className="min-h-full bg-[#0b0e17] font-sans">{children}</body>
    </html>
  );
}
