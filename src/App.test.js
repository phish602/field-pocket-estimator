import { render, screen } from '@testing-library/react';
import App from './App';
import {
  resetConfiguredTestWorkspace,
  setupConfiguredWorkspace,
  buildUnlockedVaultSessionResult,
  waitForConfiguredWorkspaceShell,
} from './testUtils/configuredWorkspaceTestHarness';

// ISO-14K: the operational shell requires an authenticated identity with an
// active account-scoped workspace, so this suite states one explicitly.
jest.mock('./lib/useSupabaseAuth', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./lib/useSupabaseAccount', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./lib/useSupabaseWorkspaceBootstrap', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./lib/useDeviceLockStatus', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./lib/useCloudAutoBackup', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./lib/useCloudAutoConvergence', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./lib/useVaultSession', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./lib/useVaultRuntimeActivation', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./lib/useVaultCompatibilityBridge', () => ({ __esModule: true, default: () => ({ state: 'legacy-safe', checking: false, code: '', message: '', refresh: jest.fn() }) }));
jest.mock('./lib/vaultCrypto', () => ({ workspaceTag: () => Promise.resolve('A'.repeat(43)) }));

const useVaultSession = require('./lib/useVaultSession').default;

beforeEach(() => {
  resetConfiguredTestWorkspace();
  setupConfiguredWorkspace();
  useVaultSession.mockReturnValue(buildUnlockedVaultSessionResult());
});

afterEach(() => {
  resetConfiguredTestWorkspace();
});

test('renders app shell header actions', async () => {
  render(<App />);
  await waitForConfiguredWorkspaceShell();
  expect(screen.getByLabelText(/open menu/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/open company profile/i)).toBeInTheDocument();
  expect(screen.queryByText("This Device Is Locked")).not.toBeInTheDocument();
});
