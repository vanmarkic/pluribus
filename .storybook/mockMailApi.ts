/**
 * Browser-safe stub for `window.mailApi` used by Storybook.
 *
 * Most stories don't need real data — components that consume RTK Query
 * hooks render fine with empty results. Stories that need richer fixtures
 * can override individual methods via `parameters.mailApi`.
 */

const ok =
  <T>(value: T) =>
  async () =>
    value;

const noop = async () => {};

export const mockMailApi = {
  emails: {
    list: ok([]),
    get: ok(null),
    getBody: ok({ html: '', text: '' }),
    search: ok([]),
    markRead: noop,
    star: noop,
    archive: noop,
    unarchive: noop,
    delete: noop,
    trash: noop,
  },
  attachments: {
    getForEmail: ok([]),
    download: ok({ path: '', action: '' }),
  },
  accounts: { list: ok([]), get: ok(null) },
  config: { get: ok(null), set: noop, getTriageFolders: ok([]) },
  on: () => {},
  off: () => {},
} as unknown as typeof window.mailApi;
