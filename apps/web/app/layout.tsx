import type { Metadata } from 'next';
import { AuthProvider } from '../components/AuthProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'MailOps',
  description: 'Rules-based Gmail automation: archive, trash or keep, per label.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
