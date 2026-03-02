import { render, screen } from '@testing-library/react';
import App from './App';

test('renders app shell header actions', () => {
  render(<App />);
  expect(screen.getByLabelText(/open menu/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/open snapshot/i)).toBeInTheDocument();
});
