import { describe, expect, it } from 'vitest';
import {
  authServerMetadata,
  ClientRegistration,
  parseScopes,
  protectedResourceMetadata,
} from './oauth';

describe('OAuth for MCP', () => {
  it('only accepts https redirect URIs (or http on localhost)', () => {
    expect(
      ClientRegistration.safeParse({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] })
        .success,
    ).toBe(true);
    expect(
      ClientRegistration.safeParse({ redirect_uris: ['http://localhost:6274/cb'] }).success,
    ).toBe(true);
    expect(
      ClientRegistration.safeParse({ redirect_uris: ['http://evil.example/cb'] }).success,
    ).toBe(false);
    expect(ClientRegistration.safeParse({ redirect_uris: ['javascript:alert(1)'] }).success).toBe(
      false,
    );
  });

  it('never grants scopes beyond read and propose', () => {
    expect(parseScopes('read propose admin')).toEqual(['read', 'propose']);
    expect(parseScopes('admin')).toEqual(['read']);
    expect(parseScopes(undefined)).toEqual(['read', 'propose']);
  });

  it('publishes discovery metadata with PKCE S256', () => {
    const as = authServerMetadata('https://m.example');
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
    expect(as.token_endpoint).toBe('https://m.example/api/oauth/token');
    expect(protectedResourceMetadata('https://m.example').resource).toBe(
      'https://m.example/api/mcp',
    );
  });
});
