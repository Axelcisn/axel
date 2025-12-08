import './globals.css'
import type { Metadata } from 'next'
import Navigation from '@/components/Navigation'

export const metadata: Metadata = {
  title: 'Axel',
  description: 'Advanced financial analysis and momentum timing platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-background text-foreground">
        <Navigation />
        <div className="page-content">
          {children}
        </div>
      </body>
    </html>
  )
}
