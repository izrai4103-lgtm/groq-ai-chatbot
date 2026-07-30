import './globals.css'

export const metadata = {
  title: 'Groq Chatbot AI',
  description: 'AI Chatbot powered by Groq',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
