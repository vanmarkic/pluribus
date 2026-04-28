import type { Meta, StoryObj } from '@storybook/react-vite';
import { LicenseStatusBadge } from './LicenseActivation';
import { useLicenseStore } from '../stores';

/**
 * Visual badge for license state.
 *
 * Returns null for healthy active licenses (>7 days remaining), so the
 * `Healthy` story is intentionally empty.
 */
const meta: Meta<typeof LicenseStatusBadge> = {
  title: 'Settings/LicenseStatusBadge',
  component: LicenseStatusBadge,
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof LicenseStatusBadge>;

const setLicense = (state: Partial<ReturnType<typeof useLicenseStore.getState>>) => () => {
  useLicenseStore.setState(state);
};

export const Inactive: Story = {
  decorators: [
    (Story) => {
      setLicense({
        status: 'inactive',
        daysUntilExpiry: null,
        licenseKey: null,
      })();
      return <Story />;
    },
  ],
};

export const ExpiringSoon: Story = {
  decorators: [
    (Story) => {
      setLicense({ status: 'active', daysUntilExpiry: 3 })();
      return <Story />;
    },
  ],
};

export const InGracePeriod: Story = {
  decorators: [
    (Story) => {
      setLicense({ status: 'grace', daysUntilExpiry: -2 })();
      return <Story />;
    },
  ],
};

export const Expired: Story = {
  decorators: [
    (Story) => {
      setLicense({ status: 'expired', daysUntilExpiry: -30, isReadOnly: true })();
      return <Story />;
    },
  ],
};

export const Healthy: Story = {
  decorators: [
    (Story) => {
      setLicense({ status: 'active', daysUntilExpiry: 90 })();
      return <Story />;
    },
  ],
};
