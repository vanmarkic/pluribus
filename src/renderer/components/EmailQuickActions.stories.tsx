import type { Meta, StoryObj } from '@storybook/react-vite';
import { EmailQuickActions } from './EmailQuickActions';

/**
 * Per-row hover actions: archive, trash, mark-read/unread.
 *
 * Lives inside an `email-item` group whose `:hover` reveals the actions.
 * Stories render with the group hovered so the buttons are always visible.
 */
const meta: Meta<typeof EmailQuickActions> = {
  title: 'Email/EmailQuickActions',
  component: EmailQuickActions,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="group" style={{ display: 'inline-block' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    emailId: 1,
    isRead: false,
  },
};

export default meta;
type Story = StoryObj<typeof EmailQuickActions>;

export const Unread: Story = {
  args: { isRead: false },
};

export const Read: Story = {
  args: { isRead: true },
};

export const WithActionCallback: Story = {
  args: {
    isRead: false,
    onAction: () => console.log('action fired'),
  },
};
