import type { Meta, StoryObj } from '@storybook/react-vite';
import { ReclassifyConfirmModal } from './ReclassifyConfirmModal';

const meta: Meta<typeof ReclassifyConfirmModal> = {
  title: 'Email/ReclassifyConfirmModal',
  component: ReclassifyConfirmModal,
  parameters: { layout: 'fullscreen' },
  args: {
    emailId: 42,
    emailSubject: 'Quarterly invoice from Stripe',
    onClose: () => console.log('close'),
  },
};

export default meta;
type Story = StoryObj<typeof ReclassifyConfirmModal>;

export const FreshClassification: Story = {
  args: {
    classification: null,
    onConfirm: async () => ({
      previousFolder: null,
      previousConfidence: null,
      newFolder: 'Paper-Trail/Invoices',
      newConfidence: 0.92,
      reasoning: 'Sender domain matches a known billing provider; subject contains "invoice".',
    }),
  },
};

export const PreviouslyClassified: Story = {
  args: {
    classification: {
      emailId: 42,
      status: 'classified',
      confidence: 0.78,
      suggestedFolder: 'Promotions',
      reasoning: 'Marketing-style HTML, list-unsubscribe header.',
      classifiedAt: new Date().toISOString(),
    },
    onConfirm: async () => ({
      previousFolder: 'Promotions',
      previousConfidence: 0.78,
      newFolder: 'Paper-Trail/Invoices',
      newConfidence: 0.95,
      reasoning: 'Re-checked: amount + due date + invoice ID strongly indicate billing.',
    }),
  },
};

export const LowConfidencePending: Story = {
  args: {
    classification: {
      emailId: 42,
      status: 'pending_review',
      confidence: 0.41,
      suggestedFolder: 'Feed',
      reasoning: 'Mixed signals — newsletter formatting, but content references an account.',
      classifiedAt: new Date().toISOString(),
    },
    onConfirm: async () => ({
      previousFolder: 'Feed',
      previousConfidence: 0.41,
      newFolder: 'Social',
      newConfidence: 0.66,
      reasoning: 'Slightly more confident on social classification this time.',
    }),
  },
};

export const ConfirmFails: Story = {
  args: {
    classification: null,
    onConfirm: async () => {
      throw new Error('Anthropic API rate limit reached. Try again in a few minutes.');
    },
  },
};
