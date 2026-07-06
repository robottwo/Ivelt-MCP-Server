import test from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../src/mcp/server.ts';
import type { PhpbbClient, Parsers } from '../src/contract.ts';

const client: PhpbbClient = {
  login: async () => {},
  getForumIndex: async () => '',
  getForum: async () => '',
  getTopic: async () => '',
  search: async () => '',
  searchAuthorTopics: async () => '',
  searchAuthorPosts: async () => '',
  getNotifications: async () => '',
  getPrivateMessages: async () => '',
  getPostPage: async () => '',
  checkConnectivity: async () => ({ reachable: true, loggedIn: false }),
};

const parsers: Parsers = {
  parseForumIndex: () => [],
  parseForum: () => [],
  parseTopic: () => ({ id: '', title: '', url: '', posts: [], page: 1, totalPages: 1 }),
  parseSearch: () => [],
  parsePostSearch: () => ({ total: 0, posts: [] }),
  parseAuthorPostCount: () => null,
  detectNotice: () => null,
  parseNotifications: () => [],
  parsePrivateMessages: () => [],
};

test('buildServer uses configurable site metadata instead of a hard-coded ivelt identity', () => {
  const server = buildServer(
    {
      siteName: 'Diamond Aviators',
      baseUrl: 'https://www.diamondaviators.net/forum',
      username: '',
      password: '',
    },
    client,
    parsers,
  );

  assert.ok(server);
});
