import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { NeedsReplyView } from './NeedsReplyView';
import { useRepliesStore } from '../stores/repliesStore';
import { useEmailUiStore } from '../stores';
import { buildForgottenReplies, DEMO_ACCOUNT_EMAIL } from '../mockApi/fixtures';
import type { ForgottenRepliesResult } from '../../core/domain';

/**
 * "Needs your reply": important emails the user has not answered yet.
 * List on the left, the normal reader on the right; Done / Snooze 1 day /
 * Not important act on each item.
 *
 * Data comes from the same fixtures as the public demo.
 */
const meta: Meta<typeof NeedsReplyView> = {
  title: 'Email/NeedsReplyView',
  component: NeedsReplyView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex h-[640px] -m-4" style={{ background: 'var(--color-bg)' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NeedsReplyView>;

const result = (
  overrides: Partial<ForgottenRepliesResult> = {},
  accountId = 1,
): ForgottenRepliesResult => ({
  accountId,
  accountEmail: DEMO_ACCOUNT_EMAIL,
  items: buildForgottenReplies().map((item) => ({ ...item, accountId })),
  sentHealth: 'ok',
  generatedAt: new Date(),
  ...overrides,
});

/** Serve `list` from window.mailApi (the Storybook default mock returns nothing). */
const serving =
  (list: () => Promise<ForgottenRepliesResult[]>): Decorator =>
  (Story) => {
    useRepliesStore.setState({
      results: [],
      loaded: false,
      loading: false,
      error: null,
      actionError: null,
    });
    useEmailUiStore.setState({ selectedId: null });
    Object.assign(window.mailApi.replies, {
      list,
      done: async () => {},
      snooze: async () => {},
      dismiss: async () => {},
      backfill: async () => ({ processed: 24, skipped: 3 }),
    });
    return <Story />;
  };

export const ThreeEmails: Story = {
  decorators: [serving(async () => [result()])],
};

export const MultipleAccounts: Story = {
  decorators: [
    serving(async () => {
      const items = buildForgottenReplies();
      return [
        result({ items: items.slice(0, 2) }),
        result({ accountEmail: 'work@nimbus.co', items: items.slice(2) }, 2),
      ];
    }),
  ],
};

export const AllCaughtUp: Story = {
  decorators: [serving(async () => [result({ items: [] })])],
};

export const SentFolderNotSyncing: Story = {
  decorators: [serving(async () => [result({ items: [], sentHealth: 'no-sent-mail' })])],
};

export const Loading: Story = {
  decorators: [serving(() => new Promise<ForgottenRepliesResult[]>(() => {}))],
};

export const LoadError: Story = {
  decorators: [
    serving(async () => {
      throw new Error('Could not reach the mail database');
    }),
  ],
};
