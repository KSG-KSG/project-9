import './globals.css';

export const metadata = {
  title: '한붓대결',
  description: '친구가 그린 한붓그리기 문제를 실시간으로 풀어보는 1:1 대결',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#1b1a2e',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
