import type { Meta, StoryObj } from '@storybook/react-vite';
import { KeyboardShortcutsHelp } from './useKeyboardShortcuts';

const meta: Meta<typeof KeyboardShortcutsHelp> = {
  title: 'App/KeyboardShortcutsHelp',
  component: KeyboardShortcutsHelp,
  parameters: { layout: 'fullscreen' },
  args: {
    onClose: () => console.log('close'),
  },
};

export default meta;
type Story = StoryObj<typeof KeyboardShortcutsHelp>;

export const Open: Story = {
  args: { isOpen: true },
};

export const Closed: Story = {
  args: { isOpen: false },
};
