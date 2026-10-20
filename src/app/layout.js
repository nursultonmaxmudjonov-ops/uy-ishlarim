// app/layout.jsx
import ConvexClientProvider from "./ConvexClientProvider";
import "./globals.css";

export default function RootLayout({ children }) {
  return (
    <html lang="uz">
      <body>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}