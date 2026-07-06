import test from 'node:test';
import assert from 'node:assert/strict';

import { getConfig } from '../src/config.ts';

test('getConfig supports generic PHPBB env vars without requiring credentials', () => {
  const prev = {
    PHPBB_SITE_NAME: process.env.PHPBB_SITE_NAME,
    PHPBB_BASE_URL: process.env.PHPBB_BASE_URL,
    PHPBB_USERNAME: process.env.PHPBB_USERNAME,
    PHPBB_PASSWORD: process.env.PHPBB_PASSWORD,
    IVELT_BASE_URL: process.env.IVELT_BASE_URL,
    IVELT_USERNAME: process.env.IVELT_USERNAME,
    IVELT_PASSWORD: process.env.IVELT_PASSWORD,
  };

  process.env.PHPBB_SITE_NAME = 'Diamond Aviators';
  process.env.PHPBB_BASE_URL = 'https://www.diamondaviators.net/forum/';
  delete process.env.PHPBB_USERNAME;
  delete process.env.PHPBB_PASSWORD;
  delete process.env.IVELT_BASE_URL;
  delete process.env.IVELT_USERNAME;
  delete process.env.IVELT_PASSWORD;

  try {
    assert.deepEqual(getConfig(), {
      siteName: 'Diamond Aviators',
      baseUrl: 'https://www.diamondaviators.net/forum',
      username: '',
      password: '',
    });
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});


test('getConfig falls back to legacy IVELT env vars for backward compatibility', () => {
  const prev = {
    PHPBB_SITE_NAME: process.env.PHPBB_SITE_NAME,
    PHPBB_BASE_URL: process.env.PHPBB_BASE_URL,
    PHPBB_USERNAME: process.env.PHPBB_USERNAME,
    PHPBB_PASSWORD: process.env.PHPBB_PASSWORD,
    IVELT_BASE_URL: process.env.IVELT_BASE_URL,
    IVELT_USERNAME: process.env.IVELT_USERNAME,
    IVELT_PASSWORD: process.env.IVELT_PASSWORD,
  };

  delete process.env.PHPBB_SITE_NAME;
  delete process.env.PHPBB_BASE_URL;
  delete process.env.PHPBB_USERNAME;
  delete process.env.PHPBB_PASSWORD;
  process.env.IVELT_BASE_URL = 'https://www.ivelt.com/forum/';
  process.env.IVELT_USERNAME = 'alice';
  process.env.IVELT_PASSWORD = 'secret';

  try {
    assert.deepEqual(getConfig(), {
      siteName: 'ivelt.com',
      baseUrl: 'https://www.ivelt.com/forum',
      username: 'alice',
      password: 'secret',
    });
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
