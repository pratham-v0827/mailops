import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @mailops/schema is shipped as TypeScript source from the workspace.
  transpilePackages: ['@mailops/schema'],
  poweredByHeader: false,
  // OAuth discovery for MCP clients (RFC 8414 / RFC 9728), served by API routes.
  async rewrites() {
    return [
      { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth/metadata' },
      {
        source: '/.well-known/oauth-authorization-server/:path*',
        destination: '/api/oauth/metadata',
      },
      { source: '/.well-known/openid-configuration', destination: '/api/oauth/metadata' },
      { source: '/.well-known/oauth-protected-resource', destination: '/api/oauth/resource' },
      {
        source: '/.well-known/oauth-protected-resource/:path*',
        destination: '/api/oauth/resource',
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
