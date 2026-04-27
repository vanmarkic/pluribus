import type { Meta, StoryObj } from '@storybook/react-vite';
import { BulkActionBar } from './BulkActionBar';
import { useEmailUiStore } from '../stores';

/**
 * Top bar shown when the user multi-selects emails. Renders nothing when
 * no emails are selected, so the "Empty" story is intentionally blank —
 * the assertion is the absence of UI.
 */
const meta: Meta<typeof BulkActionBar> = {
  title: 'Email/BulkActionBar',
  component: BulkActionBar,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof BulkActionBar>;

const seed = (ids: number[]) => () => {
  useEmailUiStore.setState({ selectedIds: new Set(ids) });
};

export const Empty: Story = {
  decorators: [
    (Story) => {
      seed([])();
      return <Story />;
    },
  ],
};

export const ThreeSelected: Story = {
  decorators: [
    (Story) => {
      seed([1, 2, 3])();
      return <Story />;
    },
  ],
};

export const ManySelected: Story = {
  decorators: [
    (Story) => {
      seed([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])();
      return <Story />;
    },
  ],
};
