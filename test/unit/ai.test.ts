import { describe, expect, it } from 'vitest';
import { cleanText, extractJSON } from '../../src/worker/services/ai-client';
import { calculateRiskLevel, matchSecurityType, validCategory, validPlatformCategory } from '../../src/worker/services/ai-analysis';

describe('cleanText', () => {
  it('strips HTML tags and collapses whitespace', () => {
    expect(cleanText('<p>Hello <b>world</b></p>')).toBe('Hello world');
    expect(cleanText('  too   much\n\n space  ')).toBe('too much space');
    expect(cleanText('<div><span>nested</span> <a href="https://x.test">link</a></div>')).toBe('nested link');
  });

  it('returns empty for nullish or empty input', () => {
    expect(cleanText(null)).toBe('');
    expect(cleanText(undefined)).toBe('');
    expect(cleanText('')).toBe('');
  });

  it('truncates to the default 800 characters and to a custom limit', () => {
    expect(cleanText('x'.repeat(900))).toHaveLength(800);
    expect(cleanText('x'.repeat(800))).toHaveLength(800);
    expect(cleanText('abcdef', 3)).toBe('abc');
    expect(cleanText('abcdef', 10)).toBe('abcdef');
  });
});

describe('extractJSON', () => {
  it('strips markdown code fences', () => {
    expect(extractJSON('```json\n{"category": "register"}\n```')).toBe('{"category": "register"}');
    expect(extractJSON('```\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it('extracts the JSON object from surrounding prose', () => {
    expect(extractJSON('Here is the result: {"x": 2} hope this helps')).toBe('{"x": 2}');
    expect(extractJSON('{"a": {"b": 1}}')).toBe('{"a": {"b": 1}}');
  });

  it('returns the trimmed text when there is no JSON object', () => {
    expect(extractJSON('  no json here  ')).toBe('no json here');
    expect(extractJSON('')).toBe('');
  });
});

describe('matchSecurityType', () => {
  it('matches password-change keywords', () => {
    expect(matchSecurityType('Your password was changed', '')).toBe('password_change');
    expect(matchSecurityType('密码重置成功', '')).toBe('password_change');
    expect(matchSecurityType('Security notice', 'Click here to reset password')).toBe('password_change');
  });

  it('matches abnormal-login keywords', () => {
    expect(matchSecurityType('New login from a new device', '')).toBe('abnormal_login');
    expect(matchSecurityType('检测到异常登录', '')).toBe('abnormal_login');
    expect(matchSecurityType('Security alert', 'We noticed unusual activity on your account')).toBe('abnormal_login');
  });

  it('matches data-breach keywords', () => {
    expect(matchSecurityType('Data breach notification', '')).toBe('data_breach');
    expect(matchSecurityType('您的数据可能已泄露', '')).toBe('data_breach');
    expect(matchSecurityType('Important update', 'Your account may have been compromised')).toBe('data_breach');
  });

  it('returns null when nothing matches', () => {
    expect(matchSecurityType('Your weekly newsletter', 'Here are this week’s top stories.')).toBeNull();
    expect(matchSecurityType('', '')).toBeNull();
  });
});

describe('calculateRiskLevel', () => {
  it('returns high risk (2) for a high-risk keyword with confidence at or above 0.6', () => {
    expect(calculateRiskLevel('Urgent: verify your account', '', 0.6)).toBe(2);
    expect(calculateRiskLevel('Your account will be suspended', '', 0.9)).toBe(2);
    expect(calculateRiskLevel('请立即确认身份', '', 0.75)).toBe(2);
  });

  it('returns medium risk (1) for a high-risk keyword below the high threshold, or confidence at or above 0.7', () => {
    expect(calculateRiskLevel('Urgent action required', '', 0.5)).toBe(1);
    expect(calculateRiskLevel('Your monthly statement', '', 0.7)).toBe(1);
    expect(calculateRiskLevel('Your monthly statement', '', 0.95)).toBe(1);
  });

  it('returns low risk (0) otherwise', () => {
    expect(calculateRiskLevel('Your monthly statement', '', 0.69)).toBe(0);
    expect(calculateRiskLevel('Your monthly statement', '', 0)).toBe(0);
    expect(calculateRiskLevel('', '', 0.5)).toBe(0);
  });
});

describe('validCategory', () => {
  it('passes valid categories through', () => {
    expect(validCategory('register')).toBe('register');
    expect(validCategory('verify')).toBe('verify');
    expect(validCategory('security')).toBe('security');
    expect(validCategory('bill')).toBe('bill');
    expect(validCategory('update')).toBe('update');
    expect(validCategory('marketing')).toBe('marketing');
    expect(validCategory('social')).toBe('social');
  });

  it('returns empty for invalid or non-string values', () => {
    expect(validCategory('phishing')).toBe('');
    expect(validCategory('')).toBe('');
    expect(validCategory('REGISTER')).toBe('');
    expect(validCategory(null)).toBe('');
    expect(validCategory(42)).toBe('');
    expect(validCategory(undefined)).toBe('');
  });
});

describe('validPlatformCategory', () => {
  it('passes valid platform categories through', () => {
    expect(validPlatformCategory('dev')).toBe('dev');
    expect(validPlatformCategory('ai')).toBe('ai');
    expect(validPlatformCategory('saas')).toBe('saas');
    expect(validPlatformCategory('social')).toBe('social');
    expect(validPlatformCategory('cloud')).toBe('cloud');
    expect(validPlatformCategory('web3')).toBe('web3');
    expect(validPlatformCategory('finance')).toBe('finance');
    expect(validPlatformCategory('shop')).toBe('shop');
    expect(validPlatformCategory('news')).toBe('news');
    expect(validPlatformCategory('other')).toBe('other');
  });

  it('returns empty for invalid or non-string values', () => {
    expect(validPlatformCategory('gaming')).toBe('');
    expect(validPlatformCategory('')).toBe('');
    expect(validPlatformCategory('DEV')).toBe('');
    expect(validPlatformCategory(null)).toBe('');
    expect(validPlatformCategory({})).toBe('');
  });
});
