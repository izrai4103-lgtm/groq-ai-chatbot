import './globals.css'

export const metadata = {
  title: 'Groq AI Chatbot',
  description: 'AI Chatbot berbasis Groq - Cepat, Cerdas, Gratis',
}

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  )
}
