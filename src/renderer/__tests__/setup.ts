/**
 * Test setup for React component tests
 * Configures jsdom environment and RTL matchers
 */

import '@testing-library/jest-dom/vitest';

// Mock window.mailApi for renderer tests
const mockMailApi = {
  emails: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    getBody: vi.fn().mockResolvedValue({ html: '', text: '' }),
    search: vi.fn().mockResolvedValue([]),
    markRead: vi.fn().mockResolvedValue(undefined),
    star: vi.fn().mockResolvedValue(undefined),
    archive: vi.fn().mockResolvedValue(undefined),
    unarchive: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    trash: vi.fn().mockResolvedValue(undefined),
  },
  attachments: {
    getForEmail: vi.fn().mockResolvedValue([]),
    download: vi.fn().mockResolvedValue({ path: '', action: '' }),
  },
  accounts: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
  },
  config: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
  on: vi.fn(),
  off: vi.fn(),
};

Object.defineProperty(window, 'mailApi', {
  value: mockMailApi,
  writable: true,
});

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
