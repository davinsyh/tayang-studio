import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PostUploadProgressPanel } from '@/components/PostUploadProgress';
import type { PostUploadProgress } from '@/lib/uploadProgress';

const accounts = [{ id: 'yt:own', platform: 'youtube', username: 'creator' }, { id: 'z:ig', platform: 'instagram', username: 'creator' }];
const event: PostUploadProgress = { projectId: 'p', accountId: 'yt:own', platform: 'youtube', stage: 'uploading', sent: 75_000_000, total: 100_000_000 };

it('shows transferred bytes and individual progress while other platforms wait their turn', () => {
  render(<PostUploadProgressPanel accounts={accounts} progress={{ 'yt:own': event }} />);
  expect(screen.getByText('75%')).toBeInTheDocument();
  expect(screen.getByText('75.0 / 100.0 MB')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'YouTube · @creator' })).toHaveAttribute('value', '75');
  expect(screen.getByText('Waiting for its turn')).toBeInTheDocument();
});

it('does not show 100% or Posted while bytes are still awaiting upload acknowledgement', () => {
  const { rerender } = render(<PostUploadProgressPanel accounts={[accounts[0]!]} progress={{ 'yt:own': { ...event, sent: event.total } }} />);
  expect(screen.getByText('99%')).toBeInTheDocument();
  rerender(<PostUploadProgressPanel accounts={[accounts[0]!]} progress={{ 'yt:own': { ...event, sent: event.total, stage: 'processing' } }} />);
  expect(screen.getByText('100%')).toBeInTheDocument();
  expect(screen.getByText(/Upload received/)).toBeInTheDocument();
  expect(screen.queryByText('Posted')).not.toBeInTheDocument();
});

it('uses indeterminate progress when the byte total is unknown', () => {
  render(<PostUploadProgressPanel accounts={[accounts[0]!]} progress={{ 'yt:own': { ...event, total: 0, sent: 0 } }} />);
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
  expect(screen.queryByText('0%')).not.toBeInTheDocument();
});
