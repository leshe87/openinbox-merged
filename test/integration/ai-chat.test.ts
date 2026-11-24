import { beforeEach, describe, expect, it } from 'vitest';
import { useFakeApis } from '../helpers/fake';
import { Client, setupInstance } from '../helpers/client';

describe('AI chat when unconfigured', () => {
  let admin: Client;
  beforeEach(async () => {
    useFakeApis();
    admin = new Client();
    await setupInstance(admin);
  });

  it('returns 503 ai_not_configured instead of a generic 500 when AI is on but no provider is configured', async () => {
    await admin.patch('/api/ai/settings', {
      aiEnabled: 'on',
      aiProvider: 'workers',
      aiModel: 'deepseek-chat',
      aiBaseUrl: 'https://api.deepseek.com',
    });
    const res = await admin.request('POST', '/api/ai/chat', { message: '你好' });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('ai_not_configured');
    expect(body.error.message).toMatch(/AI 未配置/);
  });

  it('returns 503 ai_not_configured when the DeepSeek provider has no API key', async () => {
    await admin.patch('/api/ai/settings', {
      aiEnabled: 'on',
      aiProvider: 'deepseek',
      aiModel: 'deepseek-chat',
      aiBaseUrl: 'https://api.deepseek.com',
    });
    const res = await admin.request('POST', '/api/ai/chat', { message: '你好' });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('ai_not_configured');
  });
});
